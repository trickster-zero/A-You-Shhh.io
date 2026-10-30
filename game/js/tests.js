
// Acceptance tests and batch simulation. No DOM.
// Browser: imported by main.js (?test panel) and exposed as window.RPG.runTests().
// Node:    node game/js/tests.js [seed]   (exit code 1 if anything fails)
import { createRng } from './rng.js';
import { d20 } from './dice.js';
import * as rules from './rules.js';
import { createCharacter, createMonster } from './entity.js';
import { createEncounter, runEncounter, OUTCOMES, POLICIES, ROUND_LIMIT } from './combat.js';

const pct = x => `${(x * 100).toFixed(2)}%`;

/** Batch of fights. Fight i uses seed "<seed>#<i>"; the sample log is fight #0. */
export function runBatch(data, { characterId = 'scout', monsterId = 'goblin', n = 1000, seed = 1, policy = 'light' } = {}) {
  const player = createCharacter(data.characters[characterId], data.items);
  const monster = createMonster(data.monsters[monsterId]);
  const counts = { win: 0, defeat: 0, fled: 0, draw: 0 };
  let rounds = 0, hp = 0, hpWins = 0, sample = null;

  for (let i = 0; i < n; i++) {
    const r = runEncounter({ player, monster, seed: `${seed}#${i}`, policy });
    if (i === 0) sample = r;
    counts[r.outcome] += 1;
    rounds += r.rounds;
    hp += r.playerHp;
    if (r.outcome === OUTCOMES.WIN) hpWins += r.playerHp;
  }
  return {
    n, characterId, monsterId, policy, seed, counts,
    winRate: counts.win / n,
    avgRounds: rounds / n,
    avgHp: hp / n,
    avgHpOnWins: counts.win ? hpWins / counts.win : 0,
    maxHp: player.maxHp,
    sample
  };
}

export function runAcceptanceTests(data, { seed = 1 } = {}) {
  const results = [];
  const add = (name, pass, details) => results.push({ name, pass, details });
  const goblinBlock = data.monsters.goblin;

  // 1. d20 distribution
  {
    const rng = createRng(`${seed}:dice`);
    const N = 10000, counts = Array(21).fill(0);
    for (let i = 0; i < N; i++) counts[d20(rng).natural] += 1;
    const shares = counts.slice(1).map(c => c / N);
    const worst = Math.max(...shares.map(s => Math.abs(s - 0.05)));
    const chi = counts.slice(1).reduce((a, c) => a + (c - N / 20) ** 2 / (N / 20), 0);
    add('1. d20 faces each within ±2 pp of 5% (10,000 rolls)', worst <= 0.02,
      `Lowest ${pct(Math.min(...shares))}, highest ${pct(Math.max(...shares))}, worst deviation ${(worst * 100).toFixed(2)} pp. ` +
      `Chi-square ${chi.toFixed(1)} (19 df, 95% critical value 30.1).`);
  }

  // 2. Scout light-attack hit rate vs AC 13
  {
    const scout = createCharacter(data.characters.scout, data.items);
    const goblin = createMonster(goblinBlock);
    const rng = createRng(`${seed}:hits`);
    const N = 10000;
    let hits = 0;
    for (let i = 0; i < N; i++) if (rules.attackRoll(rng, { bonus: scout.attack.bonus, targetAC: goblin.ac }).hit) hits += 1;
    const expected = rules.hitChance(scout.attack.bonus, goblin.ac);
    const need = Math.min(20, Math.max(2, goblin.ac - scout.attack.bonus));
    const observed = hits / N;
    add('2. Scout light-attack hit rate vs Goblin (10,000 attacks, ±1.5 pp)', Math.abs(observed - expected) <= 0.015,
      `Calculation: attack bonus +${scout.attack.bonus} (Dex +${scout.mods.dex}, proficiency +2) vs AC ${goblin.ac}. ` +
      `Need a natural ${need} or higher: faces ${need}-20 = ${21 - need}/20 = ${pct(expected)}. ` +
      `Observed ${hits}/${N} = ${pct(observed)}.`);
  }

  // 3. Determinism
  {
    const scout = createCharacter(data.characters.scout, data.items);
    const goblin = createMonster(goblinBlock);
    const run = s => runEncounter({ player: scout, monster: goblin, seed: s, policy: 'mixed' }).log.join('\n');
    const a = run(`${seed}:det`), b = run(`${seed}:det`);
    // Different seeds: check several so a coincidentally identical short fight can't flake the test.
    const differs = [1, 2, 3, 4, 5].some(k => run(`${seed}:det-other-${k}`) !== a);
    add('3. Same seed gives identical logs; a different seed gives different logs', a === b && differs,
      `Identical with same seed: ${a === b}. Different with other seeds: ${differs}.`);
  }

  // 4. Termination for every preset, monster, and policy, plus a forced draw
  {
    const valid = new Set(Object.values(OUTCOMES));
    let fights = 0, bad = 0, maxRounds = 0;
    const tally = { win: 0, defeat: 0, fled: 0, draw: 0 };
    try {
      for (const cid of Object.keys(data.characters)) {
        for (const mid of Object.keys(data.monsters)) {
          const player = createCharacter(data.characters[cid], data.items);
          const monster = createMonster(data.monsters[mid]);
          for (const policy of Object.keys(POLICIES)) {
            for (let i = 0; i < 1000; i++) {
              const r = runEncounter({ player, monster, seed: `${seed}:end:${cid}:${mid}:${policy}:${i}`, policy });
              fights += 1;
              maxRounds = Math.max(maxRounds, r.rounds);
              if (!valid.has(r.outcome) || r.rounds > ROUND_LIMIT) bad += 1; else tally[r.outcome] += 1;
            }
          }
        }
      }
      const tank = createCharacter(data.characters.guard, data.items);
      tank.maxHp = tank.hp = 100000;
      const wall = createMonster({ id: 'wall', name: 'Training wall', ac: 10, hp: 100000, mods: {}, attack: { bonus: 0, damage: '1d1' } });
      const d = runEncounter({ player: tank, monster: wall, seed: `${seed}:draw` });
      const drawOk = d.outcome === OUTCOMES.DRAW && d.rounds === ROUND_LIMIT;
      add('4. Every fight ends with a valid outcome; forced draw at round 50', bad === 0 && drawOk,
        `${fights} fights: ${tally.win} wins, ${tally.defeat} defeats, ${tally.fled} fled, ${tally.draw} draws; ` +
        `longest ${maxRounds} rounds; invalid ${bad}. Forced draw: ${d.outcome} after ${d.rounds} rounds.`);
    } catch (err) {
      add('4. Every fight ends with a valid outcome; forced draw at round 50', false, `Threw: ${err.message}`);
    }
  }

  // 5. Healing
  {
    const problems = [];
    let healRounds = 0, capped = 0, preempted = 0;
    const goblin = createMonster(goblinBlock);

    for (const cid of Object.keys(data.characters)) {
      const base = createCharacter(data.characters[cid], data.items);
      for (let i = 0; i < 500; i++) {
        const capCase = i % 2 === 1;                      // odd runs: start 1 HP below max
        const enc = createEncounter(base, goblin, `${seed}:heal:${cid}:${i}`);
        enc.player.hp = capCase ? enc.player.maxHp - 1 : 3;
        const item = enc.healingItem();
        const countBefore = item.count;
        const r = enc.act('heal');

        const heals = r.events.filter(e => e.type === 'heal');
        const monsterAttacks = r.events.filter(e => e.type === 'attack' && e.by === 'monster');
        const playerAttacks = r.events.filter(e => e.type === 'attack' && e.by === 'player');

        if (monsterAttacks.length !== 1) problems.push(`${cid} #${i}: ${monsterAttacks.length} monster attacks (expected exactly 1)`);
        if (playerAttacks.length) problems.push(`${cid} #${i}: player attacked while healing`);
        if (monsterAttacks.some(e => e.kind === 'free')) problems.push(`${cid} #${i}: free attack on heal`);

        if (!heals.length) {                                // monster went first and dropped the player
          if (enc.first !== 'monster' || enc.outcome !== OUTCOMES.DEFEAT) problems.push(`${cid} #${i}: heal skipped without cause`);
          if (item.count !== countBefore) problems.push(`${cid} #${i}: item used although heal never happened`);
          preempted += 1;
          continue;
        }
        healRounds += 1;
        const h = heals[0];
        const expectedRestored = Math.min(h.amount, base.maxHp - h.before);
        if (typeof item.heal === 'number' && h.amount !== item.heal) problems.push(`${cid} #${i}: healed ${h.amount}, item says ${item.heal}`);
        if (h.restored !== expectedRestored) problems.push(`${cid} #${i}: restored ${h.restored}, expected ${expectedRestored}`);
        if (h.after > base.maxHp) problems.push(`${cid} #${i}: HP ${h.after} above max ${base.maxHp}`);
        if (item.count !== countBefore - 1) problems.push(`${cid} #${i}: item count not reduced`);
        if (h.restored < h.amount) capped += 1;
      }
    }

    // Healing with nothing left throws and does not use up a round.
    const enc = createEncounter(createCharacter(data.characters.scout, data.items), goblin, `${seed}:heal-empty`);
    Object.values(enc.player.inventory).forEach(it => { it.count = 0; });
    let threw = false;
    try { enc.act('heal'); } catch { threw = true; }
    if (!threw || enc.round !== 0) problems.push('heal with no items should throw without using a round');
    if (enc.availableActions().includes('heal')) problems.push('availableActions still lists heal with no items');

    add('5. Heal restores correct HP, caps at max, no extra monster attack', problems.length === 0,
      problems.length ? problems.slice(0, 5).join('; ')
        : `${healRounds} heal rounds checked (${capped} capped at max), ${preempted} where the monster acted first and won. ` +
          `Every round had exactly one monster attack and no free attack. Empty inventory throws and keeps the round.`);
  }

  return results;
}

/* ---------- Node entry point: node game/js/tests.js [seed] ---------- */
if (typeof window === 'undefined' && typeof process !== 'undefined' && process.argv?.[1] &&
    import.meta.url.endsWith('/' + process.argv[1].split(/[\\/]/).pop())) {
  const { readFileSync } = await import('node:fs');
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
  const data = { characters: load('characters'), items: load('items'), monsters: load('monsters') };
  const seed = process.argv[2] ?? '1';
  const results = runAcceptanceTests(data, { seed });
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.details}`);
  const b = runBatch(data, { seed });
  console.log(`\nScout vs Goblin, 1000 fights (light): win ${(b.winRate * 100).toFixed(1)}%, ` +
              `avg rounds ${b.avgRounds.toFixed(2)}, avg HP left ${b.avgHp.toFixed(2)}/${b.maxHp}`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
}
