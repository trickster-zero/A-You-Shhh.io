/* =============================================================================
   combat.js — encounter loop (no DOM)

   ADDING A MONSTER (JSON only, no code changes):
   Add an entry to data/monsters.json:
     "wolf": {
       "id": "wolf", "name": "Wolf", "ac": 13, "hp": 11,
       "mods": { "str": 1, "dex": 2, "con": 1 },
       "attack": { "name": "Bite", "bonus": 4, "damage": "2d4+2" },
       "ai": { "lowHpThreshold": 0.25, "variance": 0.1 }
     }
   - "mods" can be replaced by "abilities" scores: { "str": 12, "dex": 15, ... }.
   - "ai" is optional (defaults 0.35 and 0.25).
   - Damage is "XdY+Z"; crits double the dice, never the +Z.
   It shows up in the test panel automatically.

   ADDING A HEALING ITEM: add it to items.json "consumables" with "heal" as a number
   or dice ("2d4+2"), then list it in a preset's "inventory": { "id": count }.

   API:
     const enc = createEncounter(player, monster, seed);   // seed: number, string, or rng
     enc.act('light' | 'hard' | 'flee' | 'heal', { item })  // one round; returns { lines, events, ... }
     enc.player.hp, enc.monster.hp, enc.round, enc.log, enc.outcome   // readable state
     enc.availableActions()                                  // e.g. hides 'heal' when out of items
   ============================================================================= */
import * as rules from './rules.js';
import { chooseResponse } from './ai.js';
import { cloneCombatant } from './entity.js';
import { createLog, describeAttack, describeDamage, describeHeal, RESPONSE_TEXT, ACTION_TEXT } from './log.js';
import { createRng } from './rng.js';

export const ACTIONS = ['light', 'hard', 'flee', 'heal'];
export const OUTCOMES = Object.freeze({ WIN: 'win', DEFEAT: 'defeat', FLED: 'fled', DRAW: 'draw' });
export const ROUND_LIMIT = 50;
export const DODGE_AC_BONUS = 2;
export const HARD_TO_HIT = -2;
export const HARD_DAMAGE_ATTEMPTS = 2;

export function createEncounter(player, monster, seed, { roundLimit = ROUND_LIMIT } = {}) {
  const rng = seed && typeof seed.next === 'function' ? seed : createRng(seed ?? Date.now());
  const p = cloneCombatant(player);
  const m = cloneCombatant(monster);
  const log = createLog();
  let events = [];

  const init = rules.initiative(rng, { playerDex: p.mods.dex, monsterDex: m.mods.dex });
  log.add(`${p.name} (${p.hp} HP, AC ${p.ac}) faces ${m.name} (${m.hp} HP, AC ${m.ac}).`);
  log.add(`Initiative: ${p.name} ${init.player.total}, ${m.name} ${init.monster.total}. ` +
          `${init.first === 'player' ? p.name : m.name} acts first.`);

  const enc = {
    player: p, monster: m, round: 0, outcome: null,
    first: init.first, initiative: init, roundLimit, seed: rng.seed,
    log: log.lines, history: [],
    act, availableActions, healingItem
  };

  function healingItem(id) {
    const inv = p.inventory || {};
    if (id) return inv[id]?.heal != null && inv[id].count > 0 ? inv[id] : null;
    return Object.values(inv).find(i => i.heal != null && i.count > 0) || null;
  }

  function availableActions() {
    if (enc.outcome) return [];
    return ACTIONS.filter(a => a !== 'heal' || healingItem());
  }

  function finish(outcome, text) {
    enc.outcome = outcome;
    log.add(text);
    events.push({ type: 'outcome', outcome });
  }

  function playerAttack(kind, dodging) {
    const targetAC = m.ac + (dodging ? DODGE_AC_BONUS : 0);
    const bonus = p.attack.bonus + (kind === 'hard' ? HARD_TO_HIT : 0);
    const roll = rules.attackRoll(rng, { bonus, targetAC });
    log.add(describeAttack(p, roll, kind === 'hard' ? 'swings hard' : 'attacks'));
    const ev = { type: 'attack', by: 'player', kind, roll, damage: null };
    events.push(ev);
    if (!roll.hit) return;
    const dmg = rules.damageRoll(rng, {
      dice: p.attack.dice, modifier: p.attack.modifier, crit: roll.crit,
      attempts: kind === 'hard' ? HARD_DAMAGE_ATTEMPTS : 1
    });
    m.hp = Math.max(0, m.hp - dmg.total);
    ev.damage = dmg.total;
    log.add(describeDamage(m, dmg));
    if (m.hp === 0) finish(OUTCOMES.WIN, `${m.name} is defeated. ${p.name} wins.`);
  }

  function monsterAttack(kind, label) {
    const roll = rules.attackRoll(rng, { bonus: m.attack.bonus, targetAC: p.ac });
    log.add(describeAttack(m, roll, label));
    const ev = { type: 'attack', by: 'monster', kind, roll, damage: null };
    events.push(ev);
    if (!roll.hit) return;
    const dmg = rules.damageRoll(rng, { dice: m.attack.dice, modifier: m.attack.modifier, crit: roll.crit });
    p.hp = Math.max(0, p.hp - dmg.total);
    ev.damage = dmg.total;
    log.add(describeDamage(p, dmg));
    if (p.hp === 0) finish(OUTCOMES.DEFEAT, `${p.name} falls. ${m.name} wins.`);
  }

  function heal(item) {
    const amount = rules.healAmount(rng, item.heal);
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    item.count -= 1;
    const h = { amount, restored: p.hp - before };
    log.add(describeHeal(p, item, h));
    events.push({ type: 'heal', item: item.id, amount, restored: h.restored, before, after: p.hp });
  }

  function resolveFlee(response) {
    let escaped;
    if (response === 'block') {
      const c = rules.contestedCheck(rng, { aMod: p.mods.dex, bMod: m.mods.str, tieWinner: 'b' });
      escaped = c.winner === 'a';
      log.add(`Contest: ${p.name} ${c.a.total} (Dex) vs ${m.name} ${c.b.total} (Str). ` +
              (escaped ? `${p.name} slips past.` : `${m.name} holds the way.`));
      events.push({ type: 'flee', method: 'contest', check: c, escaped });
    } else {
      const f = rules.fleeCheck(rng, { dexMod: p.mods.dex, monsterDexMod: m.mods.dex });
      escaped = f.success;
      log.add(`Flee check: ${f.natural} ${f.mod >= 0 ? '+' : '-'} ${Math.abs(f.mod)} = ${f.total} vs DC ${f.dc}. ` +
              (escaped ? 'Success.' : 'Failure.'));
      events.push({ type: 'flee', method: 'check', check: f, escaped });
    }
    if (escaped) return finish(OUTCOMES.FLED, `${p.name} escapes. The encounter ends.`);
    monsterAttack('free', 'gets a free attack');
  }

  /** Runs the player's step and the monster's step in initiative order. */
  function inOrder(playerStep, monsterStep) {
    const [a, b] = enc.first === 'player' ? [playerStep, monsterStep] : [monsterStep, playerStep];
    a();
    if (!enc.outcome) b();
  }

  function act(action, options = {}) {
    if (enc.outcome) throw new Error(`Encounter is over (${enc.outcome}).`);
    if (!ACTIONS.includes(action)) throw new Error(`Unknown action "${action}". Use ${ACTIONS.join(', ')}.`);
    let item = null;
    if (action === 'heal') {
      item = healingItem(options.item);
      if (!item) throw new Error(options.item ? `No "${options.item}" left.` : 'No healing items left.');
    }

    enc.round += 1;
    events = [];
    const choice = chooseResponse(m, action, rng);
    const start = log.lines.length;
    log.add(`Round ${enc.round}. ${p.name} ${ACTION_TEXT[action]}. ${m.name} ${RESPONSE_TEXT[choice.response]}.`);

    if (action === 'flee') {
      resolveFlee(choice.response);
    } else if (action === 'heal') {
      inOrder(() => heal(item), () => monsterAttack('turn', 'attacks'));
    } else {
      const dodging = choice.response === 'dodge';
      const counters = choice.response === 'counter';
      inOrder(() => playerAttack(action, dodging), () => { if (counters) monsterAttack('counter', 'counterattacks'); });
    }

    if (!enc.outcome && enc.round >= enc.roundLimit) {
      finish(OUTCOMES.DRAW, `Round limit reached (${enc.roundLimit}). The fight ends in a draw.`);
    }

    const result = {
      round: enc.round, action, response: choice.response, outcome: enc.outcome,
      events, lines: log.lines.slice(start)
    };
    enc.history.push(result);
    return result;
  }

  return enc;
}

/** Simulated player behaviour for batch runs. Each gets (encounter, policyRng). */
export const POLICIES = {
  light: () => 'light',
  hard: () => 'hard',
  mixed: (enc, rng) => {
    const options = enc.availableActions();
    return options[rng.int(0, options.length - 1)];
  },
  cautious: enc => {
    const frac = enc.player.hp / enc.player.maxHp;
    if (frac <= 0.4 && enc.healingItem()) return 'heal';
    if (frac <= 0.3) return 'flee';
    return 'light';
  }
};

/** Runs one full fight. Policies use their own rng so they never shift the combat dice. */
export function runEncounter({ player, monster, seed, policy = 'light', roundLimit = ROUND_LIMIT }) {
  const enc = createEncounter(player, monster, seed, { roundLimit });
  const choose = POLICIES[policy];
  if (!choose) throw new Error(`Unknown policy "${policy}".`);
  const policyRng = createRng(`${seed}:policy`);

  while (!enc.outcome) {
    if (enc.round > roundLimit) throw new Error('Encounter exceeded the round limit (engine bug).');
    enc.act(choose(enc, policyRng));
  }
  return {
    seed, outcome: enc.outcome, rounds: enc.round,
    playerHp: enc.player.hp, playerMaxHp: enc.player.maxHp,
    monsterHp: enc.monster.hp, log: enc.log, history: enc.history
  };
}
