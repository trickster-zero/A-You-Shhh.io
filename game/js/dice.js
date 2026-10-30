// Dice helpers. Every function takes the rng explicitly so results are reproducible.

const NOTATION = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i;

/** "2d6+1" -> { count: 2, sides: 6, modifier: 1 } */
export function parseDice(notation) {
  const m = NOTATION.exec(String(notation));
  if (!m) throw new Error(`Bad dice notation: "${notation}"`);
  return {
    count: m[1] === '' ? 1 : Number(m[1]),
    sides: Number(m[2]),
    modifier: m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0
  };
}

/** One die with the given number of sides: 1..sides */
export function roll(rng, sides) {
  if (!Number.isInteger(sides) || sides < 1) throw new Error(`Bad die: d${sides}`);
  return rng.int(1, sides);
}

/**
 * rollDice(rng, "2d6+1", { multiplier })
 * multiplier multiplies the number of dice (crits, hard attacks); the flat modifier is added once.
 */
export function rollDice(rng, notation, { multiplier = 1 } = {}) {
  const { count, sides, modifier } = parseDice(notation);
  const rolls = [];
  for (let i = 0; i < count * multiplier; i++) rolls.push(roll(rng, sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  return { notation, rolls, sum, modifier, total: sum + modifier };
}

/** d20 with mode "normal" | "advantage" | "disadvantage" */
export function d20(rng, mode = 'normal') {
  const a = roll(rng, 20);
  if (mode === 'normal') return { natural: a, rolls: [a], mode };
  const b = roll(rng, 20);
  const natural = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
  return { natural, rolls: [a, b], mode };
}
