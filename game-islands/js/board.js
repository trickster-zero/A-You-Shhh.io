// Hex grid: pointy-top hexes in axial coordinates (q, r), unit size.
// Vertices and edges get canonical ids from their positions, so they never depend on draw order.
import { createRng } from './rng.js';

const SQ3 = Math.sqrt(3);
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexCenter(q, r) { return { x: SQ3 * (q + r / 2), y: 1.5 * r }; }
export function hexCorners(q, r) {
  const c = hexCenter(q, r);
  return [0, 1, 2, 3, 4, 5].map(i => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: c.x + Math.cos(a), y: c.y + Math.sin(a) };
  });
}
const key = p => `${Math.round(p.x * 1000)}_${Math.round(p.y * 1000)}`;
export const hexId = (q, r) => `h${q}_${r}`;
export const ring = (radius) => {
  const out = [];
  for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) {
    const s = -q - r;
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= radius) out.push([q, r]);
  }
  return out;
};
const dist0 = ([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));

/** Topology only: hexes, vertices, edges, adjacency. Same every time for a given radius. */
export function buildTopology(radius) {
  const coords = ring(radius).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const hexes = coords.map(([q, r]) => ({ id: hexId(q, r), q, r, ...hexCenter(q, r), vertices: [], edges: [] }));
  const vertices = {}, edges = {};
  for (const h of hexes) {
    const corners = hexCorners(h.q, h.r);
    const vids = corners.map(p => {
      const id = 'v' + key(p);
      vertices[id] ||= { id, x: round(p.x), y: round(p.y), hexes: [], adj: [], edges: [] };
      vertices[id].hexes.push(h.id);
      return id;
    });
    h.vertices = vids;
    for (let i = 0; i < 6; i++) {
      const [a, b] = [vids[i], vids[(i + 1) % 6]].sort();
      const id = `e${a.slice(1)}|${b.slice(1)}`;
      if (!edges[id]) {
        edges[id] = { id, a, b, hexes: [] };
        vertices[a].adj.push(b); vertices[b].adj.push(a);
        vertices[a].edges.push(id); vertices[b].edges.push(id);
      }
      edges[id].hexes.push(h.id);
      h.edges.push(id);
    }
  }
  for (const h of hexes) h.neighbors = DIRS.map(([dq, dr]) => hexId(h.q + dq, h.r + dr)).filter(id => hexes.some(x => x.id === id));
  return { hexes, vertices, edges };
}
const round = n => Math.round(n * 10000) / 10000;

/** Coastal edges (touching exactly one land hex), ordered clockwise around the island. */
export function coastEdges(topo) {
  return Object.values(topo.edges).filter(e => e.hexes.length === 1).map(e => {
    const a = topo.vertices[e.a], b = topo.vertices[e.b];
    return { id: e.id, angle: Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2) };
  }).sort((x, y) => x.angle - y.angle).map(x => x.id);
}

/**
 * generateBoard(config, seed) -> { board, position }
 * Seeded terrain, number tokens (no two hot numbers side by side), harbors, robber on the Barrens.
 */
export function generateBoard(config, seed) {
  const rng = createRng(seed);
  const topo = buildTopology(config.boardRadius);
  const byId = Object.fromEntries(topo.hexes.map(h => [h.id, h]));

  const terrains = [];
  for (const [t, def] of Object.entries(config.terrains)) for (let i = 0; i < def.count; i++) terrains.push(t);
  if (terrains.length !== topo.hexes.length) throw new Error(`config.json lists ${terrains.length} terrain tiles for ${topo.hexes.length} land hexes.`);
  rng.shuffle(terrains).forEach((t, i) => { topo.hexes[i].terrain = t; });

  const producing = topo.hexes.filter(h => config.terrains[h.terrain].resource);
  if (config.numberTokens.length !== producing.length) throw new Error(`config.json lists ${config.numberTokens.length} number tokens for ${producing.length} producing hexes.`);
  const hot = new Set(config.hotNumbers);
  const clash = assign => producing.some(h => hot.has(assign[h.id]) && h.neighbors.some(n => hot.has(assign[n])));
  let assign = null, attempts = 0;
  for (; attempts < config.tokenShuffleAttempts; attempts++) {
    const tokens = rng.shuffle(config.numberTokens);
    const a = Object.fromEntries(producing.map((h, i) => [h.id, tokens[i]]));
    if (!clash(a)) { assign = a; break; }
  }
  if (!assign) assign = fallbackTokens(producing, config.numberTokens, hot, byId);
  for (const h of topo.hexes) h.token = assign[h.id] ?? null;

  // Harbors: evenly spaced around the coast from a seeded start, so no two share a vertex.
  const coast = coastEdges(topo);
  const H = config.harbors;
  const kinds = rng.shuffle([...Array(H.generic.count).fill('any'), ...H.specific.resources]);
  const offset = rng.next() * (coast.length / H.count);
  const harbors = kinds.slice(0, H.count).map((kind, i) => {
    const edge = topo.edges[coast[Math.floor(offset + (i * coast.length) / H.count) % coast.length]];
    return { id: `harbor${i}`, edge: edge.id, vertices: [edge.a, edge.b], kind, rate: kind === 'any' ? H.generic.rate : H.specific.rate };
  });

  const barrens = topo.hexes.find(h => !config.terrains[h.terrain].resource);
  return {
    board: { radius: config.boardRadius, hexes: topo.hexes, vertices: topo.vertices, edges: topo.edges, harbors, robber: barrens.id, tokenAttempts: attempts + 1 },
    position: rng.position
  };
}

/** Deterministic fallback: lay tokens in order, putting each hot number on the first hex with no hot neighbour. */
function fallbackTokens(producing, tokens, hot, byId) {
  const a = {};
  const free = producing.map(h => h.id);
  const hots = tokens.filter(t => hot.has(t)), rest = tokens.filter(t => !hot.has(t));
  for (const t of hots) {
    const i = free.findIndex(id => !byId[id].neighbors.some(n => hot.has(a[n])));
    a[free.splice(i < 0 ? 0 : i, 1)[0]] = t;
  }
  free.forEach((id, i) => { a[id] = rest[i]; });
  return a;
}

/** Sea hexes for drawing: one ring beyond the island. */
export function seaHexes(radius) {
  return ring(radius + 1).filter(c => dist0(c) === radius + 1).map(([q, r]) => ({ id: `s${q}_${r}`, q, r, ...hexCenter(q, r) }));
}
