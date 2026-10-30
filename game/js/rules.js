// Pure rule functions. No state, no DOM. All randomness comes from the rng argument.
import { d20, rollDice } from './dice.js';

export const abilityMod = score => Math.floor((score - 10) / 2);

/** +2 at levels 1-4, +3 at 5-8, ... */
export const proficiencyBonus = level => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** armor: { base, dexCap } — dexCap null means no cap */
export function armorClass(armor, dexMod) {
  const cap = armor.dexCap == null ? Infinity : armor.dexCap;
  return armor.base + Math.min(dexMod, cap);
}

/** Natural 20 always hits (crit); natural 1 always misses (fumble). */
export function attackRoll(rng, { bonus, targetAC, mode = 'normal' }) {
  const die = d20(rng, mode);
  const total = die.natural + bonus;
  const crit = die.natural === 20;
  const fumble = die.natural === 1;
  const hit = crit || (!fumble && total >= targetAC);
  return { natural: die.natural, rolls: die.rolls, bonus, total, targetAC, hit, crit, fumble };
}

/**
 * Damage on a hit.
 *  attempts: how many times the weapon dice are rolled; the highest dice total is kept (hard attack = 2).
 *  crit doubles the dice in every attempt, never the flat modifier. Minimum 1.
 */
export function damageRoll(rng, { dice, modifier = 0, crit = false, attempts = 1 }) {
  const sets = [];
  for (let i = 0; i < attempts; i++) sets.push(rollDice(rng, dice, { multiplier: crit ? 2 : 1 }));
  let best = 0;
  sets.forEach((s, i) => { if (s.sum > sets[best].sum) best = i; });
  const flat = modifier + sets[best].modifier;
  return {
    sets: sets.map(s => s.rolls),
    kept: best,
    rolls: sets[best].rolls,
    modifier: flat,
    total: Math.max(1, sets[best].sum + flat),
    crit
  };
}

export function abilityCheck(rng, { mod, dc, mode = 'normal' }) {
  const die = d20(rng, mode);
  const total = die.natural + mod;
  return { natural: die.natural, mod, total, dc, success: total >= dc };
}

/** Flee: d20 + player Dex mod vs DC 10 + monster Dex mod. */
export function fleeCheck(rng, { dexMod, monsterDexMod }) {
  return abilityCheck(rng, { mod: dexMod, dc: 10 + monsterDexMod });
}

/** Contested d20 rolls. tieWinner: "a" or "b". */
export function contestedCheck(rng, { aMod, bMod, tieWinner = 'b' }) {
  const a = d20(rng).natural, b = d20(rng).natural;
  const aTotal = a + aMod, bTotal = b + bMod;
  const winner = aTotal > bTotal ? 'a' : bTotal > aTotal ? 'b' : tieWinner;
  return { a: { natural: a, mod: aMod, total: aTotal }, b: { natural: b, mod: bMod, total: bTotal }, winner };
}

/** Initiative: d20 + Dex mod each; ties go to the player. */
export function initiative(rng, { playerDex, monsterDex }) {
  const p = d20(rng).natural, m = d20(rng).natural;
  const player = p + playerDex, monster = m + monsterDex;
  return {
    player: { natural: p, total: player },
    monster: { natural: m, total: monster },
    first: player >= monster ? 'player' : 'monster'
  };
}

/** Healing amount from an item: a flat number or dice notation. */
export function healAmount(rng, heal) {
  return typeof heal === 'number' ? heal : rollDice(rng, heal).total;
}

/** Exact hit probability for a single d20 attack (normal mode). */
export function hitChance(bonus, targetAC) {
  const need = Math.min(20, Math.max(2, targetAC - bonus)); // nat 1 misses, nat 20 hits
  return (21 - need) / 20;
}
