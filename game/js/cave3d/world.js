// Converts a floor graph (from floor.js) into a tile grid for the 3D cave.
// Pure: no DOM, no Three.js, so it runs in Node tests. Seeded from the floor's seed.
//
// Layout: the entrance and guard post are tall halls that span all three lanes.
// Each route runs along its own row (lane). Chambers sit on the lane at their map x position.
// Corridors are straight horizontal tunnels; the optional side passage is a dog-leg between lanes.
import { createRng } from '../rng.js';

export const WALL = 0;
export const FLOOR = 1;

const SX = 0.7;            // map x units -> tiles
const MARGIN = 4;
const LANE_GAP = 12;       // rows between lanes
const FIRST_LANE = MARGIN + 3;
const MAP_LANES = [12, 30, 48];

export function buildWorld(floor) {
  const rng = createRng(`${floor.seed}:cave3d`);
  const byId = Object.fromEntries(floor.nodes.map(n => [n.id, n]));
  const laneRow = l => FIRST_LANE + l * LANE_GAP;
  const col = x => Math.round(MARGIN + x * SX);
  const laneOf = n => floor.laneOrder.indexOf(n.route);

  const width = col(100) + MARGIN;
  const height = laneRow(2) + 3 + MARGIN;
  const tiles = new Uint8Array(width * height);
  const region = new Array(width * height).fill(null);   // node id for chambers, "e:a:b" for corridors
  const idx = (x, y) => y * width + x;
  const inBounds = (x, y) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
  const conflicts = [];

  function carve(x, y, tag) {
    if (!inBounds(x, y)) { conflicts.push(`${tag} leaves the grid at ${x},${y}`); return false; }
    const i = idx(x, y);
    if (tiles[i] === FLOOR) {
      if (region[i] !== tag) conflicts.push(`${tag} overlaps ${region[i]} at ${x},${y}`);
      return false;
    }
    tiles[i] = FLOOR;
    region[i] = tag;
    return true;
  }

  /* ---------- 1. Chambers ---------- */
  const chambers = {};
  for (const n of floor.nodes) {
    let c;
    if (n.kind === 'entrance' || n.kind === 'guard') {
      c = { cx: col(n.x), cy: laneRow(1), rx: 2, ry: LANE_GAP + 2, tall: true };
    } else if (n.kind === 'chest') {
      c = { cx: col(n.x), cy: laneRow(1), rx: 2, ry: 2 };
    } else {
      const [rx, ry] = n.kind === 'fight' ? (n.monsters.length > 1 ? [3, 3] : [2, 2]) : n.kind === 'crevice' ? [1, 0] : [1, 1];
      c = { cx: col(n.x), cy: laneRow(laneOf(n)), rx, ry };
    }
    c.id = n.id;
    c.kind = n.kind;
    c.tiles = [];
    chambers[n.id] = c;

    for (let dy = -c.ry; dy <= c.ry; dy++) {
      // tall halls get ragged walls; round chambers get a noisy ellipse
      const ragL = c.tall ? (rng.next() < 0.35 ? 1 : 0) : 0;
      const ragR = c.tall ? (rng.next() < 0.35 ? 1 : 0) : 0;
      for (let dx = -c.rx - ragL; dx <= c.rx + ragR; dx++) {
        let keep;
        if (c.tall) {
          keep = !(Math.abs(dy) === c.ry && Math.abs(dx) >= c.rx);   // trim the four corners
        } else {
          const e = (dx / (c.rx + 0.5)) ** 2 + (dy / (c.ry + 0.5)) ** 2;
          keep = dx === 0 || dy === 0 || e <= 1 + (rng.next() - 0.5) * 0.35;
        }
        if (keep && carve(c.cx + dx, c.cy + dy, n.id)) c.tiles.push([c.cx + dx, c.cy + dy]);
      }
    }
  }

  /* ---------- 2. Corridors, one per graph edge ---------- */
  const corridors = {};
  for (const [a0, b0] of floor.edges) {
    // orient left to right so every corridor is laid out the same way
    let [a, b] = [a0, b0];
    if (chambers[a].cx > chambers[b].cx) [a, b] = [b, a];
    const A = byId[a], B = byId[b], ca = chambers[a], cb = chambers[b];
    const tag = `e:${a}:${b}`;
    const path = [];
    const line = (x1, y1, x2, y2) => {
      const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
      let x = x1, y = y1;
      path.push([x, y]);
      while (x !== x2 || y !== y2) {
        if (x !== x2) x += sx; else y += sy;
        path.push([x, y]);
      }
    };

    const la = laneOf(A), lb = laneOf(B);
    if (A.kind === 'entrance') {
      line(ca.cx, laneRow(lb), cb.cx, laneRow(lb));
    } else if (B.kind === 'guard') {
      line(ca.cx, laneRow(la), cb.cx, laneRow(la));
    } else if (B.kind === 'chest') {
      line(ca.cx, laneRow(1), cb.cx, laneRow(1));
    } else if (la === lb) {
      line(ca.cx, ca.cy, cb.cx, cb.cy);
    } else {
      // side passage between adjacent lanes: down/up to the midline, across, then down/up
      const mid = Math.round((ca.cy + cb.cy) / 2);
      line(ca.cx, ca.cy, ca.cx, mid);
      path.pop();
      line(ca.cx, mid, cb.cx, mid);
      path.pop();
      line(cb.cx, mid, cb.cx, cb.cy);
    }

    const ordered = [];
    for (const [x, y] of path) {
      const r = region[idx(x, y)];
      if (r === a || r === b) continue;               // inside an endpoint chamber
      if (tiles[idx(x, y)] === FLOOR && r !== tag) { conflicts.push(`${tag} crosses ${r} at ${x},${y}`); continue; }
      carve(x, y, tag);
      if (!ordered.some(([ox, oy]) => ox === x && oy === y)) ordered.push([x, y]);
    }
    corridors[tag] = { tag, a, b, tiles: ordered, horizontal: ordered.every(([, y]) => y === ordered[0]?.[1]) };
  }

  /* ---------- 3. Walls: every void tile that touches floor ---------- */
  const walls = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[idx(x, y)] === FLOOR) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && tiles[idx(nx, ny)] === FLOOR) { touches = true; break; }
        }
      }
      if (touches) walls.push({ x, y, h: round2(0.95 + rng.next() * 0.45), shade: round2(rng.next()), tilt: round2((rng.next() - 0.5) * 0.25) });
    }
  }

  const floors = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[idx(x, y)] === FLOOR) floors.push({ x, y, region: region[idx(x, y)], shade: round2(rng.next()) });
    }
  }

  /* ---------- 4. Goblins, chest, exit ---------- */
  const goblins = [];
  const SPOTS = [[0, 0], [-1, -1], [1, 1], [1, -1], [-1, 1], [0, 1], [0, -1]];
  for (const n of floor.nodes) {
    if (!n.monsters?.length) continue;
    const c = chambers[n.id];
    const spots = SPOTS.map(([dx, dy]) => [c.cx + dx, c.cy + dy]).filter(([x, y]) => region[idx(x, y)] === n.id);
    n.monsters.forEach((monsterId, i) => {
      const [x, y] = spots[i % spots.length];
      goblins.push({ nodeId: n.id, index: i, monsterId, x, y, phase: round2(rng.next() * Math.PI * 2) });
    });
  }

  const chestChamber = chambers[floor.exit];
  const chest = { nodeId: floor.exit, x: chestChamber.cx, y: chestChamber.cy };
  const exit = { x: chestChamber.cx + chestChamber.rx + 0.45, y: chestChamber.cy };
  const solid = new Set([`${chest.x},${chest.y}`]);

  /* ---------- 5. Torches at chamber entrances (on the wall beside the corridor mouth) ---------- */
  const torches = [];
  const used = new Set();
  const addTorch = (x, y, side, kind = 'mouth') => {
    const wy = y + side;
    const key = `${x},${wy}`;
    if (used.has(key) || tiles[idx(x, wy)] === FLOOR) return false;
    used.add(key);
    torches.push({ x, y, side, kind, phase: round2(rng.next() * 10) });
    return true;
  };
  for (const c of Object.values(corridors)) {
    if (!c.tiles.length) continue;
    const ends = [c.tiles[0], c.tiles[c.tiles.length - 1]];
    ends.forEach(([x, y], i) => {
      if (rng.next() < 0.25 && i === 1) return;   // not every mouth is lit
      const first = rng.next() < 0.5 ? -1 : 1;
      if (!addTorch(x, y, first)) addTorch(x, y, -first);
    });
  }
  // one extra torch in each big chamber
  for (const c of Object.values(chambers)) {
    if (c.kind === 'passage' || c.kind === 'crevice') continue;
    const top = c.tiles.filter(([x, y]) => tiles[idx(x, y - 1)] !== FLOOR);
    if (top.length) { const [x, y] = top[Math.floor(rng.next() * top.length)]; addTorch(x, y, -1, 'chamber'); }
  }

  const spawn = { x: chambers[floor.entrance].cx, y: laneRow(1) };

  /* ---------- helpers ---------- */
  function regionAt(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return { type: null };
    const r = region[idx(x, y)];
    if (!r) return { type: null };
    if (r.startsWith('e:')) { const c = corridors[r]; return { type: 'corridor', id: r, a: c.a, b: c.b }; }
    return { type: 'chamber', id: r };
  }
  function isFloor(x, y) { return x >= 0 && y >= 0 && x < width && y < height && tiles[idx(x, y)] === FLOOR; }
  function walkable(x, y) { return isFloor(x, y) && !solid.has(`${x},${y}`); }

  /** Position on the 2D map (100 x 60 units) for the minimap dot. Accepts fractional tile coordinates. */
  function mapPos(fx, fy) {
    const r = regionAt(Math.round(fx), Math.round(fy));
    const rowToMap = row => MAP_LANES[0] + (row - laneRow(0)) * ((MAP_LANES[1] - MAP_LANES[0]) / LANE_GAP);
    if (r.type === 'chamber') {
      const n = byId[r.id], c = chambers[r.id];
      if (c.tall) return { x: n.x + (fx - c.cx) / SX * 0.4, y: rowToMap(fy) };
      return { x: n.x + (fx - c.cx) / SX * 0.4, y: n.y + (fy - c.cy) * 0.4 };
    }
    if (r.type === 'corridor') {
      const c = corridors[r.id];
      const i = c.tiles.findIndex(([x, y]) => x === Math.round(fx) && y === Math.round(fy));
      const t = c.tiles.length > 1 ? Math.max(0, i) / (c.tiles.length - 1) : 0.5;
      const A = byId[c.a], B = byId[c.b];
      const ay = chambers[c.a].tall ? rowToMap(c.tiles[0][1]) : A.y;
      const by = chambers[c.b].tall ? rowToMap(c.tiles[c.tiles.length - 1][1]) : B.y;
      return { x: A.x + (B.x - A.x) * (0.15 + 0.7 * t), y: ay + (by - ay) * (0.15 + 0.7 * t) };
    }
    return { x: 50, y: 30 };
  }

  return {
    width, height, tiles, region, chambers, corridors, walls, floors, goblins, chest, exit, solid, torches, spawn, conflicts,
    regionAt, isFloor, walkable, mapPos, laneRow
  };
}

const round2 = n => Math.round(n * 100) / 100;
