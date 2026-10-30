// Monster decision-making. Pure: same monster state + same rng state -> same choice.

export const DEFAULT_AI = { lowHpThreshold: 0.35, variance: 0.25 };

/**
 * chooseResponse(monster, playerAction, rng)
 * playerAction: "light" | "hard" | "flee" | "heal"
 * Returns { response: "counter" | "dodge" | "block" | "letGo" | "attack", preferred, varied, lowHp }
 * Always draws exactly one random number, whatever the action, so seeded runs stay aligned.
 */
export function chooseResponse(monster, playerAction, rng) {
  const ai = { ...DEFAULT_AI, ...monster.ai };
  const lowHp = monster.hp / monster.maxHp <= ai.lowHpThreshold;
  const roll = rng.next();

  if (playerAction === 'heal') {
    // Nothing to dodge or block: the monster takes its normal turn and attacks.
    return { response: 'attack', preferred: 'attack', varied: false, lowHp };
  }

  const options = playerAction === 'flee'
    ? ['block', 'letGo']
    : lowHp ? ['dodge', 'counter'] : ['counter', 'dodge'];

  const varied = roll < ai.variance;
  return { response: varied ? options[1] : options[0], preferred: options[0], varied, lowHp };
}
