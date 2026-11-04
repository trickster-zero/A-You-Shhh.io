// Monster decision-making. Pure: same monster state + same rng state -> same choice.

export const DEFAULT_AI = { lowHpThreshold: 0.35, variance: 0.25 };

/** What the monster prefers right now, before any dice. Used for the telegraph and by chooseResponse. */
export function preferredResponses(monster) {
  const ai = { ...DEFAULT_AI, ...monster.ai };
  const lowHp = monster.hp / monster.maxHp <= ai.lowHpThreshold;
  return {
    lowHp,
    vsAttack: lowHp ? ['dodge', 'counter'] : ['counter', 'dodge'],
    vsFlee: ['block', 'letGo']
  };
}

/**
 * Readable tell shown before the player chooses.
 *   stance: "circling" (prefers counter) or "wary" (prefers dodge)
 *   flee:   "braced" when it prefers to block a flee
 * The AI still varies 25% of the time, so this is a tell, not a promise.
 */
export function telegraph(monster) {
  const p = preferredResponses(monster);
  return {
    stance: p.vsAttack[0] === 'counter' ? 'circling' : 'wary',
    flee: p.vsFlee[0] === 'block' ? 'braced' : null,
    lowHp: p.lowHp
  };
}

/**
 * chooseResponse(monster, playerAction, rng)
 * playerAction: "light" | "hard" | "flee" | "heal"
 * Returns { response: "counter" | "dodge" | "block" | "letGo" | "attack", preferred, varied, lowHp }
 * Always draws exactly one random number, whatever the action, so seeded runs stay aligned.
 */
export function chooseResponse(monster, playerAction, rng) {
  const ai = { ...DEFAULT_AI, ...monster.ai };
  const pref = preferredResponses(monster);
  const roll = rng.next();

  if (playerAction === 'heal') {
    return { response: 'attack', preferred: 'attack', varied: false, lowHp: pref.lowHp };
  }
  const options = playerAction === 'flee' ? pref.vsFlee : pref.vsAttack;
  const varied = roll < ai.variance;
  return { response: varied ? options[1] : options[0], preferred: options[0], varied, lowHp: pref.lowHp };
}
