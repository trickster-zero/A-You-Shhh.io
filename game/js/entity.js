// Builds combatants from JSON stat blocks. Output is plain data, safe to clone.
import { abilityMod, armorClass, proficiencyBonus } from './rules.js';
import { parseDice } from './dice.js';

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** preset: entry from characters.json; items: items.json */
export function createCharacter(preset, items) {
  if (!preset) throw new Error('Unknown character preset.');
  const armor = items.armor[preset.armor];
  const weapon = items.weapons[preset.weapon];
  if (!armor) throw new Error(`${preset.id}: unknown armor "${preset.armor}"`);
  if (!weapon) throw new Error(`${preset.id}: unknown weapon "${preset.weapon}"`);

  const level = preset.level ?? 1;
  const scores = Object.fromEntries(ABILITIES.map(k => [k, preset.abilities?.[k] ?? 10]));
  const mods = Object.fromEntries(ABILITIES.map(k => [k, abilityMod(scores[k])]));

  // Finesse uses the better of Str and Dex; otherwise the weapon's listed ability.
  const ability = weapon.finesse ? (mods.dex >= mods.str ? 'dex' : 'str') : (weapon.ability || 'str');
  const proficient = (preset.proficiencies || []).includes(weapon.id);
  const maxHp = Math.max(1, 8 + mods.con);

  // Inventory: { itemId: count } resolved against items.consumables
  const inventory = {};
  for (const [id, count] of Object.entries(preset.inventory || {})) {
    const item = items.consumables?.[id];
    if (!item) throw new Error(`${preset.id}: unknown item "${id}"`);
    inventory[id] = { ...item, count };
  }

  return {
    id: preset.id, name: preset.name, kind: 'player', level,
    scores, mods,
    ac: armorClass(armor, mods.dex),
    maxHp, hp: maxHp,
    armor: { id: armor.id, name: armor.name },
    attack: {
      name: weapon.name,
      ability, proficient,
      bonus: mods[ability] + (proficient ? proficiencyBonus(level) : 0),
      dice: weapon.damage,
      modifier: mods[ability]
    },
    inventory
  };
}

/** block: entry from monsters.json. Accepts "mods" directly or "abilities" scores. */
export function createMonster(block) {
  if (!block) throw new Error('Unknown monster.');
  const mods = Object.fromEntries(ABILITIES.map(k => [
    k,
    block.mods?.[k] ?? (block.abilities?.[k] != null ? abilityMod(block.abilities[k]) : 0)
  ]));
  const dmg = parseDice(block.attack.damage);

  return {
    id: block.id, name: block.name, kind: 'monster',
    mods,
    ac: block.ac,
    maxHp: block.hp, hp: block.hp,
    attack: {
      name: block.attack.name || 'Attack',
      bonus: block.attack.bonus,
      dice: `${dmg.count}d${dmg.sides}`,   // crits double these dice only
      modifier: dmg.modifier
    },
    ai: { ...(block.ai || {}) }
  };
}

export const cloneCombatant = c => JSON.parse(JSON.stringify(c));
