// Tests. Browser: index.html?test (includes the layout test). Node: node game-islands/js/tests.js
import { createRng, rollDice, step } from './rng.js';
import { generateBoard } from './board.js';
import { createGame, applyAction, legalActions, actorOf, replay } from './state.js';
import * as R from './rules.js';
import { A } from './actions.js';

const NAMES = ['Isla', 'Corin', 'Wren'];

/** Searches rng positions for one whose next roll totals `total`. Keeps tests on the real dice path. */
export function positionFor(total, from = 1) {
  for (let pos = from; pos < from + 100000; pos++) { const r = rollDice(pos).dice; if (r[0] + r[1] === total) return pos; }
  throw new Error('no position found');
}

/** A seeded bot: picks legal actions and fills templates. Used to drive games in tests. */
export function botAction(state, rng) {
  const acts = legalActions(state);
  const pri = acts.filter(a => !['endTurn', 'proposeTrade', 'maritimeTrade'].includes(a.type));
  let a = pri.length && rng.next() < 0.85 ? rng.pick(pri) : rng.pick(acts);
  if (!a.template) return a;
  const hand = state.players[a.player].hand, res = state.config.resources;
  if (a.type === 'discard') {
    const cards = {};
    for (const r of rng.shuffle(res.flatMap(r => Array(hand[r]).fill(r))).slice(0, a.count)) cards[r] = (cards[r] || 0) + 1;
    return { type: 'discard', player: a.player, cards };
  }
  if (a.card === 'windfall') return A.playCard(a.player, 'windfall', { resources: [rng.pick(res), rng.pick(res)] });
  const give = res.find(r => hand[r] > 0);
  return A.proposeTrade(a.player, (a.player + 1) % state.players.length, { [give]: 1 }, { [rng.pick(res.filter(r => r !== give))]: 1 });
}
export function playBot(config, seed, steps, names = NAMES) {
  const rng = createRng(`bot:${seed}`);
  let s = createGame(config, seed, names);
  const states = [s];
  for (let i = 0; i < steps && s.phase !== 'over'; i++) { s = applyAction(s, botAction(s, rng)); states.push(s); }
  return { state: s, states };
}

function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
function plainJsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b) ? false : a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => plainJsonEqual(a[k], b[k]));
}
const pct = x => `${(x * 100).toFixed(2)}%`;

export function runTests(config) {
  const results = [];
  const add = (name, pass, details) => results.push({ name, pass: !!pass, details });
  const tryTest = (name, fn) => { try { fn(); } catch (err) { add(name, false, `Threw: ${err.message}`); } };

  tryTest('1. RNG: same seed, same numbers; different seeds differ', () => {
    const seq = seed => { const r = createRng(seed); return Array.from({ length: 50 }, () => r.next()); };
    const same = JSON.stringify(seq('alpha')) === JSON.stringify(seq('alpha'));
    const differ = JSON.stringify(seq('alpha')) !== JSON.stringify(seq('beta')) && JSON.stringify(seq(1)) !== JSON.stringify(seq(2));
    const range = seq('gamma').every(v => v >= 0 && v < 1);
    const pure = step(12345).value === step(12345).value;
    add('1. RNG: same seed, same numbers; different seeds differ', same && differ && range && pure, `Same seed matches: ${same}. Different seeds differ: ${differ}. Values in [0, 1): ${range}. step() is pure: ${pure}.`);
  });

  tryTest('2. Board: 19 land hexes, one desert, no adjacent 6/8 (1000 seeds)', () => {
    const problems = [];
    let fallbacks = 0, maxAttempts = 0;
    const tokensWanted = JSON.stringify([...config.numberTokens].sort((a, b) => a - b));
    for (let i = 0; i < 1000 && problems.length < 5; i++) {
      const { board } = generateBoard(config, `board:${i}`);
      const tag = `seed ${i}`;
      if (board.hexes.length !== 19) problems.push(`${tag}: ${board.hexes.length} hexes`);
      const barrens = board.hexes.filter(h => h.terrain === 'barrens');
      if (barrens.length !== 1) problems.push(`${tag}: ${barrens.length} desert hexes`);
      if (board.robber !== barrens[0]?.id) problems.push(`${tag}: robber not on the Barrens`);
      if (barrens[0]?.token != null) problems.push(`${tag}: the Barrens has a token`);
      const byId = Object.fromEntries(board.hexes.map(h => [h.id, h]));
      for (const h of board.hexes) if ([6, 8].includes(h.token) && h.neighbors.some(n => [6, 8].includes(byId[n].token))) problems.push(`${tag}: 6/8 adjacent at ${h.id}`);
      if (JSON.stringify(board.hexes.map(h => h.token).filter(t => t != null).sort((a, b) => a - b)) !== tokensWanted) problems.push(`${tag}: wrong tokens`);
      const hv = board.harbors.flatMap(h => h.vertices);
      if (board.harbors.length !== 9 || new Set(hv).size !== hv.length) problems.push(`${tag}: harbors share a vertex`);
      for (const t of Object.keys(config.terrains)) if (board.hexes.filter(h => h.terrain === t).length !== config.terrains[t].count) problems.push(`${tag}: ${t} count`);
      if (board.tokenAttempts > config.tokenShuffleAttempts) fallbacks++;
      maxAttempts = Math.max(maxAttempts, board.tokenAttempts);
    }
    add('2. Board: 19 land hexes, one desert, no adjacent 6/8 (1000 seeds)', !problems.length, problems.length ? problems.join('; ')
      : `All 1000 boards: 19 land hexes, terrain counts as configured, one Barrens holding the robber, 18 tokens, no 6 or 8 side by side, 9 harbors with no shared vertex. Most shuffles needed: ${maxAttempts}. Fallback used: ${fallbacks} times.`);
  });

  tryTest('3. Production: a known board and roll pay the right amounts', () => {
    let s = createGame(config, 'production', NAMES);
    const hex = s.board.hexes.find(h => h.token === 2) || s.board.hexes.find(h => h.token === 12);
    const total = hex.token;
    const res = config.terrains[hex.terrain].resource;
    const [v0, , v2] = hex.vertices;
    s = JSON.parse(JSON.stringify(s));
    Object.assign(s, { phase: 'roll', current: 0, turn: 1, buildings: { [v0]: { player: 0, kind: 'settlement' }, [v2]: { player: 1, kind: 'city' } } });
    s.board.robber = s.board.hexes.find(h => h.id !== hex.id && h.token !== total).id;
    const expected = { 0: { [res]: 1 }, 1: { [res]: 2 } };
    const direct = R.production(s, total);
    s.rng = positionFor(total);
    const after = applyAction(s, A.roll(0));
    const got = [0, 1, 2].map(i => after.players[i].hand[res]);
    const robbed = JSON.parse(JSON.stringify(s)); robbed.board.robber = hex.id;
    const blocked = R.production(robbed, total);
    const ok = plainJsonEqual(direct, expected) && got.join() === '1,2,0' && Object.keys(blocked).length === 0;
    add('3. Production: a known board and roll pay the right amounts', ok,
      `Roll ${total} on a ${config.terrains[hex.terrain].label} hex: settlement gets 1, city gets 2, neighbour without a building gets 0 → ${got.join(', ')}. With the robber on that hex: ${Object.keys(blocked).length ? 'paid' : 'nothing paid'}.`);
  });

  tryTest('4. Robber: a 7 forces discards at 8+ cards and moves the robber', () => {
    let s = JSON.parse(JSON.stringify(createGame(config, 'robber', NAMES)));
    const target = s.board.hexes.find(h => h.id !== s.board.robber && h.token);
    s.phase = 'roll'; s.current = 0; s.turn = 1;
    s.buildings = { [target.vertices[0]]: { player: 1, kind: 'settlement' } };
    const hand = n => { const h = R.emptyHand(config.resources); for (let i = 0; i < n; i++) h[config.resources[i % 5]]++; return h; };
    s.players[0].hand = hand(9); s.players[1].hand = hand(8); s.players[2].hand = hand(7);
    s.rng = positionFor(7);
    let t = applyAction(s, A.roll(0));
    const problems = [];
    if (t.phase !== 'discard' || t.pending.discards[0] !== 4 || t.pending.discards[1] !== 4 || 2 in t.pending.discards) problems.push(`pending ${JSON.stringify(t.pending.discards)}`);
    let threw = false;
    try { applyAction(t, A.discard(0, { timber: 1 })); } catch { threw = true; }
    if (!threw) problems.push('wrong discard count accepted');
    t = applyAction(t, A.discard(1, { timber: 2, clay: 2 }));
    t = applyAction(t, A.discard(0, { timber: 2, clay: 2 }));
    if (t.phase !== 'robber') problems.push(`phase after discards: ${t.phase}`);
    const before = R.handSize(t.players[1].hand);
    t = applyAction(t, A.moveRobber(0, target.id, 1));
    if (t.board.robber !== target.id) problems.push('robber did not move');
    if (R.handSize(t.players[1].hand) !== before - 1 || R.handSize(t.players[0].hand) !== 6) problems.push('no card stolen');
    if (t.phase !== 'main') problems.push(`phase after robber: ${t.phase}`);
    add('4. Robber: a 7 forces discards at 8+ cards and moves the robber', !problems.length, problems.length ? problems.join('; ')
      : 'Players with 9 and 8 cards each discard 4; the player with 7 keeps them. A wrong count is refused. The robber moves and one card changes hands.');
  });

  tryTest('5. Victory: 10 on your own turn wins; on another turn it does not', () => {
    const s = JSON.parse(JSON.stringify(createGame(config, 'victory', NAMES)));
    s.phase = 'main'; s.current = 0; s.turn = 5;
    const vs = Object.keys(s.board.vertices).sort();
    const B = {};
    [0, 2, 4].forEach(i => { B[vs[i * 6]] = { player: 0, kind: 'city' }; });
    [1, 3, 5].forEach(i => { B[vs[i * 6]] = { player: 0, kind: 'settlement' }; });
    s.buildings = B; s.players[0].built = { road: 0, settlement: 3, city: 3 };
    s.players[0].hand = { ...R.emptyHand(config.resources), ...config.costs.city };
    const nine = R.totalPoints(s, 0);
    const won = applyAction(s, A.buildCity(0, vs[6]));
    // Player 1 reaches 10 during player 0's turn: no win until player 1's own turn starts.
    const o = JSON.parse(JSON.stringify(s));
    o.buildings = {}; [0, 1, 2, 3, 4].forEach(i => { o.buildings[vs[40 + i * 2]] = { player: 1, kind: 'city' }; });
    o.players[0].hand = R.emptyHand(config.resources);
    const stillPlaying = applyAction(o, A.endTurn(0));
    const midTurn = (() => { const m = JSON.parse(JSON.stringify(o)); m.players[0].hand.timber = 4; return applyAction(m, A.maritimeTrade(0, 'timber', 'clay')); })();
    const ok = nine === 9 && won.winner === 0 && won.phase === 'over' && midTurn.winner === null && stillPlaying.winner === 1;
    add('5. Victory: 10 on your own turn wins; on another turn it does not', ok,
      `Player at ${nine} builds a city on their turn → winner ${won.winner}. Another player sitting at 10 during someone else's turn → winner ${midTurn.winner} after that turn's action; when their own turn starts → winner ${stillPlaying.winner}.`);
  });

  tryTest('6. Immutability: applyAction never changes its input', () => {
    const { states } = playBot(config, 'immutable', 250);
    const problems = [];
    let checked = 0;
    const rng = createRng('imm');
    for (const s of states.filter((_, i) => i % 5 === 0)) {
      if (s.phase === 'over') continue;
      const before = JSON.stringify(s);
      const frozen = deepFreeze(JSON.parse(before));
      try { applyAction(frozen, botAction(frozen, rng)); } catch (e) { if (/read.only|frozen|not extensible|Cannot (assign|add|delete)/i.test(e.message)) problems.push(e.message); }
      if (JSON.stringify(frozen) !== before) problems.push('input changed');
      checked++;
    }
    add('6. Immutability: applyAction never changes its input', !problems.length, problems.length ? problems.slice(0, 3).join('; ')
      : `${checked} states from a seeded game were deep-frozen and acted on: no write was attempted and every input is byte-identical afterwards.`);
  });

  tryTest('7. Serialization: state and actions round-trip through JSON', () => {
    const { state, states } = playBot(config, 'json', 400);
    const problems = [];
    for (const s of states) if (!plainJsonEqual(JSON.parse(JSON.stringify(s)), s)) { problems.push(`state at step ${s.history.length} changed`); break; }
    for (const a of state.history) if (!plainJsonEqual(JSON.parse(JSON.stringify(a)), a)) { problems.push('an action changed'); break; }
    const replayed = replay(config, 'json', NAMES, JSON.parse(JSON.stringify(state.history)));
    if (JSON.stringify(replayed) !== JSON.stringify(state)) problems.push('replay from the history differs');
    add('7. Serialization: state and actions round-trip through JSON', !problems.length, problems.length ? problems.join('; ')
      : `${states.length} states and ${state.history.length} actions survive JSON unchanged. Replaying the history from the seed rebuilds the exact same state.`);
  });

  tryTest('8. Fairness: 10,000 rolls match 2d6 within ±1 percentage point', () => {
    const counts = {};
    let pos = 1;
    for (let i = 0; i < 10000; i++) { const r = rollDice(pos); pos = r.position; const t = r.dice[0] + r.dice[1]; counts[t] = (counts[t] || 0) + 1; }
    const rows = Object.entries(R.DICE_PROBABILITY).map(([t, p]) => ({ t, p, got: (counts[t] || 0) / 10000 }));
    const worst = Math.max(...rows.map(r => Math.abs(r.got - r.p)));
    add('8. Fairness: 10,000 rolls match 2d6 within ±1 percentage point', worst <= 0.01,
      `Worst gap ${(worst * 100).toFixed(2)} pp. ${rows.map(r => `${r.t}: ${pct(r.got)} vs ${pct(r.p)}`).join(', ')}.`);
  });

  return results;
}

/* ---------- Test 9: layout (browser only) ---------- */
const overlap = (a, b, pad = 0) => a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

/** Every focusable element must match a :focus-visible rule. SVG controls need their own rule (outline alone does not draw on SVG shapes). */
export function focusStyleGaps(doc) {
  const rules = [];
  const walk = list => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText?.includes(':focus-visible')) rules.push(...r.selectorText.split(',').filter(x => x.includes(':focus-visible')).map(x => x.trim())); } };
  for (const sh of doc.styleSheets) { try { walk(sh.cssRules); } catch { /* cross-origin font sheet */ } }
  // ".hex:focus-visible .hex-ring" styles a focused ".hex"; a bare ":focus-visible" is universal.
  const base = rules.map(sel => {
    const head = sel.slice(0, sel.indexOf(':focus-visible')).trim();
    const universal = !head || /[\s>+~]$/.test(sel.slice(0, sel.indexOf(':focus-visible')));
    return { base: universal ? `${head} *`.trim() : head, universal };
  });
  const els = [...doc.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')];
  const gaps = [];
  for (const el of els) {
    const isSvg = el instanceof doc.defaultView.SVGElement;
    const ok = base.some(b => { if (isSvg && b.universal) return false; try { return el.matches(b.base); } catch { return false; } });
    if (!ok) gaps.push(el.id || el.getAttribute('class') || el.tagName);
  }
  return { checked: els.length, gaps };
}

async function frameAt(w, hgt) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${hgt}px;border:0;`;
  frame.src = 'index.html?seed=layout-check&names=Isla,Corin,Wren,Bram,Juno&ready=1';
  document.body.append(frame);
  await new Promise(res => frame.addEventListener('load', res, { once: true }));
  const doc = frame.contentDocument;
  for (let i = 0; i < 200 && !doc.querySelector('#hexes .hex'); i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 150));
  return frame;
}

export async function layoutTest() {
  const name = '9. Layout at 1280 x 800 and 390 x 844, focus styles';
  const problems = [], notes = [];
  for (const [w, hgt] of [[1280, 800], [390, 844]]) {
    const frame = await frameAt(w, hgt);
    const doc = frame.contentDocument, win = frame.contentWindow;
    const tag = `${w}x${hgt}`;
    const board = doc.getElementById('board').getBoundingClientRect();
    const panel = doc.getElementById('panel').getBoundingClientRect();
    if (doc.documentElement.scrollWidth > win.innerWidth + 1) problems.push(`${tag}: page scrolls sideways`);
    if (w >= 1000) {
      if (doc.documentElement.scrollHeight > win.innerHeight + 1) problems.push(`${tag}: page scrolls`);
      if (overlap(board, panel)) problems.push(`${tag}: board overlaps the panel`);
      if (board.bottom > win.innerHeight + 1 || board.right > win.innerWidth + 1) problems.push(`${tag}: board leaves the viewport`);
      if (Math.abs(panel.width - 320) > 2) problems.push(`${tag}: panel is ${panel.width}px wide`);
    } else {
      if (panel.top < board.bottom - 1) problems.push(`${tag}: panel is not below the board`);
      for (const b of doc.querySelectorAll('#app button')) if (visible(b)) { const r = b.getBoundingClientRect(); if (r.height < 44 || r.width < 44) problems.push(`${tag}: button "${b.textContent.trim()}" is ${Math.round(r.width)}x${Math.round(r.height)}`); }
    }
    // Board pieces: tokens, harbors and icons never overlap each other
    const marks = [...doc.querySelectorAll('.token-disc, .harbor-badge')].map(e => e.getBoundingClientRect());
    let hits = 0;
    for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) if (overlap(marks[i], marks[j], 0.5)) hits++;
    if (hits) problems.push(`${tag}: ${hits} board labels overlap`);
    const hexes = [...doc.querySelectorAll('.hex-fill')].map(e => e.getBoundingClientRect());
    const size = Math.min(...hexes.map(r => r.width));
    if (size < 30) problems.push(`${tag}: hexes are only ${Math.round(size)}px wide`);
    // Panel sections never overlap each other
    const secs = [...doc.querySelectorAll('#panel > *')].filter(visible).map(e => e.getBoundingClientRect());
    for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) if (overlap(secs[i], secs[j], 0.5)) problems.push(`${tag}: panel sections ${i} and ${j} overlap`);
    const focus = focusStyleGaps(doc);
    if (focus.gaps.length) problems.push(`${tag}: no focus style for ${[...new Set(focus.gaps)].slice(0, 5).join(', ')}`);
    notes.push(`${tag}: board ${Math.round(board.width)}x${Math.round(board.height)}, hexes ${Math.round(size)}px, ${marks.length} labels clear, ${focus.checked} focusable elements styled`);
    frame.remove();
  }
  return { name, pass: !problems.length, details: problems.length ? problems.join('; ') : `${notes.join('. ')}. No sideways scroll; desktop fits without scrolling; phone panel sits below the board with buttons at least 44px.` };
}

/* ---------- Node entry ---------- */
if (typeof window === 'undefined' && typeof process !== 'undefined' && process.argv?.[1]?.endsWith('tests.js')) {
  const { readFileSync } = await import('node:fs');
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
  const config = { ...load('config'), costs: load('costs') };
  const results = runTests(config);
  results.push({ name: '9. Layout at 1280 x 800 and 390 x 844, focus styles', pass: true, details: 'Browser only: open index.html?test.', browserOnly: true });
  for (const r of results) console.log(`${r.browserOnly ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.details}`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
}
