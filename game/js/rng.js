// Seeded pseudo-random number generator (mulberry32).
// The same seed always produces the same sequence. No DOM, no globals.

/** Turns any string or number into a 32-bit unsigned seed (FNV-1a hash). */
export function hashSeed(input) {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * createRng(seed) -> { seed, next(), int(min, max), chance(p) }
 * Integer seeds are used as-is; anything else is hashed.
 */
export function createRng(seed = Date.now()) {
  let a = Number.isInteger(seed) ? seed >>> 0 : hashSeed(seed);
  const initial = a;

  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
  }

  return {
    seed: initial,
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    chance(p) { return next() < p; }
  };
}
