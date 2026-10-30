// Combat log: an array of plain-language strings, plus formatting helpers.

export function createLog() {
  const lines = [];
  return {
    lines,
    add(text) { lines.push(text); return text; },
    toString() { return lines.join('\n'); }
  };
}

const sign = n => (n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`);

export function describeAttack(attacker, roll, label) {
  const head = `${attacker.name} ${label}: rolls ${roll.natural} ${sign(roll.bonus)} = ${roll.total} vs AC ${roll.targetAC}.`;
  if (roll.crit) return `${head} Natural 20, critical hit!`;
  if (roll.fumble) return `${head} Natural 1, automatic miss.`;
  return `${head} ${roll.hit ? 'Hit.' : 'Miss.'}`;
}

export function describeDamage(target, dmg) {
  const flat = dmg.modifier ? ` ${sign(dmg.modifier)}` : '';
  const dice = dmg.sets.length > 1
    ? `${dmg.sets.map(s => `[${s.join(' + ')}]`).join(' vs ')}, keeps the higher`
    : dmg.rolls.join(' + ');
  return `${dmg.total} damage (${dice}${flat}). ${target.name}: ${target.hp}/${target.maxHp} HP.`;
}

export function describeHeal(player, item, h) {
  const note = h.restored === 0 ? ' Already at full health.' : h.restored < h.amount ? ' (capped at max HP)' : '';
  return `${player.name} uses a ${item.name}: restores ${h.restored} of ${h.amount} HP.${note} ` +
         `${player.name}: ${player.hp}/${player.maxHp} HP. ${item.count} left.`;
}

export const RESPONSE_TEXT = {
  counter: 'counterattacks',
  dodge: 'dodges (+2 AC against this attack)',
  block: 'moves to block the escape',
  letGo: 'lets them go',
  attack: 'attacks'
};

export const ACTION_TEXT = {
  light: 'makes a light attack',
  hard: 'makes a hard attack (-2 to hit, best of two damage rolls)',
  flee: 'tries to flee',
  heal: 'drinks a healing item'
};
