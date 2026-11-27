// Seeded random numbers (mulberry32). The generator's position is a plain integer,
// so it lives inside the game state and survives JSON round trips.

/** Any string or number -> 32-bit seed (FNV-1a). */
export function hashSeed(input) {
  if (typeof input === 'number' && Number.isInteger(input)) return input >>> 0;
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** One step: (position) -> { value in [0, 1), next position }. Pure. */
export function step(position) {
  const a = (position + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, position: a };
}

/** A small stateful wrapper for code that draws several numbers in a row. Read .position to store it back. */
export function createRng(seedOrPosition) {
  let position = hashSeed(seedOrPosition);
  return {
    next() { const r = step(position); position = r.position; return r.value; },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    pick(list) { return list[this.int(0, list.length - 1)]; },
    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
    get position() { return position; }
  };
}

/** Two six-sided dice from a position. Returns { dice: [a, b], position }. */
export function rollDice(position) {
  const r = createRng(position);
  const dice = [r.int(1, 6), r.int(1, 6)];
  return { dice, position: r.position };
}
