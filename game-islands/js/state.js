// Game state machine. Pure: no DOM, no clock, no randomness outside the seeded RNG stored in the state.
// createGame(config, seed, names) -> state            config = config.json with costs.json as config.costs
// applyAction(state, action) -> new state (or throws a readable Error); the input is never changed
// legalActions(state) -> what the player who must act can do now
import { generateBoard } from './board.js';
import { createRng } from './rng.js';
import * as R from './rules.js';
import { A, MSG, checkShape } from './actions.js';

export const VERSION = 1;
const clone = o => JSON.parse(JSON.stringify(o));

export function createGame(config, seed, names) {
  if (!config?.costs) throw new Error('Pass costs.json as config.costs.');
  const list = (names || []).map(n => String(n).trim()).filter(Boolean);
  if (list.length < config.players.min || list.length > config.players.max) throw new Error(`This game is for ${config.players.min} to ${config.players.max} players.`);
  const seedValue = seed ?? 1;
  const { board, position } = generateBoard(config, seedValue);
  const rng = createRng(position);
  const deck = [];
  for (const [type, def] of Object.entries(config.cards)) for (let i = 0; i < def.count; i++) deck.push(type);
  const n = list.length;
  const state = {
    version: VERSION,
    seed: seedValue,
    rng: 0,
    config: clone(config),
    board,
    players: list.map((name, i) => ({
      id: i, name, color: i,
      hand: R.emptyHand(config.resources),
      built: { road: 0, settlement: 0, city: 0 },
      cards: [],
      played: Object.fromEntries(Object.keys(config.cards).map(k => [k, 0]))
    })),
    buildings: {}, roads: {},
    deck: rng.shuffle(deck),
    phase: 'setup', current: 0, turn: 0,
    setup: { order: [...Array(n).keys(), ...[...Array(n).keys()].reverse()], index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    pending: { discards: {}, returnPhase: 'main' },
    trade: null, freeRoads: 0, cardPlayed: false,
    awards: { longestRoad: null, harborMastery: null, largestFleet: null },
    winner: null,
    log: [`A new game begins on ${config.name}. Seed ${seedValue}.`, `${list[0]} places first.`],
    history: []
  };
  state.rng = rng.position;
  return state;
}

/** The player who must act now (the target of a trade, or someone who must discard, can differ from the turn owner). */
export function actorOf(state) {
  switch (state.phase) {
    case 'over': return null;
    case 'setup': return state.setup.order[state.setup.index];
    case 'discard': return discardOrder(state)[0] ?? null;
    case 'trade': return state.trade.to;
    default: return state.current;
  }
}
function discardOrder(state) {
  const n = state.players.length;
  return [...Array(n).keys()].map(i => (state.current + i) % n).filter(p => p in state.pending.discards);
}

export function applyAction(state, action) {
  checkShape(action);
  if (state.phase === 'over') throw new Error(MSG.over);
  const s = clone(state);
  const rng = createRng(s.rng);
  const p = action.player;
  const P = s.players;
  const name = i => P[i].name;
  const label = r => s.config.terrains[r]?.label || r;
  const list = hand => Object.entries(hand).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${label(r)}`).join(', ');
  const say = t => s.log.push(t);
  const must = (ok, msg) => { if (!ok) throw new Error(msg); };
  const actor = actorOf(s);
  const isResource = r => s.config.resources.includes(r);

  if (s.phase === 'discard') must(p in s.pending.discards, MSG.notYou(name(actor)));
  else must(p === actor, MSG.notYou(name(actor)));

  switch (action.type) {
    /* ----- setup ----- */
    case 'placeSettlement': {
      must(s.phase === 'setup' && s.setup.step === 'settlement', MSG.phase('place a starting settlement', s.phase));
      must(R.settlementSpots(s, p, { setup: true }).includes(action.vertex), MSG.spot('settlement'));
      s.buildings[action.vertex] = { player: p, kind: 'settlement' };
      P[p].built.settlement++;
      s.setup.step = 'road'; s.setup.lastSettlement = action.vertex;
      say(`${name(p)} places a settlement.`);
      if (s.setup.index >= P.length) {
        const got = {};
        for (const hid of s.board.vertices[action.vertex].hexes) {
          const res = s.config.terrains[s.board.hexes.find(h => h.id === hid).terrain].resource;
          if (res) got[res] = (got[res] || 0) + 1;
        }
        P[p].hand = R.gain(P[p].hand, got);
        if (Object.keys(got).length) say(`${name(p)} starts with ${list(got)}.`);
      }
      break;
    }
    case 'placeRoad': {
      must(s.phase === 'setup' && s.setup.step === 'road', MSG.phase('place a starting road', s.phase));
      must(R.roadSpots(s, p, { from: s.setup.lastSettlement }).includes(action.edge), 'Your starting road must touch the settlement you just placed.');
      s.roads[action.edge] = p;
      P[p].built.road++;
      s.setup.index++; s.setup.step = 'settlement'; s.setup.lastSettlement = null;
      say(`${name(p)} places a road.`);
      if (s.setup.index >= s.setup.order.length) {
        s.phase = 'roll'; s.current = 0; s.turn = 1;
        say(`Setup is complete. ${name(0)} rolls first.`);
      } else if (s.setup.order[s.setup.index] !== p) {
        say(`${name(s.setup.order[s.setup.index])} places next.`);
      }
      break;
    }

    /* ----- rolling and the robber ----- */
    case 'roll': {
      must(s.phase === 'roll', MSG.phase('roll', s.phase));
      const dice = [rng.int(1, 6), rng.int(1, 6)];
      const total = dice[0] + dice[1];
      s.dice = dice;
      say(`${name(p)} rolls ${dice[0]} and ${dice[1]}: ${total}.`);
      if (total === 7) {
        s.pending.discards = {};
        P.forEach((pl, i) => { const n = R.handSize(pl.hand); if (n >= s.config.discardLimit) s.pending.discards[i] = Math.floor(n / 2); });
        s.pending.returnPhase = 'main';
        const who = Object.keys(s.pending.discards);
        if (who.length) {
          s.phase = 'discard';
          say(`${who.map(i => `${name(+i)} must discard ${s.pending.discards[i]}`).join('. ')}.`);
        } else {
          s.phase = 'robber';
          say(`${name(p)} moves the robber.`);
        }
      } else {
        const pay = R.production(s, total);
        const lines = Object.entries(pay).map(([i, got]) => { P[i].hand = R.gain(P[i].hand, got); return `${name(+i)} collects ${list(got)}`; });
        say(lines.length ? `${lines.join('. ')}.` : 'Nothing is produced.');
        s.phase = 'main';
      }
      break;
    }
    case 'discard': {
      must(s.phase === 'discard', MSG.phase('discard', s.phase));
      const need = s.pending.discards[p];
      const cards = action.cards || {};
      must(Object.keys(cards).every(isResource), MSG.badCards);
      must(Object.values(cards).every(n => Number.isInteger(n) && n >= 0), MSG.badCards);
      must(Object.values(cards).reduce((a, b) => a + b, 0) === need, MSG.discardCount(need));
      must(R.canAfford(P[p].hand, cards), MSG.badCards);
      P[p].hand = R.pay(P[p].hand, cards);
      delete s.pending.discards[p];
      say(`${name(p)} discards ${need} card${need === 1 ? '' : 's'}.`);
      if (!Object.keys(s.pending.discards).length) { s.phase = 'robber'; say(`${name(s.current)} moves the robber.`); }
      break;
    }
    case 'moveRobber': {
      must(s.phase === 'robber', MSG.phase('move the robber', s.phase));
      const hex = s.board.hexes.find(h => h.id === action.hex);
      must(hex, 'Choose a hex on the island.');
      must(hex.id !== s.board.robber, MSG.robberSame);
      const victims = R.robberVictims(s, hex.id, p);
      const victim = action.victim ?? null;
      must(victims.length ? victims.includes(victim) : victim === null, MSG.victim);
      s.board.robber = hex.id;
      say(`${name(p)} moves the robber to a ${s.config.terrains[hex.terrain].label} hex${hex.token ? ` (${hex.token})` : ''}.`);
      if (victim !== null) {
        const pool = s.config.resources.flatMap(r => Array(P[victim].hand[r]).fill(r));
        const r = pool[rng.int(0, pool.length - 1)];
        P[victim].hand[r]--; P[p].hand[r]++;
        say(`${name(p)} takes a card from ${name(victim)}.`);
      }
      s.phase = s.pending.returnPhase;
      s.pending.returnPhase = 'main';
      break;
    }

    /* ----- building ----- */
    case 'buildRoad': {
      const free = s.phase === 'charter';
      must(s.phase === 'main' || free, MSG.phase('build', s.phase));
      must(s.config.pieces.road - P[p].built.road > 0, MSG.noPieces('road'));
      must(R.roadSpots(s, p).includes(action.edge), MSG.spot('road'));
      if (!free) { must(R.canAfford(P[p].hand, s.config.costs.road), MSG.afford('road', R.costLabel(s, s.config.costs.road))); P[p].hand = R.pay(P[p].hand, s.config.costs.road); }
      s.roads[action.edge] = p;
      P[p].built.road++;
      say(`${name(p)} builds a road${free ? ' under charter' : ''}.`);
      if (free) {
        s.freeRoads--;
        if (s.freeRoads <= 0 || !R.roadSpots(s, p).length) { s.freeRoads = 0; s.phase = 'main'; }
      }
      break;
    }
    case 'buildSettlement': {
      must(s.phase === 'main', MSG.phase('build', s.phase));
      must(s.config.pieces.settlement - P[p].built.settlement > 0, MSG.noPieces('settlement'));
      must(R.settlementSpots(s, p).includes(action.vertex), MSG.spot('settlement'));
      must(R.canAfford(P[p].hand, s.config.costs.settlement), MSG.afford('settlement', R.costLabel(s, s.config.costs.settlement)));
      P[p].hand = R.pay(P[p].hand, s.config.costs.settlement);
      s.buildings[action.vertex] = { player: p, kind: 'settlement' };
      P[p].built.settlement++;
      say(`${name(p)} builds a settlement.`);
      break;
    }
    case 'buildCity': {
      must(s.phase === 'main', MSG.phase('build', s.phase));
      must(s.config.pieces.city - P[p].built.city > 0, MSG.noPieces('city'));
      must(R.citySpots(s, p).includes(action.vertex), 'A city replaces one of your settlements.');
      must(R.canAfford(P[p].hand, s.config.costs.city), MSG.afford('city', R.costLabel(s, s.config.costs.city)));
      P[p].hand = R.pay(P[p].hand, s.config.costs.city);
      s.buildings[action.vertex] = { player: p, kind: 'city' };
      P[p].built.city++; P[p].built.settlement--;
      say(`${name(p)} upgrades a settlement to a city.`);
      break;
    }

    /* ----- cards ----- */
    case 'buyCard': {
      must(s.phase === 'main', MSG.phase('buy a card', s.phase));
      must(s.deck.length > 0, MSG.deckEmpty);
      must(R.canAfford(P[p].hand, s.config.costs.card), MSG.afford('card', R.costLabel(s, s.config.costs.card)));
      P[p].hand = R.pay(P[p].hand, s.config.costs.card);
      P[p].cards.push({ type: s.deck.pop(), turn: s.turn });
      say(`${name(p)} buys a card.`);
      break;
    }
    case 'playCard': {
      const def = s.config.cards[action.card];
      must(def && action.card !== 'monument', 'Choose a card you can play.');
      must(action.card === 'privateer' ? ['roll', 'main'].includes(s.phase) : s.phase === 'main', MSG.phase(`play a ${def.label}`, s.phase));
      must(!s.cardPlayed, MSG.oneCard);
      const owned = P[p].cards.filter(c => c.type === action.card);
      must(owned.length, MSG.cardMissing(def.label));
      const idx = P[p].cards.findIndex(c => c.type === action.card && c.turn < s.turn);
      must(idx >= 0, MSG.cardNewThisTurn(def.label));
      if (action.card === 'windfall') {
        const rs = action.resources;
        must(Array.isArray(rs) && rs.length === 2 && rs.every(isResource), 'Choose 2 resources.');
      }
      if (action.card === 'embargo') must(isResource(action.resource), MSG.resource(action.resource));
      P[p].cards.splice(idx, 1);
      P[p].played[action.card]++;
      s.cardPlayed = true;
      say(`${name(p)} plays ${def.label}.`);
      if (action.card === 'privateer') { s.pending.returnPhase = s.phase; s.phase = 'robber'; }
      if (action.card === 'charter') {
        s.freeRoads = Math.min(2, s.config.pieces.road - P[p].built.road);
        if (s.freeRoads > 0 && R.roadSpots(s, p).length) s.phase = 'charter';
        else { s.freeRoads = 0; say('There is nowhere to build a road.'); }
      }
      if (action.card === 'windfall') {
        const got = {};
        for (const r of action.resources) got[r] = (got[r] || 0) + 1;
        P[p].hand = R.gain(P[p].hand, got);
        say(`${name(p)} takes ${list(got)} from the bank.`);
      }
      if (action.card === 'embargo') {
        let total = 0;
        P.forEach((pl, i) => { if (i !== p) { total += pl.hand[action.resource]; pl.hand[action.resource] = 0; } });
        P[p].hand[action.resource] += total;
        say(`Every other player hands over their ${label(action.resource)}: ${total} in all.`);
      }
      break;
    }
    case 'finishCharter':
      must(s.phase === 'charter', MSG.phase('finish the charter', s.phase));
      s.freeRoads = 0; s.phase = 'main';
      break;

    /* ----- trade ----- */
    case 'maritimeTrade': {
      must(s.phase === 'main', MSG.phase('trade', s.phase));
      must(isResource(action.give) && isResource(action.get), MSG.resource(isResource(action.give) ? action.get : action.give));
      must(action.give !== action.get, MSG.tradeSame);
      const rate = R.tradeRate(s, p, action.give);
      must(P[p].hand[action.give] >= rate, MSG.rate(rate, label(action.give)));
      P[p].hand = R.gain(R.pay(P[p].hand, { [action.give]: rate }), { [action.get]: 1 });
      say(`${name(p)} trades ${rate} ${label(action.give)} for 1 ${label(action.get)} at ${rate}:1.`);
      break;
    }
    case 'proposeTrade': {
      must(s.phase === 'main', MSG.phase('trade', s.phase));
      must(Number.isInteger(action.to) && action.to !== p && P[action.to], MSG.tradeTarget);
      const ok = c => c && Object.keys(c).every(isResource) && Object.values(c).every(n => Number.isInteger(n) && n >= 0);
      must(ok(action.give) && ok(action.get), MSG.badCards);
      const give = Object.fromEntries(Object.entries(action.give).filter(([, n]) => n > 0));
      const get = Object.fromEntries(Object.entries(action.get).filter(([, n]) => n > 0));
      must(Object.keys(give).length && Object.keys(get).length, MSG.tradeShape);
      must(R.canAfford(P[p].hand, give), MSG.badCards);
      s.trade = { from: p, to: action.to, give, get };
      s.phase = 'trade';
      say(`${name(p)} offers ${name(action.to)} ${list(give)} for ${list(get)}.`);
      break;
    }
    case 'respondTrade': {
      must(s.phase === 'trade', MSG.phase('answer a trade', s.phase));
      const t = s.trade;
      if (action.accept) {
        must(R.canAfford(P[t.to].hand, t.get), MSG.theyCant(name(t.to)));
        must(R.canAfford(P[t.from].hand, t.give), MSG.theyCant(name(t.from)));
        P[t.from].hand = R.gain(R.pay(P[t.from].hand, t.give), t.get);
        P[t.to].hand = R.gain(R.pay(P[t.to].hand, t.get), t.give);
        say(`${name(t.to)} accepts the trade.`);
      } else say(`${name(t.to)} declines the trade.`);
      s.trade = null; s.phase = 'main';
      break;
    }

    /* ----- turn ----- */
    case 'endTurn': {
      must(s.phase === 'main', MSG.phase('end the turn', s.phase));
      s.current = (s.current + 1) % P.length;
      s.turn++; s.phase = 'roll'; s.dice = null; s.cardPlayed = false;
      say(`It's ${name(s.current)}'s turn.`);
      break;
    }
    default: throw new Error(MSG.unknown(action.type));
  }

  s.rng = rng.position;
  updateAwards(s, say, name);
  // A player wins only on their own turn: check the turn owner after every action, including at the start of a turn.
  if (s.phase !== 'setup' && s.phase !== 'over') {
    const pts = R.totalPoints(s, s.current);
    if (pts >= s.config.victoryTarget) {
      s.winner = s.current; s.phase = 'over';
      const hidden = R.hiddenPoints(s, s.current);
      say(`${name(s.current)} wins with ${pts} victory points${hidden ? `, including ${hidden} from Monuments` : ''}.`);
    }
  }
  s.history.push(clone(action));
  return s;
}

function updateAwards(s, say, name) {
  const next = R.computeAwards(s);
  for (const k of Object.keys(next)) {
    const a = s.awards[k], b = next[k], lab = s.config.awards[k].label;
    if ((a?.player ?? null) !== (b?.player ?? null)) {
      if (b) say(`${name(b.player)} takes ${lab} (${b.value}).`);
      else say(`Nobody holds ${lab} now.`);
    }
  }
  s.awards = next;
}

/** Legal actions for the player who must act. Discards, trades and some cards come back as templates to fill in. */
export function legalActions(state) {
  const p = actorOf(state);
  if (p === null) return [];
  const s = state, hand = s.players[p].hand, costs = s.config.costs;
  const out = [];
  switch (s.phase) {
    case 'setup':
      if (s.setup.step === 'settlement') for (const v of R.settlementSpots(s, p, { setup: true })) out.push(A.placeSettlement(p, v));
      else for (const e of R.roadSpots(s, p, { from: s.setup.lastSettlement })) out.push(A.placeRoad(p, e));
      return out;
    case 'discard':
      return [{ type: 'discard', player: p, template: true, count: s.pending.discards[p] }];
    case 'robber':
      for (const h of s.board.hexes) {
        if (h.id === s.board.robber) continue;
        const v = R.robberVictims(s, h.id, p);
        if (!v.length) out.push(A.moveRobber(p, h.id, null));
        else for (const victim of v) out.push(A.moveRobber(p, h.id, victim));
      }
      return out;
    case 'trade':
      return R.canAfford(hand, s.trade.get) ? [A.respondTrade(p, true), A.respondTrade(p, false)] : [A.respondTrade(p, false)];
    case 'charter':
      for (const e of R.roadSpots(s, p)) out.push(A.buildRoad(p, e));
      out.push(A.finishCharter(p));
      return out;
    case 'roll':
      out.push(A.roll(p));
      if (playable(s, p, 'privateer')) out.push(A.playCard(p, 'privateer'));
      return out;
    case 'main': {
      if (R.canAfford(hand, costs.road)) for (const e of R.roadSpots(s, p)) out.push(A.buildRoad(p, e));
      if (R.canAfford(hand, costs.settlement)) for (const v of R.settlementSpots(s, p)) out.push(A.buildSettlement(p, v));
      if (R.canAfford(hand, costs.city)) for (const v of R.citySpots(s, p)) out.push(A.buildCity(p, v));
      if (s.deck.length && R.canAfford(hand, costs.card)) out.push(A.buyCard(p));
      for (const c of ['privateer', 'charter']) if (playable(s, p, c)) out.push(A.playCard(p, c));
      if (playable(s, p, 'windfall')) out.push({ type: 'playCard', player: p, card: 'windfall', template: true, choose: 2 });
      if (playable(s, p, 'embargo')) for (const r of s.config.resources) out.push(A.playCard(p, 'embargo', { resource: r }));
      for (const give of s.config.resources) {
        if (hand[give] < R.tradeRate(s, p, give)) continue;
        for (const get of s.config.resources) if (get !== give) out.push(A.maritimeTrade(p, give, get));
      }
      if (R.handSize(hand) > 0) out.push({ type: 'proposeTrade', player: p, template: true });
      out.push(A.endTurn(p));
      return out;
    }
    default: return out;
  }
}

export function playable(state, p, type) {
  if (state.cardPlayed || type === 'monument') return false;
  if (type === 'privateer' ? !['roll', 'main'].includes(state.phase) : state.phase !== 'main') return false;
  return state.players[p].cards.some(c => c.type === type && c.turn < state.turn);
}

/** Replays a game from its seed and action history. Used for checks and, later, network sync. */
export function replay(config, seed, names, actions) {
  return actions.reduce((s, a) => applyAction(s, a), createGame(config, seed, names));
}
