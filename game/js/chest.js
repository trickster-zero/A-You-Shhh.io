// Chest opening: trap, disarm check, loot. Pure; all randomness from the rng argument. No DOM.
import { abilityCheck } from './rules.js';
import { rollDice } from './dice.js';

/** Gear of this tier that directly upgrades what the player has equipped. */
export function gearCandidates(items, tier, equipped) {
  const pool = [
    ...Object.values(items.armor || {}).map(g => ({ ...g, slot: 'armor' })),
    ...Object.values(items.weapons || {}).map(g => ({ ...g, slot: 'weapon' }))
  ];
  return pool.filter(g => g.tier === tier && g.upgrades && g.upgrades === equipped[g.slot]);
}

/**
 * openChest({ chest, def, dexMod, equipped: { armor, weapon }, items, tier, rng })
 * chest: { trapped } from the floor; def: the floor's "chest" block from floors.json.
 */
export function openChest({ chest, def, dexMod, equipped, items, tier, rng }) {
  const out = { trapped: chest.trapped, disarm: null, damage: 0, gold: 0, items: {}, gear: null, saveToken: false };

  if (chest.trapped) {
    out.disarm = abilityCheck(rng, { mod: dexMod, dc: def.disarm.dc });
    if (!out.disarm.success) out.damage = rollDice(rng, def.trapDamage).total;
  }

  const loot = def.loot;
  out.gold = rollDice(rng, loot.gold).total;

  const heal = loot.healing;
  out.items[heal.item] = heal.count + (rng.next() < heal.bonusChance ? 1 : 0);

  if (rng.next() < loot.gearChance) {
    const options = gearCandidates(items, tier, equipped);
    if (options.length) out.gear = options[rng.int(0, options.length - 1)];
    else out.gold += rollDice(rng, loot.gearFallbackGold).total;
  }

  if (rng.next() < loot.saveTokenChance) {
    out.saveToken = true;
    out.items[loot.saveTokenItem] = (out.items[loot.saveTokenItem] || 0) + 1;
  }
  return out;
}
