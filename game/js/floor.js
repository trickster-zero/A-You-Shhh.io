// Cave floor generator. Pure and seeded: same runSeed + floor number -> same floor. No DOM.
//
// Shape: entrance -> three parallel routes (tunnel, hall, crevice) -> guard post -> chest (exit).
// Coordinates are in a 100 x 60 map space for the SVG view.
import { createRng } from './rng.js';

export const ROUTE_TYPES = ['tunnel', 'hall', 'crevice'];
const LANES = [12, 30, 48];
const FIXED_NODES = 3; // entrance, guard, chest

export const floorSeed = (runSeed, floorNumber) => `${runSeed}:floor:${floorNumber}`;

export function getFloorDef(floorsData, number) {
  const def = (floorsData?.floors || []).find(f => f.number === number);
  if (!def) throw new Error(`Floor ${number} is not defined in floors.json`);
  return def;
}

export function generateFloor(runSeed, floorNumber, floorsData) {
  const def = getFloorDef(floorsData, floorNumber);
  const rng = createRng(floorSeed(runSeed, floorNumber));
  const jitter = amount => (rng.next() * 2 - 1) * amount;
  const r1 = n => Math.round(n * 10) / 10;

  // 1. Node count, then route lengths that add up to it.
  const ranges = ROUTE_TYPES.map(t => def.routes[t].length);
  const minBranch = ranges.reduce((a, r) => a + r[0], 0);
  const maxBranch = ranges.reduce((a, r) => a + r[1], 0);
  const total = clamp(rng.int(def.nodes.min, def.nodes.max), FIXED_NODES + minBranch, FIXED_NODES + maxBranch);
  const lengths = Object.fromEntries(ROUTE_TYPES.map((t, i) => [t, ranges[i][0]]));
  for (let extra = total - FIXED_NODES - minBranch; extra > 0; extra--) {
    const open = ROUTE_TYPES.filter(t => lengths[t] < def.routes[t].length[1]);
    lengths[open[rng.int(0, open.length - 1)]] += 1;
  }

  // 2. Lanes: which route runs along the top, middle, bottom.
  const laneOrder = shuffle(ROUTE_TYPES.slice(), rng);

  const nodes = [];
  const edges = [];
  const add = node => { node.id = `n${nodes.length}`; nodes.push(node); return node; };

  const entrance = add({ kind: 'entrance', route: null, label: def.labels.entrance, monsters: [], x: 8, y: r1(30 + jitter(4)) });

  const routes = {};
  const lastOf = {};
  laneOrder.forEach((type, lane) => {
    const r = def.routes[type];
    const len = lengths[type];
    const fightIndex = type === 'tunnel' ? rng.int(0, len - 1) : type === 'hall' ? len - 1 : -1;
    const ids = [];
    let prev = entrance;
    for (let i = 0; i < len; i++) {
      const x = len === 1 ? 44 + jitter(5) : 28 + i * 30 + jitter(4);
      const y = LANES[lane] + jitter(3.5);
      let node;
      if (i === fightIndex) node = { kind: 'fight', label: r.labels.fight, monsters: r.monsters.slice() };
      else if (type === 'crevice' && i === 0) node = { kind: 'crevice', label: r.labels.crevice, monsters: [], check: { ...r.check } };
      else node = { kind: 'passage', label: r.labels.passage, monsters: [] };
      Object.assign(node, { route: type, x: r1(x), y: r1(y) });
      add(node);
      ids.push(node.id);
      edges.push([prev.id, node.id]);
      prev = node;
    }
    routes[type] = ids;
    lastOf[type] = prev;
  });

  const guard = add({ kind: 'guard', route: 'guard', label: def.labels.guard, monsters: def.guard.monsters.slice(), x: 76, y: r1(30 + jitter(4)) });
  ROUTE_TYPES.forEach(t => edges.push([lastOf[t].id, guard.id]));
  const chestNode = add({ kind: 'chest', route: 'chest', label: def.labels.chest, monsters: [], x: 92, y: r1(guard.y + jitter(3)) });
  edges.push([guard.id, chestNode.id]);

  // 3. Optional side passage between tunnel and hall (never the crevice) when their lanes touch.
  const lt = laneOrder.indexOf('tunnel'), lh = laneOrder.indexOf('hall');
  if (Math.abs(lt - lh) === 1 && rng.next() < (def.sidePassageChance ?? 0)) {
    edges.push([routes.tunnel[0], routes.hall[0]]);
  }

  // 4. Chest trap is part of the floor, so the same seed gives the same trap.
  const chest = { trapped: rng.next() < def.chest.trapChance };

  return {
    number: def.number, name: def.name, tier: def.tier, seed: floorSeed(runSeed, floorNumber),
    nodes, edges, routes, laneOrder,
    entrance: entrance.id, guard: guard.id, exit: chestNode.id,
    chest
  };
}

export function neighbors(floor, id) {
  const out = [];
  for (const [a, b] of floor.edges) {
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

/** Breadth-first path from -> to, skipping nodes in `avoid`. Returns an array of ids or null. */
export function findPath(floor, from, to, avoid = new Set()) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift();
    if (id === to) {
      const path = [];
      for (let cur = to; cur != null; cur = prev.get(cur)) path.unshift(cur);
      return path;
    }
    for (const n of neighbors(floor, id)) {
      if (!prev.has(n) && !avoid.has(n)) { prev.set(n, id); queue.push(n); }
    }
  }
  return null;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
