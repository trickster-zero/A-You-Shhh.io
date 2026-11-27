// Pure rule functions. They read a state and return answers; none of them change it.

export const resourcesOf = state => state.config.resources;
export const emptyHand = resources => Object.fromEntries(resources.map(r => [r, 0]));
export const handSize = hand => Object.values(hand).reduce((a, b) => a + b, 0);

export function canAfford(hand, cost) { return Object.entries(cost).every(([r, n]) => (hand[r] || 0) >= n); }
export function pay(hand, cost) {
  const h = { ...hand };
  for (const [r, n] of Object.entries(cost)) h[r] -= n;
  return h;
}
export function gain(hand, add) {
  const h = { ...hand };
  for (const [r, n] of Object.entries(add)) h[r] = (h[r] || 0) + n;
  return h;
}
export function costLabel(state, cost) {
  return Object.entries(cost).map(([r, n]) => `${n} ${state.config.terrains[r]?.label || r}`).join(', ');
}

/* ---------- board queries ---------- */
export const buildingAt = (state, v) => state.buildings[v] || null;
export const roadOwner = (state, e) => (e in state.roads ? state.roads[e] : null);
const vertex = (state, v) => state.board.vertices[v];
const edge = (state, e) => state.board.edges[e];
const piecesLeft = (state, p, kind) => state.config.pieces[kind] - state.players[p].built[kind];

/** Distance rule: the vertex and its neighbours must be empty. */
export function distanceOk(state, v) {
  if (buildingAt(state, v)) return false;
  return vertex(state, v).adj.every(n => !buildingAt(state, n));
}

export function settlementSpots(state, p, { setup = false } = {}) {
  if (piecesLeft(state, p, 'settlement') <= 0) return [];
  return Object.keys(state.board.vertices).filter(v =>
    distanceOk(state, v) && (setup || vertex(state, v).edges.some(e => roadOwner(state, e) === p))
  ).sort();
}

export function roadSpots(state, p, { from = null } = {}) {
  if (piecesLeft(state, p, 'road') <= 0) return [];
  return Object.values(state.board.edges).filter(e => {
    if (roadOwner(state, e.id) !== null) return false;
    if (from) return e.a === from || e.b === from;
    return [e.a, e.b].some(v => {
      const b = buildingAt(state, v);
      if (b && b.player === p) return true;
      if (b && b.player !== p) return false;                  // an opponent's building blocks the way through
      return vertex(state, v).edges.some(x => x !== e.id && roadOwner(state, x) === p);
    });
  }).map(e => e.id).sort();
}

export function citySpots(state, p) {
  if (piecesLeft(state, p, 'city') <= 0) return [];
  return Object.entries(state.buildings).filter(([, b]) => b.player === p && b.kind === 'settlement').map(([v]) => v).sort();
}

/** Payouts for a roll: { playerIndex: { resource: n } }. The robber's hex pays nothing. */
export function production(state, total) {
  const out = {};
  for (const h of state.board.hexes) {
    if (h.token !== total || h.id === state.board.robber) continue;
    const res = state.config.terrains[h.terrain].resource;
    if (!res) continue;
    for (const v of h.vertices) {
      const b = buildingAt(state, v);
      if (!b) continue;
      out[b.player] ||= {};
      out[b.player][res] = (out[b.player][res] || 0) + (b.kind === 'city' ? 2 : 1);
    }
  }
  return out;
}

/** Players who could be robbed at this hex: a building beside it and at least one card. */
export function robberVictims(state, hexId, roller) {
  const h = state.board.hexes.find(x => x.id === hexId);
  const set = new Set();
  for (const v of h.vertices) {
    const b = buildingAt(state, v);
    if (b && b.player !== roller && handSize(state.players[b.player].hand) > 0) set.add(b.player);
  }
  return [...set].sort((a, b) => a - b);
}

/* ---------- trade ---------- */
export function harborsHeld(state, p) {
  return state.board.harbors.filter(h => h.vertices.some(v => buildingAt(state, v)?.player === p));
}
export function tradeRate(state, p, res) {
  let rate = state.config.harbors.bankRate;
  for (const h of harborsHeld(state, p)) if (h.kind === 'any' || h.kind === res) rate = Math.min(rate, h.rate);
  return rate;
}

/* ---------- longest road ---------- */
/** Longest chain of the player's roads, each segment used once. An opponent's building cuts the chain. */
export function longestRoad(state, p) {
  const mine = Object.entries(state.roads).filter(([, o]) => o === p).map(([e]) => e);
  if (!mine.length) return 0;
  const blocked = v => { const b = buildingAt(state, v); return b && b.player !== p; };
  let best = 0;
  const walk = (v, used, len) => {
    best = Math.max(best, len);
    if (blocked(v)) return;
    for (const e of vertex(state, v).edges) {
      if (used.has(e) || roadOwner(state, e) !== p) continue;
      const ed = edge(state, e);
      used.add(e);
      walk(ed.a === v ? ed.b : ed.a, used, len + 1);
      used.delete(e);
    }
  };
  for (const e of mine) {
    const ed = edge(state, e);
    for (const start of [ed.a, ed.b]) {
      const used = new Set([e]);
      walk(start === ed.a ? ed.b : ed.a, used, 1);
    }
  }
  return best;
}

/**
 * Awards that pass between players: { longestRoad, harborMastery, largestFleet }, each { player, value } or null.
 * Rules: you must reach the minimum; the holder keeps it on a tie; it passes only to a strictly higher value.
 * If the holder drops (a road is cut) and the others tie for top, nobody holds it.
 */
export function computeAwards(state) {
  const n = state.players.length;
  const A = state.config.awards;
  const values = {
    longestRoad: state.players.map((_, p) => longestRoad(state, p)),
    harborMastery: state.players.map((_, p) => harborsHeld(state, p).length),
    largestFleet: state.players.map(pl => pl.played.privateer || 0)
  };
  const next = {};
  for (const k of Object.keys(values)) {
    const v = values[k], min = A[k].minimum, cur = state.awards[k];
    const top = Math.max(...v);
    const leaders = [...Array(n).keys()].filter(p => v[p] === top);
    if (top < min) { next[k] = null; continue; }
    if (cur && v[cur.player] === top) { next[k] = { player: cur.player, value: top }; continue; }
    next[k] = leaders.length === 1 ? { player: leaders[0], value: top } : null;
  }
  return next;
}

/* ---------- points ---------- */
export function publicPoints(state, p) {
  const P = state.config.points, A = state.config.awards;
  let pts = 0;
  for (const b of Object.values(state.buildings)) if (b.player === p) pts += b.kind === 'city' ? P.city : P.settlement;
  for (const k of Object.keys(A)) if (state.awards[k]?.player === p) pts += A[k].points;
  return pts;
}
export const hiddenPoints = (state, p) => state.players[p].cards.filter(c => c.type === 'monument').length * state.config.points.monument;
export const totalPoints = (state, p) => publicPoints(state, p) + hiddenPoints(state, p);

/* ---------- dice ---------- */
export const DICE_PROBABILITY = Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(t => [t, (6 - Math.abs(7 - t)) / 36]));
export const pips = token => (token ? 6 - Math.abs(7 - token) : 0);
