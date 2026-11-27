// Hot-seat UI. Everything the game decides comes from the engine; this file only draws and collects input.
import { createGame, applyAction, legalActions, actorOf, replay, playable } from './state.js';
import * as R from './rules.js';
import { A } from './actions.js';
import { hexCorners, seaHexes } from './board.js';

const S = 56;                       // pixels per hex unit
const SVGNS = 'http://www.w3.org/2000/svg';
const SAVE_KEY = 'islands.save.v1';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* ---------- small DOM helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  setAttrs(e, attrs);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}
function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  setAttrs(e, attrs);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function setAttrs(e, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.setAttribute('class', v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
}
const f = n => Math.round(n * 100) / 100;

/* ---------- assets: draw a plain fallback when a file is missing ---------- */
const ASSETS = ['texture-parchment', 'texture-sea', 'icon-timber', 'icon-clay', 'icon-fleece', 'icon-grain', 'icon-iron', 'icon-barrens', 'piece-settlement', 'piece-city', 'piece-road'];
const have = {};
function checkAssets() {
  return Promise.all(ASSETS.map(name => new Promise(done => {
    const img = new Image();
    img.onload = () => { have[name] = true; done(); };
    img.onerror = () => { have[name] = false; console.warn(`Missing image: images/${name}.png. Drawing a plain fallback instead.`); done(); };
    img.src = `images/${name}.png`;
  })));
}
function resIcon(res, cls = '') {
  const t = app.config.terrains[res] || {};
  return have[`icon-${res}`]
    ? h('img', { src: `images/icon-${res}.png`, alt: '', class: cls })
    : h('span', { class: `ico ${cls}`, style: `background:${t.fill}`, 'aria-hidden': 'true' });
}

/* ---------- app state ---------- */
const app = {
  config: null,
  game: null,
  names: [],
  viewer: null,        // the player whose private hand is on screen
  mode: null,          // 'road' | 'settlement' | 'city' while choosing a spot
  seen: new Set(),     // pieces already drawn, so only new ones animate
  lastDice: null,
  view: { minX: 0, minY: 0 }
};
const resLabel = r => app.config.terrains[r]?.label ?? r;
const nameOf = p => app.game.players[p].name;
const colorOf = p => app.config.colors[p].hex;
const letterOf = p => app.config.colors[p].letter;
const chip = (p, big = false) => h('span', { class: `chip${big ? ' big' : ''}`, style: `background:${colorOf(p)}`, 'aria-hidden': 'true' }, letterOf(p));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const handText = c => Object.entries(c).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${resLabel(r)}`).join(', ');

/* ---------- start ---------- */
async function init() {
  const [config, costs] = await Promise.all(['config', 'costs'].map(n => fetch(`data/${n}.json`).then(r => r.json())));
  app.config = { ...config, costs };
  app.config.colors.forEach((c, i) => document.documentElement.style.setProperty(`--p${i}`, c.hex));
  await checkAssets();
  document.body.classList.toggle('no-sea-texture', !have['texture-sea']);

  if (params.has('test')) return runTestPage();

  const names = params.get('names')?.split(',').map(x => x.trim()).filter(Boolean);
  if (names?.length) return start(params.get('seed') || 'frontier', names, { ready: params.has('ready') });
  showStart();
}

function showStart() {
  $('app').hidden = true;
  $('start').hidden = false;
  const list = $('name-list');
  const defaults = ['Isla', 'Corin', 'Wren', 'Bram', 'Juno'];
  const row = i => h('li', {}, chip(i, true), h('input', { 'aria-label': `Player ${i + 1} name`, value: defaults[i], maxlength: 18, required: true }));
  const sync = () => {
    $('add-player').disabled = list.children.length >= app.config.players.max;
    $('remove-player').disabled = list.children.length <= app.config.players.min;
  };
  list.replaceChildren(...[0, 1, 2].map(row));
  $('add-player').onclick = () => { if (list.children.length < app.config.players.max) list.append(row(list.children.length)); sync(); };
  $('remove-player').onclick = () => { if (list.children.length > app.config.players.min) list.lastElementChild.remove(); sync(); };
  sync();
  $('seed').value = params.get('seed') || `isle-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const saved = loadSave();
  $('resume').hidden = !saved;
  $('resume').onclick = () => resume(saved);
  $('start-form').onsubmit = ev => {
    ev.preventDefault();
    const names = [...list.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    start($('seed').value.trim() || 'frontier', names);
  };
  list.querySelector('input')?.focus();
}

function start(seed, names, { ready = false } = {}) {
  try { app.game = createGame(app.config, seed, names); }
  catch (err) { toast(err.message); return; }
  app.names = names; app.mode = null; app.seen = new Set(); app.lastDice = null;
  app.viewer = ready ? actorOf(app.game) : null;
  enterGame();
}
function resume(saved) {
  try { app.game = replay(app.config, saved.seed, saved.names, saved.history); }
  catch (err) { console.warn('Saved game could not be replayed:', err.message); clearSave(); toast('That saved game could not be loaded.'); return; }
  app.names = saved.names; app.mode = null; app.viewer = null; app.lastDice = JSON.stringify(app.game.dice);
  app.seen = new Set(pieceKeys(app.game));
  enterGame();
}
function enterGame() {
  $('start').hidden = true;
  $('app').hidden = false;
  buildBoard();
  update();
}

/* ---------- saving (per browser; the engine needs only seed, names and actions) ---------- */
function save() {
  try {
    if (app.game.phase === 'over') localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify({ seed: app.game.seed, names: app.names, history: app.game.history }));
  } catch { /* storage unavailable: play on without saving */ }
}
function loadSave() { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); return v?.history ? v : null; } catch { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

/* ---------- acting ---------- */
function act(action) {
  try { app.game = applyAction(app.game, action); }
  catch (err) { toast(err.message); return false; }
  app.mode = null;
  save();
  update();
  return true;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ---------- board: static layer ---------- */
function buildBoard() {
  const svg = $('board');
  const { board } = app.game;
  const sea = seaHexes(board.radius);
  const pts = sea.flatMap(x => hexCorners(x.q, x.r));
  const minX = Math.min(...pts.map(p => p.x)) * S - 4, maxX = Math.max(...pts.map(p => p.x)) * S + 4;
  const minY = Math.min(...pts.map(p => p.y)) * S - 4, maxY = Math.max(...pts.map(p => p.y)) * S + 4;
  svg.setAttribute('viewBox', `${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const defs = s('defs', {},
    s('pattern', { id: 'paper', patternUnits: 'userSpaceOnUse', width: 220, height: 220 },
      have['texture-parchment'] ? s('image', { href: 'images/texture-parchment.png', width: 220, height: 220, preserveAspectRatio: 'xMidYMid slice' }) : s('rect', { width: 220, height: 220, fill: '#e8dcc4' })),
    s('pattern', { id: 'seatex', patternUnits: 'userSpaceOnUse', width: 260, height: 260 },
      have['texture-sea'] ? s('image', { href: 'images/texture-sea.png', width: 260, height: 260, preserveAspectRatio: 'xMidYMid slice' }) : s('rect', { width: 260, height: 260, fill: '#16303f' })),
    // Soft inner shadow for hexes
    s('filter', { id: 'inner', x: '-10%', y: '-10%', width: '120%', height: '120%' },
      s('feFlood', { 'flood-color': '#000', 'flood-opacity': '.55' }),
      s('feComposite', { in2: 'SourceAlpha', operator: 'out' }),
      s('feGaussianBlur', { stdDeviation: 5 }),
      s('feOffset', { dx: 0, dy: 2 }),
      s('feComposite', { in2: 'SourceAlpha', operator: 'in', result: 'shadow' }),
      s('feMerge', {}, s('feMergeNode', { in: 'SourceGraphic' }), s('feMergeNode', { in: 'shadow' }))),
    s('linearGradient', { id: 'bevel', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.38' }),
      s('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '0' }),
      s('stop', { offset: '.5', 'stop-color': '#000', 'stop-opacity': '0' }),
      s('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.45' })),
    s('radialGradient', { id: 'token-shade', cx: '.4', cy: '.35', r: '.75' },
      s('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.25' }),
      s('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.18' })),
    // Dark outline so tinted pieces read on any terrain
    s('filter', { id: 'piece-edge', x: '-30%', y: '-30%', width: '160%', height: '160%' },
      s('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: 1.4, result: 'fat' }),
      s('feFlood', { 'flood-color': '#0a0e13', 'flood-opacity': '.9' }),
      s('feComposite', { in2: 'fat', operator: 'in', result: 'edge' }),
      s('feDropShadow', { in: 'edge', dx: 0, dy: 2, stdDeviation: 1.5, 'flood-opacity': '.6', result: 'drop' }),
      s('feMerge', {}, s('feMergeNode', { in: 'drop' }), s('feMergeNode', { in: 'SourceGraphic' }))),
    ...['settlement', 'city', 'road'].map(k => s('mask', { id: `mask-${k}`, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: -40, y: -40, width: 80, height: 80 },
      s('image', { href: `images/piece-${k}.png`, x: -PIECE[k] / 2, y: -PIECE[k] / 2, width: PIECE[k], height: PIECE[k] })))
  );

  const seaLayer = s('g', { class: 'sea-hexes', 'aria-hidden': 'true' },
    sea.map(x => s('polygon', { points: poly(hexCorners(x.q, x.r)), fill: 'url(#seatex)', 'fill-opacity': '.28', stroke: 'rgba(143,211,255,.08)', 'stroke-width': 1 })));

  const hexLayer = s('g', { id: 'hexes' }, board.hexes.map(drawHex));
  const harborLayer = s('g', { id: 'harbors', 'aria-hidden': 'true' }, board.harbors.map(drawHarbor));
  const edgeLayer = s('g', { id: 'edge-targets' }, Object.values(board.edges).map(drawEdgeTarget));
  const vertexLayer = s('g', { id: 'vertex-targets' }, Object.values(board.vertices).map(drawVertexTarget));
  svg.replaceChildren(defs, seaLayer, harborLayer, hexLayer,
    s('g', { id: 'roads', 'aria-hidden': 'true' }), s('g', { id: 'buildings', 'aria-hidden': 'true' }),
    drawRobber(), edgeLayer, vertexLayer);
  svg.onkeydown = arrowNav;
}
const PIECE = { settlement: 30, city: 38, road: 48 };
const poly = corners => corners.map(c => `${f(c.x * S)},${f(c.y * S)}`).join(' ');

function hexLabel(hx) { return `${app.config.terrains[hx.terrain].label}${hx.token ? ` ${hx.token}` : ''}`; }

function drawHex(hx) {
  const t = app.config.terrains[hx.terrain];
  const cx = hx.x * S, cy = hx.y * S;
  const corners = hexCorners(hx.q, hx.r);
  const inset = corners.map(c => ({ x: hx.x + (c.x - hx.x) * .93, y: hx.y + (c.y - hx.y) * .93 }));
  const hot = app.config.hotNumbers.includes(hx.token);
  const g = s('g', { class: 'hex', id: `hex-${hx.id}`, role: 'button', 'data-x': cx, 'data-y': cy, 'data-hex': hx.id, tabindex: -1 },
    s('polygon', { class: 'hex-fill', points: poly(corners), fill: t.fill, filter: 'url(#inner)' }),
    s('polygon', { points: poly(corners), fill: 'url(#paper)', opacity: '.32', style: 'mix-blend-mode:multiply' }),
    s('polygon', { points: poly(inset), fill: 'none', stroke: 'url(#bevel)', 'stroke-width': 4 }),
    s('polygon', { class: 'hex-ring', points: poly(corners) }),
    have[`icon-${hx.terrain}`]
      ? s('image', { class: 'terrain-icon', href: `images/icon-${hx.terrain}.png`, x: cx - 16, y: cy - 34, width: 32, height: 32 })
      : s('circle', { class: 'terrain-icon', cx, cy: cy - 18, r: 11, fill: 'rgba(10,14,19,.25)', stroke: 'rgba(233,228,218,.4)' }),
    hx.terrain === 'barrens'
      ? s('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', 'font-size': 11, fill: '#3b2f1e', 'font-style': 'italic', style: 'font-family:var(--serif);font-weight:600' }, 'The Barrens')
      : null,
    hx.token ? s('g', { class: 'token' },
      s('circle', { class: 'token-disc', cx, cy: cy + 13, r: 15.5, fill: 'url(#paper)', stroke: hot ? '#e8b04b' : 'rgba(10,14,19,.45)', 'stroke-width': hot ? 2.2 : 1 }),
      s('circle', { cx, cy: cy + 13, r: 15.5, fill: 'url(#token-shade)' }),
      s('text', { class: 'token-num', x: cx, y: cy + 18, 'text-anchor': 'middle', 'font-size': 17, fill: hot ? '#a5650f' : '#2a2219' }, hx.token),
      s('g', {}, Array.from({ length: R.pips(hx.token) }, (_, i) => s('circle', { cx: cx + (i - (R.pips(hx.token) - 1) / 2) * 3.4, cy: cy + 23.5, r: 1.1, fill: hot ? '#a5650f' : '#2a2219' })))
    ) : null
  );
  g.addEventListener('click', () => clickHex(hx.id));
  g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clickHex(hx.id); } });
  return g;
}

function drawHarbor(hb) {
  const V = app.game.board.vertices;
  const a = V[hb.vertices[0]], b = V[hb.vertices[1]];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(mx, my);
  const bx = (mx + mx / len * .62) * S, by = (my + my / len * .62) * S;
  const label = hb.kind === 'any' ? `${hb.rate}:1` : `${hb.rate}:1`;
  return s('g', { class: 'harbor' },
    [a, b].map(v => s('line', { x1: v.x * S, y1: v.y * S, x2: bx, y2: by, stroke: '#c9a57a', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 4', opacity: '.85' })),
    s('circle', { class: 'harbor-badge', cx: bx, cy: by, r: 15, fill: '#111820', stroke: '#c9a57a', 'stroke-width': 1.2 }),
    hb.kind !== 'any'
      ? (have[`icon-${hb.kind}`] ? s('image', { href: `images/icon-${hb.kind}.png`, x: bx - 8, y: by - 14, width: 16, height: 16 })
        : s('circle', { cx: bx, cy: by - 6, r: 5, fill: app.config.terrains[hb.kind].fill }))
      : s('text', { x: bx, y: by - 3, 'text-anchor': 'middle', 'font-size': 7, fill: '#868b93', 'letter-spacing': '.06em' }, 'ANY'),
    s('text', { x: bx, y: by + (hb.kind === 'any' ? 7 : 9), 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 600, fill: '#e8dcc4' }, label)
  );
}

function drawEdgeTarget(e) {
  const V = app.game.board.vertices;
  const a = V[e.a], b = V[e.b];
  const mx = (a.x + b.x) / 2 * S, my = (a.y + b.y) / 2 * S;
  const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const r = s('rect', { class: 'edg', id: `edge-${e.id}`, role: 'button', tabindex: -1, 'data-x': mx, 'data-y': my, 'data-edge': e.id,
    x: -17, y: -6, width: 34, height: 12, rx: 5, transform: `translate(${f(mx)} ${f(my)}) rotate(${f(ang)})` });
  r.addEventListener('click', () => clickEdge(e.id));
  r.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clickEdge(e.id); } });
  return r;
}
function drawVertexTarget(v) {
  const c = s('circle', { class: 'vtx', id: `vtx-${v.id}`, role: 'button', tabindex: -1, 'data-x': v.x * S, 'data-y': v.y * S, 'data-vertex': v.id, cx: f(v.x * S), cy: f(v.y * S), r: 11 });
  c.addEventListener('click', () => clickVertex(v.id));
  c.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clickVertex(v.id); } });
  return c;
}
function drawRobber() {
  return s('g', { id: 'robber', 'aria-hidden': 'true' },
    s('ellipse', { cx: 0, cy: 17, rx: 14, ry: 3.5, fill: 'rgba(0,0,0,.45)' }),
    s('path', { d: 'M0,-21 C9,-21 13,-13 13,-5 C13,3 16,10 17,17 L-17,17 C-16,10 -13,3 -13,-5 C-13,-13 -9,-21 0,-21 Z', fill: '#151b23', stroke: '#3a4350', 'stroke-width': 1.2 }),
    s('path', { d: 'M0,-15 C5,-15 7,-10 7,-6 C7,-1 4,2 0,2 C-4,2 -7,-1 -7,-6 C-7,-10 -5,-15 0,-15 Z', fill: '#05070a' }),
    s('path', { d: 'M-13,-5 C-8,0 8,0 13,-5', fill: 'none', stroke: '#2a323d', 'stroke-width': 1 }));
}

/* ---------- board: dynamic layer ---------- */
function pieceKeys(g) {
  return [...Object.entries(g.buildings).map(([v, b]) => `b:${v}:${b.kind}`), ...Object.keys(g.roads).map(e => `r:${e}`)];
}
function targets() {
  const g = app.game;
  const legal = legalActions(g);
  const t = { hexes: new Set(), vertices: new Set(), edges: new Set(), legal };
  for (const a of legal) {
    if (a.type === 'moveRobber') t.hexes.add(a.hex);
    if (g.phase === 'setup' && a.type === 'placeSettlement') t.vertices.add(a.vertex);
    if (g.phase === 'setup' && a.type === 'placeRoad') t.edges.add(a.edge);
    if (g.phase === 'charter' && a.type === 'buildRoad') t.edges.add(a.edge);
    if (g.phase === 'main' && app.mode === 'road' && a.type === 'buildRoad') t.edges.add(a.edge);
    if (g.phase === 'main' && app.mode === 'settlement' && a.type === 'buildSettlement') t.vertices.add(a.vertex);
    if (g.phase === 'main' && app.mode === 'city' && a.type === 'buildCity') t.vertices.add(a.vertex);
  }
  return t;
}

function renderBoard(t) {
  const g = app.game, B = g.board;
  const hidden = app.viewer !== actorOf(g);
  // Pieces
  const roads = $('roads'), builds = $('buildings');
  roads.replaceChildren(...Object.entries(g.roads).map(([eid, p]) => {
    const e = B.edges[eid], a = B.vertices[e.a], b = B.vertices[e.b];
    const mx = (a.x + b.x) / 2 * S, my = (a.y + b.y) / 2 * S, ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const key = `r:${eid}`;
    const body = have['piece-road']
      ? s('rect', { x: -PIECE.road / 2, y: -PIECE.road / 2, width: PIECE.road, height: PIECE.road, fill: colorOf(p), mask: 'url(#mask-road)' })
      : s('rect', { x: -21, y: -5, width: 42, height: 10, rx: 4, fill: colorOf(p) });
    return s('g', { transform: `translate(${f(mx)} ${f(my)}) rotate(${f(ang)})` }, s('g', { class: app.seen.has(key) ? '' : 'pop', filter: 'url(#piece-edge)' }, body));
  }));
  builds.replaceChildren(...Object.entries(g.buildings).map(([vid, b]) => {
    const v = B.vertices[vid], x = v.x * S, y = v.y * S, k = b.kind, size = PIECE[k];
    const key = `b:${vid}:${k}`;
    const body = have[`piece-${k}`]
      ? s('rect', { x: -size / 2, y: -size / 2, width: size, height: size, fill: colorOf(b.player), mask: `url(#mask-${k})` })
      : s('path', { d: k === 'city' ? 'M-15,13 L-15,-3 L-6,-11 L3,-3 L3,-6 L15,-6 L15,13 Z' : 'M-11,11 L-11,-2 L0,-12 L11,-2 L11,11 Z', fill: colorOf(b.player) });
    return s('g', { transform: `translate(${f(x)} ${f(y)})` },
      s('g', { class: app.seen.has(key) ? '' : 'pop' },
        s('g', { filter: 'url(#piece-edge)' }, body),
        s('circle', { cx: size * .3, cy: size * .3, r: 7, fill: '#0a0e13', stroke: colorOf(b.player), 'stroke-width': 1.5 }),
        s('text', { x: size * .3, y: size * .3 + 3.2, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 600, fill: '#e9e4da' }, letterOf(b.player))));
  }));
  for (const k of pieceKeys(g)) app.seen.add(k);

  // Robber
  const rob = B.hexes.find(x => x.id === B.robber);
  $('robber').style.transform = `translate(${f(rob.x * S)}px, ${f(rob.y * S - 16)}px)`;

  // Hexes
  for (const hx of B.hexes) {
    const el = $(`hex-${hx.id}`);
    const legal = !hidden && t.hexes.has(hx.id);
    el.classList.toggle('legal', legal);
    el.classList.toggle('robbed', hx.id === B.robber);
    el.setAttribute('aria-label', `${hexLabel(hx)} hex${hx.id === B.robber ? ', the robber is here' : ''}${legal ? '. Move the robber here' : ''}`);
    el.setAttribute('aria-disabled', legal ? 'false' : 'true');
  }
  // Vertices
  for (const v of Object.values(B.vertices)) {
    const el = $(`vtx-${v.id}`);
    const legal = !hidden && t.vertices.has(v.id);
    const b = g.buildings[v.id];
    const harbor = B.harbors.find(hb => hb.vertices.includes(v.id));
    el.classList.toggle('legal', legal);
    el.setAttribute('aria-label', [
      `Corner touching ${v.hexes.map(id => hexLabel(B.hexes.find(x => x.id === id))).join(', ')}`,
      harbor ? `harbor ${harbor.rate} to 1${harbor.kind === 'any' ? '' : ` for ${resLabel(harbor.kind)}`}` : null,
      b ? `${nameOf(b.player)}'s ${b.kind}` : null,
      legal ? (app.mode === 'city' ? 'Upgrade to a city here' : 'Build a settlement here') : null
    ].filter(Boolean).join('. '));
    el.setAttribute('aria-disabled', legal ? 'false' : 'true');
  }
  // Edges
  for (const e of Object.values(B.edges)) {
    const el = $(`edge-${e.id}`);
    const legal = !hidden && t.edges.has(e.id);
    const owner = g.roads[e.id];
    el.classList.toggle('legal', legal);
    el.setAttribute('aria-label', [
      `Edge ${e.hexes.length > 1 ? 'between' : 'on the coast of'} ${e.hexes.map(id => hexLabel(B.hexes.find(x => x.id === id))).join(' and ')}`,
      owner != null ? `${nameOf(owner)}'s road` : null,
      legal ? 'Build a road here' : null
    ].filter(Boolean).join('. '));
    el.setAttribute('aria-disabled', legal ? 'false' : 'true');
  }
  // Tab order: every legal target is a tab stop; otherwise one entry point per group, arrows do the rest.
  for (const [layer, sel] of [['hexes', '.hex'], ['vertex-targets', '.vtx'], ['edge-targets', '.edg']]) {
    const all = [...$(layer).querySelectorAll(sel)];
    const legal = all.filter(x => x.classList.contains('legal'));
    all.forEach(x => x.setAttribute('tabindex', '-1'));
    (legal.length ? legal : layer === 'hexes' ? [all[0]] : []).forEach(x => x.setAttribute('tabindex', '0'));
  }
}

function arrowNav(ev) {
  const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  if (ev.key === 'Escape' && app.mode) { app.mode = null; update(); return; }
  const d = dirs[ev.key];
  const cur = document.activeElement;
  if (!d || !cur?.dataset?.x) return;
  ev.preventDefault();
  const cls = cur.classList.contains('hex') ? '.hex' : cur.classList.contains('vtx') ? '.vtx' : '.edg';
  const x0 = +cur.dataset.x, y0 = +cur.dataset.y;
  let best = null, bestScore = Infinity;
  for (const el of $('board').querySelectorAll(cls)) {
    if (el === cur) continue;
    const dx = +el.dataset.x - x0, dy = +el.dataset.y - y0;
    const along = dx * d[0] + dy * d[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * d[1] - dy * d[0]);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  best?.focus();
}

/* ---------- board clicks ---------- */
function clickVertex(v) {
  const g = app.game;
  if (app.viewer !== actorOf(g)) return;
  const a = targets().legal.find(x => x.vertex === v && (
    (g.phase === 'setup' && x.type === 'placeSettlement') ||
    (app.mode === 'settlement' && x.type === 'buildSettlement') ||
    (app.mode === 'city' && x.type === 'buildCity')));
  if (a) act(a);
}
function clickEdge(e) {
  const g = app.game;
  if (app.viewer !== actorOf(g)) return;
  const a = targets().legal.find(x => x.edge === e && (
    (g.phase === 'setup' && x.type === 'placeRoad') ||
    (g.phase === 'charter' && x.type === 'buildRoad') ||
    (app.mode === 'road' && x.type === 'buildRoad')));
  if (a) act(a);
}
function clickHex(hexId) {
  const g = app.game;
  if (app.viewer !== actorOf(g) || g.phase !== 'robber') return;
  const options = legalActions(g).filter(a => a.type === 'moveRobber' && a.hex === hexId);
  if (!options.length) return;
  if (options.length === 1) { act(options[0]); return; }
  dialog({
    title: 'Take a card from',
    body: [h('p', {}, 'Choose a player beside this hex. You take one of their cards at random.'),
      h('div', { class: 'choices' }, options.map(o => h('button', { class: 'choice', type: 'button', onclick: () => { closeDialog(); act(o); } },
        chip(o.victim), nameOf(o.victim), h('small', {}, plural(R.handSize(g.players[o.victim].hand), 'card')))))],
    actions: [{ label: 'Choose another hex', onClick: closeDialog }]
  });
}

/* ---------- panel ---------- */
function update() {
  const g = app.game;
  const actor = actorOf(g);
  if (g.phase === 'over') { app.viewer = null; render(); showGameOver(); return; }
  if (actor !== app.viewer) { render(); showPass(actor); return; }
  render();
}

function render() {
  const g = app.game;
  const t = targets();
  renderBoard(t);
  renderPanel(t);
}

function prompt(g, actor) {
  const p = g.players[actor]?.name;
  switch (g.phase) {
    case 'setup': {
      const first = g.setup.index < g.players.length;
      return g.setup.step === 'settlement'
        ? `Place your ${first ? 'first' : 'second'} settlement on a <em>highlighted corner</em>.${first ? '' : ' It collects one of each resource around it.'}`
        : 'Place a road on a <em>highlighted edge</em> beside it.';
    }
    case 'roll': return 'Roll the dice to start your turn.';
    case 'discard': return `The robber came. Discard <em>${g.pending.discards[actor]}</em> cards.`;
    case 'robber': return 'Move the robber: choose a <em>highlighted hex</em>.';
    case 'charter': return `Charter: build up to ${g.freeRoads} free road${g.freeRoads === 1 ? '' : 's'} on a <em>highlighted edge</em>.`;
    case 'trade': return `${nameOf(g.trade.from)} offers you ${handText(g.trade.give)} for ${handText(g.trade.get)}.`;
    case 'main':
      if (app.mode) return `Choose a <em>highlighted ${app.mode === 'road' ? 'edge' : 'corner'}</em> for your ${app.mode}. Press Esc to cancel.`;
      return 'Build, trade or play a card, then end your turn.';
    case 'over': return `${p} has won.`;
    default: return '';
  }
}

function renderPanel(t) {
  const g = app.game;
  const actor = actorOf(g);
  const me = app.viewer;
  const shown = me !== null && me === actor;
  $('turn-info').textContent = g.phase === 'setup' ? `Setup · seed ${g.seed}` : `Turn ${g.turn} · seed ${g.seed}`;

  // Current
  const who = actor ?? g.current;
  $('current').replaceChildren(
    h('div', { class: 'who' }, chip(who, true), h('span', { class: 'name' }, nameOf(who)),
      who !== g.current ? h('span', { class: 'meta', style: 'color:var(--muted);font-size:12px' }, `(on ${nameOf(g.current)}'s turn)`) : null),
    (() => { const pEl = h('p', { class: 'prompt' }); pEl.innerHTML = prompt(g, who); return pEl; })());

  // Players
  $('players').replaceChildren(...g.players.map((pl, i) => {
    const pub = R.publicPoints(g, i), hid = R.hiddenPoints(g, i);
    const awards = Object.keys(g.config.awards).filter(k => g.awards[k]?.player === i);
    const showHidden = shown && i === me && hid > 0;
    return h('li', { class: i === g.current ? 'turn' : '', 'aria-label': `${pl.name}: ${pub} victory points${showHidden ? ` plus ${hid} hidden` : ''}, ${R.handSize(pl.hand)} resource cards, ${pl.cards.length} development cards${awards.length ? `, holds ${awards.map(k => g.config.awards[k].label).join(' and ')}` : ''}${i === g.current ? ', taking this turn' : ''}` },
      chip(i),
      h('div', {},
        h('div', { class: 'pname' }, pl.name, i === g.current ? h('small', {}, 'turn') : null),
        h('div', { class: 'meta' }, `${plural(R.handSize(pl.hand), 'card')} · ${pl.cards.length} dev · ${plural(pl.played.privateer, 'privateer')}`,
          awards.map(k => h('span', { class: 'award', title: g.config.awards[k].label }, g.config.awards[k].label)))),
      h('div', { class: 'vp' }, String(pub + (showHidden ? hid : 0)), h('small', {}, showHidden ? `VP (${hid} hidden)` : 'VP')));
  }));

  // Hand
  const hand = shown ? g.players[me].hand : null;
  $('hand').classList.toggle('hidden-hand', !shown);
  $('hand').setAttribute('aria-label', shown ? `${nameOf(me)}'s hand` : 'Hand hidden');
  $('tiles').replaceChildren(...g.config.resources.map(r => {
    const n = hand ? hand[r] : 0;
    return h('div', { class: `tile${n ? '' : ' zero'}`, role: 'img', 'aria-label': shown ? `${resLabel(r)}: ${n}` : `${resLabel(r)}: hidden` },
      resIcon(r), h('span', { class: 'rname' }, resLabel(r)), h('span', { class: 'count' }, shown ? String(n) : '–'));
  }));
  const cards = shown ? groupCards(g.players[me].cards) : [];
  $('cards').replaceChildren(...cards.map(([type, list]) => {
    const def = g.config.cards[type];
    const can = playable(g, me, type) && ['roll', 'main'].includes(g.phase);
    const fresh = list.every(c => c.turn >= g.turn);
    return h('div', { class: 'card-row' },
      h('div', {}, h('span', { class: 'cname' }, `${def.label}${list.length > 1 ? ` ×${list.length}` : ''}`), h('span', { class: 'ctext' }, def.text)),
      type === 'monument' ? h('span', { class: 'meta', style: 'font-size:11px;color:var(--brass)' }, `+${list.length} VP`)
        : h('button', { class: 'btn', type: 'button', disabled: !can, title: fresh ? 'Bought this turn: play it from your next turn.' : g.cardPlayed ? 'One card per turn.' : '', onclick: () => playCard(type) }, 'Play'));
  }));

  // Dice
  const dkey = JSON.stringify(g.dice);
  const tumble = g.dice && dkey !== app.lastDice;
  app.lastDice = dkey;
  [0, 1].forEach(i => drawDie($(`die${i}`), g.dice?.[i], tumble));
  $('dice').setAttribute('aria-label', g.dice ? `Dice: ${g.dice[0]} and ${g.dice[1]}` : 'Dice not rolled this turn');
  $('dice-total').replaceChildren(...(g.dice ? [String(g.dice[0] + g.dice[1]), h('small', {}, g.dice[0] + g.dice[1] === 7 ? 'The robber moves' : 'rolled')] : [h('small', {}, g.phase === 'setup' ? 'Setup' : 'Not rolled')]));

  // Actions
  $('actions').replaceChildren(...(shown ? actionButtons(g, me, t) : [h('p', { class: 'hint' }, 'Waiting for the next player.')]));

  // Log
  const log = $('log');
  log.replaceChildren(...g.log.slice(-60).map(line => h('li', {}, line)));
  log.scrollTop = log.scrollHeight;
}
function groupCards(cards) {
  const m = new Map();
  for (const c of cards) { if (!m.has(c.type)) m.set(c.type, []); m.get(c.type).push(c); }
  return [...m.entries()];
}
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function drawDie(el, v, tumble) {
  el.replaceChildren(...Array.from({ length: 9 }, (_, i) => h('i', { style: v && PIPS[v].includes(i) ? 'visibility:visible' : '' })));
  el.classList.toggle('blank', !v);
  if (tumble) { el.classList.remove('tumble'); void el.getBoundingClientRect(); el.classList.add('tumble'); }
}

function actionButtons(g, me, t) {
  const L = t.legal;
  const has = type => L.some(a => a.type === type);
  const btn = (label, onClick, { primary = false, disabled = false, wide = false, cost = null, on = false, title = '' } = {}) =>
    h('button', { class: `btn${primary ? ' primary' : ''}${wide ? ' wide' : ''}${on ? ' on' : ''}`, type: 'button', disabled, title: title || null, 'aria-pressed': on ? 'true' : null, onclick: onClick },
      label, cost ? h('span', { class: 'cost' }, cost) : null);
  const cost = k => R.costLabel(g, g.config.costs[k]);
  switch (g.phase) {
    case 'setup': return [h('p', { class: 'hint' }, g.setup.step === 'settlement' ? 'Settlements must be at least two edges apart.' : 'Roads join your settlement to the coast and to new corners.')];
    case 'roll': return [btn('Roll the dice', () => act(A.roll(me)), { primary: true, wide: true }),
      has('playCard') ? h('p', { class: 'hint' }, 'You can play a Privateer before you roll.') : null].filter(Boolean);
    case 'discard': return [btn(`Choose ${g.pending.discards[me]} cards to discard`, () => discardDialog(), { primary: true, wide: true })];
    case 'robber': return [h('p', { class: 'hint' }, 'Hexes you can move the robber to are outlined. Players beside your choice can be robbed.')];
    case 'charter': return [btn('Finish the charter', () => act(A.finishCharter(me)), { wide: true })];
    case 'trade': {
      const canAccept = L.some(a => a.type === 'respondTrade' && a.accept);
      return [btn('Accept', () => act(A.respondTrade(me, true)), { primary: true, disabled: !canAccept, title: canAccept ? '' : "You don't have those cards." }),
        btn('Decline', () => act(A.respondTrade(me, false)))];
    }
    case 'main': {
      const modeBtn = (k, type) => btn(app.mode === k ? `Cancel ${k}` : `Build ${k}`, () => { app.mode = app.mode === k ? null : k; render(); focusFirstTarget(); },
        { disabled: !has(type) && app.mode !== k, cost: cost(k), on: app.mode === k });
      return [
        modeBtn('road', 'buildRoad'), modeBtn('settlement', 'buildSettlement'), modeBtn('city', 'buildCity'),
        btn('Buy a card', () => act(A.buyCard(me)), { disabled: !has('buyCard'), cost: `${cost('card')} · ${g.deck.length} left` }),
        btn('Trade with the bank', () => bankDialog(), { disabled: !has('maritimeTrade'), cost: rateSummary(g, me) }),
        btn('Offer a trade', () => offerDialog(), { disabled: !has('proposeTrade'), cost: 'to another player' }),
        btn('End turn', () => act(A.endTurn(me)), { primary: true, wide: true })
      ];
    }
    default: return [];
  }
}
function rateSummary(g, p) {
  const rates = g.config.resources.map(r => R.tradeRate(g, p, r));
  const min = Math.min(...rates);
  return min === g.config.harbors.bankRate ? `${min} for 1` : `best ${min} for 1`;
}
function focusFirstTarget() {
  requestAnimationFrame(() => $('board').querySelector('.vtx.legal, .edg.legal, .hex.legal')?.focus());
}

/* ---------- cards ---------- */
function playCard(type) {
  const g = app.game, me = app.viewer;
  if (type === 'windfall') {
    return stepperDialog({ title: 'Windfall', text: 'Take any 2 resources from the bank.', total: 2, max: () => 2,
      onOk: picks => act(A.playCard(me, 'windfall', { resources: Object.entries(picks).flatMap(([r, n]) => Array(n).fill(r)) })) });
  }
  if (type === 'embargo') {
    return dialog({
      title: 'Embargo', body: [h('p', {}, 'Name a resource. Every other player gives you all of theirs.'),
        h('div', { class: 'choices' }, g.config.resources.map(r => h('button', { class: 'choice', type: 'button', onclick: () => { closeDialog(); act(A.playCard(me, 'embargo', { resource: r })); } }, resIcon(r), resLabel(r))))],
      actions: [{ label: 'Cancel', onClick: closeDialog }]
    });
  }
  act(A.playCard(me, type));
  if (app.game.phase === 'robber' || app.game.phase === 'charter') focusFirstTarget();
}

/* ---------- dialogs ---------- */
let lastFocus = null;
function dialog({ title, body, actions, cancellable = true }) {
  lastFocus = document.activeElement;
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(...[body].flat());
  $('modal-actions').replaceChildren(...actions.map(a => h('button', { class: `btn${a.primary ? ' primary' : ''}`, type: 'button', id: a.id || null, disabled: a.disabled || null, onclick: a.onClick }, a.label)));
  const m = $('modal');
  m.hidden = false;
  m.onkeydown = ev => {
    if (ev.key === 'Escape' && cancellable) closeDialog();
    if (ev.key === 'Tab') trapTab(ev, m);
  };
  requestAnimationFrame(() => m.querySelector('button:not(:disabled), input')?.focus());
}
function closeDialog() { $('modal').hidden = true; lastFocus?.focus?.(); }
function trapTab(ev, root) {
  const els = [...root.querySelectorAll('button:not(:disabled), input, [tabindex="0"]')];
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}

/** Steppers for each resource. `max(r)` caps each row; `total` (if set) must be met exactly. */
function steppers(state, max, onChange, sub = () => '') {
  return h('div', { class: 'steps' }, app.config.resources.map(r => {
    const out = h('output', { 'aria-live': 'polite' }, '0');
    const minus = h('button', { type: 'button', 'aria-label': `One less ${resLabel(r)}`, disabled: true }, '−');
    const plus = h('button', { type: 'button', 'aria-label': `One more ${resLabel(r)}` }, '+');
    const sync = () => { out.textContent = state[r]; minus.disabled = state[r] <= 0; plus.disabled = state[r] >= max(r); onChange(); };
    minus.onclick = () => { if (state[r] > 0) { state[r]--; sync(); syncAll(); } };
    plus.onclick = () => { if (state[r] < max(r)) { state[r]++; sync(); syncAll(); } };
    syncers.push(sync);
    return h('div', { class: 'step' }, resIcon(r), h('span', { class: 'rname' }, resLabel(r), h('small', {}, sub(r))), minus, out, plus);
  }));
}
let syncers = [];
function syncAll() { syncers.forEach(fn => fn()); }

function stepperDialog({ title, text, total, max, onOk, cancellable = true, sub }) {
  const pick = R.emptyHand(app.config.resources);
  syncers = [];
  const sum = () => R.handSize(pick);
  const okId = 'dlg-ok';
  const capped = r => Math.min(max(r), pick[r] + (total - sum()));
  const body = [h('p', {}, text), steppers(pick, capped, () => { const b = $(okId); if (b) b.disabled = sum() !== total; }, sub)];
  dialog({ title, body, cancellable, actions: [
    ...(cancellable ? [{ label: 'Cancel', onClick: closeDialog }] : []),
    { label: 'Confirm', primary: true, id: okId, disabled: true, onClick: () => { if (sum() !== total) return; closeDialog(); onOk({ ...pick }); } }
  ] });
  syncAll();
}

function discardDialog() {
  const g = app.game, me = app.viewer, need = g.pending.discards[me], hand = g.players[me].hand;
  stepperDialog({ title: `Discard ${need} cards`, text: `You hold ${R.handSize(hand)} cards. Choose ${need} to give up.`, total: need, cancellable: false,
    max: r => hand[r], sub: r => `of ${hand[r]}`, onOk: cards => act(A.discard(me, cards)) });
}

function bankDialog() {
  const g = app.game, me = app.viewer, hand = g.players[me].hand;
  let give = null, get = null;
  const okBtn = () => $('dlg-ok');
  const giveRow = h('div', { class: 'choices', role: 'group', 'aria-label': 'Give' });
  const getRow = h('div', { class: 'choices', role: 'group', 'aria-label': 'Get' });
  const draw = () => {
    giveRow.replaceChildren(...g.config.resources.map(r => {
      const rate = R.tradeRate(g, me, r);
      return h('button', { class: 'choice', type: 'button', 'aria-pressed': String(give === r), disabled: hand[r] < rate, onclick: () => { give = r; if (get === r) get = null; draw(); } },
        resIcon(r), resLabel(r), h('small', {}, `${rate} for 1`));
    }));
    getRow.replaceChildren(...g.config.resources.map(r => h('button', { class: 'choice', type: 'button', 'aria-pressed': String(get === r), disabled: r === give, onclick: () => { get = r; draw(); } }, resIcon(r), resLabel(r))));
    if (okBtn()) okBtn().disabled = !(give && get);
  };
  dialog({ title: 'Trade with the bank', body: [h('p', {}, 'Harbors you have built on improve your rate.'), h('div', { class: 'sub' }, 'Give'), giveRow, h('div', { class: 'sub' }, 'Get 1'), getRow],
    actions: [{ label: 'Cancel', onClick: closeDialog }, { label: 'Trade', primary: true, id: 'dlg-ok', disabled: true, onClick: () => { closeDialog(); act(A.maritimeTrade(me, give, get)); } }] });
  draw();
}

function offerDialog() {
  const g = app.game, me = app.viewer, hand = g.players[me].hand;
  let to = null;
  const give = R.emptyHand(g.config.resources), get = R.emptyHand(g.config.resources);
  const valid = () => to !== null && R.handSize(give) > 0 && R.handSize(get) > 0;
  const refresh = () => { const b = $('dlg-ok'); if (b) b.disabled = !valid(); };
  const who = h('div', { class: 'choices', role: 'group', 'aria-label': 'Trade with' });
  const drawWho = () => who.replaceChildren(...g.players.filter(p => p.id !== me).map(p =>
    h('button', { class: 'choice', type: 'button', 'aria-pressed': String(to === p.id), onclick: () => { to = p.id; drawWho(); refresh(); } }, chip(p.id), p.name, h('small', {}, plural(R.handSize(p.hand), 'card')))));
  drawWho();
  syncers = [];
  const giveSteps = steppers(give, r => hand[r], refresh, r => `of ${hand[r]}`);
  const getSteps = steppers(get, () => 19, refresh);
  dialog({ title: 'Offer a trade', body: [h('p', {}, 'The other player sees your offer when the device is passed to them.'),
    h('div', { class: 'sub' }, 'With'), who, h('div', { class: 'sub' }, 'You give'), giveSteps, h('div', { class: 'sub' }, 'You get'), getSteps],
  actions: [{ label: 'Cancel', onClick: closeDialog }, { label: 'Send offer', primary: true, id: 'dlg-ok', disabled: true, onClick: () => { if (!valid()) return; closeDialog(); act(A.proposeTrade(me, to, { ...give }, { ...get })); } }] });
  syncAll();
}

/* ---------- pass the device ---------- */
function showPass(p) {
  const g = app.game;
  $('modal').hidden = true;
  const reason = {
    setup: 'Place a settlement and a road.',
    roll: "It's your turn.",
    discard: `The robber came. You must discard ${g.pending.discards[p]} cards.`,
    trade: `${g.trade ? nameOf(g.trade.from) : 'A player'} has a trade offer for you.`,
    main: 'Back to your turn.',
    robber: 'Move the robber.',
    charter: 'Build your free roads.'
  }[g.phase] || '';
  const card = $('pass').querySelector('.pass-card');
  card.querySelector('.chip')?.remove();
  card.prepend(chip(p, true));
  $('pass-name').textContent = nameOf(p);
  $('pass-reason').textContent = reason;
  $('pass-last').textContent = g.log.at(-1) || '';
  $('pass').hidden = false;
  $('app').setAttribute('aria-hidden', 'true');
  $('pass-ready').onclick = () => {
    $('pass').hidden = true;
    $('app').removeAttribute('aria-hidden');
    app.viewer = p;
    render();
    if (g.phase === 'discard') discardDialog();
    else (document.querySelector('#actions .btn.primary') || $('board').querySelector('.legal') || $('panel')).focus();
  };
  requestAnimationFrame(() => $('pass-ready').focus());
}

function showGameOver() {
  const g = app.game;
  clearSave();
  const rows = g.players.map((p, i) => ({ i, pub: R.publicPoints(g, i), hid: R.hiddenPoints(g, i) })).sort((a, b) => (b.pub + b.hid) - (a.pub + a.hid));
  dialog({
    title: `${nameOf(g.winner)} wins`,
    cancellable: false,
    body: [h('p', {}, g.log.at(-1)),
      h('ol', { class: 'standings' }, rows.map(r => h('li', {}, chip(r.i), nameOf(r.i), h('b', {}, `${r.pub + r.hid} VP${r.hid ? ` (${r.hid} from Monuments)` : ''}`))))],
    actions: [{ label: 'View the board', onClick: closeDialog }, { label: 'New game', primary: true, onClick: () => { closeDialog(); showStart(); } }]
  });
}

/* ---------- test page ---------- */
async function runTestPage() {
  $('tests').hidden = false;
  const { runTests, layoutTest } = await import('./tests.js');
  const list = $('test-list');
  const show = r => list.append(h('li', { class: r.pass ? 'pass' : 'fail' }, h('span', { class: 'tag' }, r.pass ? 'PASS' : 'FAIL'), h('b', {}, r.name), h('p', {}, r.details)));
  const results = runTests(app.config);
  results.forEach(show);
  $('tests-summary').textContent = 'Engine tests done. Running the layout test…';
  const layout = await layoutTest();
  show(layout);
  results.push(layout);
  const passed = results.filter(r => r.pass).length;
  $('tests-summary').textContent = `${passed} of ${results.length} tests pass.`;
  document.body.dataset.tests = passed === results.length ? 'pass' : 'fail';
  console.log(`[tests] ${passed}/${results.length} pass`);
}

init().catch(err => { console.error(err); document.body.append(h('p', { style: 'padding:24px' }, `Could not start: ${err.message}. Serve this folder over http (see README).`)); });
