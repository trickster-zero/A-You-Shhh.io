// Acceptance tests and batch simulation. No DOM.
// Browser: imported by main.js (?test panel) and exposed as window.RPG.runTests().
// Node:    node game/js/tests.js [seed]   (exit code 1 if anything fails)
import { createRng } from './rng.js';
import { d20 } from './dice.js';
import * as rules from './rules.js';
import { createCharacter, createMonster } from './entity.js';
import { createEncounter, runEncounter, OUTCOMES, POLICIES, ROUND_LIMIT } from './combat.js';
import { generateFloor, getFloorDef, findPath, neighbors, ROUTE_TYPES } from './floor.js';
import { openChest } from './chest.js';
import { buildBeats, createLinePicker, schedule, SPEEDS } from './beats.js';
import { telegraph, preferredResponses } from './ai.js';
import { buildWorld, FLOOR } from './cave3d/world.js';

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

  // 6. Same seed -> same floor; different seeds -> different floors
  if (data.floors) {
    const a = JSON.stringify(generateFloor(`${seed}:floorA`, 1, data.floors));
    const b = JSON.stringify(generateFloor(`${seed}:floorA`, 1, data.floors));
    const differs = [1, 2, 3, 4, 5].some(k => JSON.stringify(generateFloor(`${seed}:floorB${k}`, 1, data.floors)) !== a);
    add('6. Same seed gives the same floor; other seeds give different layouts', a === b && differs,
      `Identical with same seed: ${a === b}. Different with other seeds: ${differs}.`);
  }

  // 7. 1000 seeds: structure and a valid entrance-to-exit path
  if (data.floors) {
    const def = getFloorDef(data.floors, 1);
    const problems = [];
    const sizes = {};
    let sidePassages = 0;
    for (let i = 0; i < 1000; i++) {
      const f = generateFloor(`${seed}:valid:${i}`, 1, data.floors);
      const byId = Object.fromEntries(f.nodes.map(n => [n.id, n]));
      const tag = `seed ${i}`;
      sizes[f.nodes.length] = (sizes[f.nodes.length] || 0) + 1;
      if (f.edges.length > f.nodes.length + 1) sidePassages++;   // a tree has nodes + 1 edges here; one more means a side passage

      if (f.nodes.length < def.nodes.min || f.nodes.length > def.nodes.max) problems.push(`${tag}: ${f.nodes.length} nodes`);
      for (const t of ROUTE_TYPES) if (!f.routes[t]?.length) problems.push(`${tag}: missing ${t}`);

      const tunnelFights = f.routes.tunnel.map(id => byId[id]).filter(n => n.kind === 'fight');
      if (tunnelFights.length !== 1 || tunnelFights[0].monsters.length !== 1) problems.push(`${tag}: tunnel must hold exactly one goblin`);
      const hallFights = f.routes.hall.map(id => byId[id]).filter(n => n.kind === 'fight');
      if (hallFights.length !== 1 || hallFights[0].monsters.length !== 3) problems.push(`${tag}: hall must hold three goblins`);
      const crevices = f.routes.crevice.map(id => byId[id]).filter(n => n.kind === 'crevice');
      if (crevices.length !== 1 || crevices[0].check.dc !== 12) problems.push(`${tag}: crevice needs one DC 12 check`);

      if (byId[f.exit].kind !== 'chest') problems.push(`${tag}: exit is not the chest`);
      const chestLinks = neighbors(f, f.exit);
      if (chestLinks.length !== 1 || chestLinks[0] !== f.guard) problems.push(`${tag}: chest must be reachable only through the guard`);
      if (!byId[f.guard].monsters.length) problems.push(`${tag}: guard post has no goblin`);

      if (!findPath(f, f.entrance, f.exit)) problems.push(`${tag}: no path entrance to exit`);
      if (!findPath(f, f.entrance, f.exit, new Set(f.routes.crevice))) problems.push(`${tag}: no path without the crevice`);
      for (const n of f.nodes) if (!findPath(f, f.entrance, n.id)) problems.push(`${tag}: ${n.id} unreachable`);
      if (problems.length > 10) break;
    }
    const dist = Object.keys(sizes).sort().map(k => `${k}: ${sizes[k]}`).join(', ');
    add('7. 1000 floors all have a valid path from entrance to exit', problems.length === 0,
      problems.length ? problems.slice(0, 5).join('; ')
        : `All 1000 valid, including a path that avoids the crevice. Node counts ${dist}. Side passages on ${sidePassages}.`);
  }

  // 8. Trap rate across 1000 chests, plus trap damage and loot sanity
  if (data.floors) {
    const def = getFloorDef(data.floors, 1);
    let trapped = 0, failed = 0, tokens = 0, gear = 0;
    const problems = [];
    for (let i = 0; i < 1000; i++) {
      const f = generateFloor(`${seed}:chest:${i}`, 1, data.floors);
      if (f.chest.trapped) trapped++;
      const res = openChest({
        chest: f.chest, def: def.chest, dexMod: 0, equipped: { armor: 'leather', weapon: 'shortsword' },
        items: data.items, tier: def.tier, rng: createRng(`${seed}:open:${i}`)
      });
      if (res.trapped && !res.disarm.success) {
        failed++;
        if (res.damage < 1 || res.damage > 6) problems.push(`chest ${i}: trap damage ${res.damage}`);
      }
      if (!res.trapped && res.damage) problems.push(`chest ${i}: damage without a trap`);
      if (res.gold < 6 || res.gold > 24) problems.push(`chest ${i}: gold ${res.gold}`);
      if (!(res.items['healing-draught'] >= 1)) problems.push(`chest ${i}: no healing draught`);
      if (res.saveToken) tokens++;
      if (res.gear) gear++;
    }
    const rate = trapped / 1000;
    const ok = Math.abs(rate - def.chest.trapChance) <= 0.035 && problems.length === 0;
    add('8. About 15% of 1000 chests are trapped (±3.5 pp)', ok,
      problems.length ? problems.slice(0, 5).join('; ')
        : `${trapped} trapped = ${pct(rate)} (target ${pct(def.chest.trapChance)}). ` +
          `${failed} failed disarms, damage always 1-6. Gear in ${gear}, save tokens in ${tokens} (target about 5%).`);
  }

  // 9. Balance: Scout level 1 vs Goblin
  {
    const b = runBatch(data, { characterId: 'scout', monsterId: 'goblin', n: 1000, seed: `${seed}:balance`, policy: 'light' });
    const ok = b.avgRounds >= 3 && b.avgRounds <= 6 && b.winRate >= 0.6 && b.winRate <= 0.75;
    add('9. Scout (level 1) vs Goblin: 3-6 rounds, 60-75% wins (1000 fights)', ok,
      `Win rate ${pct(b.winRate)}, average ${b.avgRounds.toFixed(2)} rounds, average HP left ${b.avgHp.toFixed(2)}/${b.maxHp}. ` +
      `Goblin: ${data.monsters.goblin.hp} HP, AC ${data.monsters.goblin.ac}, +${data.monsters.goblin.attack.bonus}, ${data.monsters.goblin.attack.damage}.`);
  }

  // 10. Lines: every event type has at least 5 lines
  if (data.lines) {
    const required = ['playerHit', 'playerMiss', 'crit', 'goblinHit', 'goblinMiss', 'dodge', 'block', 'lowHp', 'defeat', 'fleeSuccess', 'fleeFailed'];
    const counts = required.map(k => [k, data.lines.events?.[k]?.lines?.length || 0]);
    const short = counts.filter(([, n]) => n < 5);
    const p1 = createLinePicker(data.lines, `${seed}:lp`), p2 = createLinePicker(data.lines, `${seed}:lp`);
    const same = required.every(k => p1(k).text === p2(k).text);
    add('10. Every event type has at least 5 lines; picks are seeded', short.length === 0 && same,
      short.length ? `Too few: ${short.map(([k, n]) => `${k} (${n})`).join(', ')}`
        : `${counts.map(([k, n]) => `${k} ${n}`).join(', ')}. Same seed picks the same lines: ${same}.`);
  }

  // 11. Beats: in resolution order, never overlapping, telegraph matches the AI preference
  {
    const problems = [];
    let rounds = 0, beatsSeen = 0;
    const scout = createCharacter(data.characters.scout, data.items);
    const goblin = createMonster(data.monsters.goblin);
    for (let i = 0; i < 300 && problems.length < 5; i++) {
      const enc = createEncounter(scout, goblin, `${seed}:beats:${i}`);
      const pick = data.lines ? createLinePicker(data.lines, `${seed}:beats:${i}`) : null;
      const flags = {};
      const policyRng = createRng(`${seed}:beat-policy:${i}`);
      while (!enc.outcome) {
        const tell = telegraph(enc.monster);
        const pref = preferredResponses(enc.monster);
        if ((tell.stance === 'circling') !== (pref.vsAttack[0] === 'counter')) problems.push(`fight ${i}: stance does not match preference`);
        const before = { p: enc.player.hp, m: enc.monster.hp };
        const action = POLICIES.mixed(enc, policyRng);
        const result = enc.act(action);
        const beats = buildBeats(result, { enc, before, pick, flags });
        rounds++; beatsSeen += beats.length;

        if (beats[0].kind !== 'declare') problems.push(`fight ${i} round ${result.round}: does not start with the declaration`);
        const last = beats[beats.length - 1];
        if (last.kind !== (result.outcome ? 'outcome' : 'status')) problems.push(`fight ${i} round ${result.round}: does not end with a status or outcome`);
        if (last.hp.p !== enc.player.hp || last.hp.m !== enc.monster.hp) problems.push(`fight ${i} round ${result.round}: final HP differs from the engine`);

        // order: each engine attack/flee event appears as a roll beat, in the same order
        const evActors = result.events.filter(e => e.type === 'attack' || e.type === 'flee').map(e => e.type === 'flee' ? 'player' : e.by);
        const rollActors = beats.filter(b => b.kind === 'roll').map(b => b.actor);
        if (evActors.join() !== rollActors.join()) problems.push(`fight ${i} round ${result.round}: roll order ${rollActors} vs events ${evActors}`);
        // every roll is followed by its result
        beats.forEach((b, j) => { if (b.kind === 'roll' && beats[j + 1]?.kind !== 'result') problems.push(`fight ${i}: roll not followed by result`); });
        // a dodge is announced before the roll it affects
        if (result.response === 'dodge') {
          const d = beats.findIndex(b => b.kind === 'reaction'), r = beats.findIndex(b => b.kind === 'roll');
          if (r !== -1 && d > r) problems.push(`fight ${i}: dodge shown after the roll`);
        }
        // schedule never overlaps at any speed
        for (const ms of Object.values(SPEEDS)) {
          const timed = schedule(beats, ms);
          for (let j = 1; j < timed.length; j++) {
            if (timed[j].start < timed[j - 1].start + timed[j - 1].duration) problems.push(`fight ${i}: beats overlap at ${ms}ms`);
          }
        }
      }
    }
    add('11. Beats play in resolution order with no overlap; stance matches the AI', problems.length === 0,
      problems.length ? problems.slice(0, 5).join('; ')
        : `${rounds} rounds, ${beatsSeen} beats checked. Declaration first, status or outcome last, rolls in engine order, ` +
          `each roll followed by its result, dodges announced before the roll, no overlap at 700, 280 or 0 ms.`);
  }

  // 12. Level scaling formulas and XP thresholds
  {
    const problems = [];
    const expectHp = (con, lvl) => Math.max(1, 8 + con + 4 * (lvl - 1));
    for (const id of Object.keys(data.characters)) {
      for (let lvl = 1; lvl <= 8; lvl++) {
        const c = createCharacter({ ...data.characters[id], level: lvl }, data.items);
        const prof = lvl <= 4 ? 2 : 3;
        const dmg = Math.floor((lvl - 1) / 2);
        if (c.maxHp !== expectHp(c.mods.con, lvl)) problems.push(`${id} L${lvl}: HP ${c.maxHp}`);
        if (c.attack.bonus !== c.mods[c.attack.ability] + prof) problems.push(`${id} L${lvl}: attack ${c.attack.bonus}`);
        if (c.attack.modifier !== c.mods[c.attack.ability] + dmg) problems.push(`${id} L${lvl}: damage mod ${c.attack.modifier}`);
      }
    }
    if (data.progression) {
      const t = data.progression.xpThresholds;
      t.forEach((x, i) => { if (i < data.progression.maxLevel && rules.levelForXp(x, data.progression) !== i + 1) problems.push(`XP ${x} should be level ${i + 1}`); });
      if (rules.levelForXp(t[1] - 1, data.progression) !== 1) problems.push('one XP short of level 2 should stay level 1');
    }
    const xpTable = { goblin: 25, 'gilded-goblin': 75, 'mire-crawler': 50, 'stone-warden': 100, 'hollow-brute': 300 };
    for (const [id, xp] of Object.entries(xpTable)) if (data.monsters[id]?.xp !== xp) problems.push(`${id} XP ${data.monsters[id]?.xp}`);
    const swarmXp = (data.monsters['cave-rat']?.xp || 0) * 3;
    if (swarmXp !== 15) problems.push(`rat swarm XP ${swarmXp}`);
    add('12. Level formulas (HP, proficiency, damage bonus) and XP values', problems.length === 0,
      problems.length ? problems.slice(0, 5).join('; ')
        : 'Levels 1-8 checked for both presets. Scout HP 9/13/17..., proficiency +2 (1-4) and +3 (5-8), damage bonus floor((level-1)/2). XP: goblin 25, rat swarm 15, gilded goblin 75, mire crawler 50, stone warden 100, hollow brute 300.');
  }

  // 13. Same seed -> same 3D cave layout
  if (data.floors) {
    const snap = w => JSON.stringify({ t: Array.from(w.tiles), g: w.goblins, c: w.chest, to: w.torches, wa: w.walls });
    const a = snap(buildWorld(generateFloor(`${seed}:cave`, 1, data.floors)));
    const b = snap(buildWorld(generateFloor(`${seed}:cave`, 1, data.floors)));
    const differs = [1, 2, 3].some(k => snap(buildWorld(generateFloor(`${seed}:cave-other${k}`, 1, data.floors))) !== a);
    add('13. Same seed gives the same 3D cave; other seeds differ', a === b && differs,
      `Tiles, walls, torches, goblins, and chest identical with the same seed: ${a === b}. Different with other seeds: ${differs}.`);
  }

  // 14. The tile grid matches the floor graph for 1000 seeds
  if (data.floors) {
    const problems = [];
    let tilesTotal = 0, torchesMax = 0;
    for (let i = 0; i < 1000 && problems.length < 6; i++) {
      const f = generateFloor(`${seed}:grid:${i}`, 1, data.floors);
      const w = buildWorld(f);
      const tag = `seed ${i}`;
      if (w.conflicts.length) problems.push(`${tag}: ${w.conflicts[0]}`);
      const edgeSet = new Set(f.edges.map(([a, b]) => [a, b].sort().join('|')));
      // every pair of touching regions must be an allowed pair: chamber<->its corridors only
      for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
        if (w.tiles[y * w.width + x] !== FLOOR) continue;
        tilesTotal++;
        const r1 = w.regionAt(x, y);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const r2 = w.regionAt(x + dx, y + dy);
          if (!r2.type || r2.id === r1.id) continue;
          const ok = (r1.type === 'corridor' && r2.type === 'chamber' && (r1.a === r2.id || r1.b === r2.id)) ||
                     (r2.type === 'corridor' && r1.type === 'chamber' && (r2.a === r1.id || r2.b === r1.id));
          if (!ok) problems.push(`${tag}: ${r1.id} touches ${r2.id} at ${x},${y}`);
        }
      }
      // every graph edge has a corridor that reaches both chambers
      for (const c of Object.values(w.corridors)) {
        if (!edgeSet.has([c.a, c.b].sort().join('|'))) problems.push(`${tag}: corridor ${c.tag} is not a graph edge`);
      }
      if (Object.keys(w.corridors).length !== f.edges.length) problems.push(`${tag}: ${Object.keys(w.corridors).length} corridors for ${f.edges.length} edges`);
      // every chamber reachable on foot from the spawn, chest reachable
      const seen = new Set([`${w.spawn.x},${w.spawn.y}`]);
      const q = [[w.spawn.x, w.spawn.y]];
      while (q.length) {
        const [x, y] = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
          if (!seen.has(k) && w.isFloor(nx, ny)) { seen.add(k); q.push([nx, ny]); }
        }
      }
      for (const n of f.nodes) {
        const c = w.chambers[n.id];
        if (!c.tiles.some(([x, y]) => seen.has(`${x},${y}`))) problems.push(`${tag}: ${n.label} not reachable on foot`);
      }
      // goblins stand inside their own zone; the chest sits in the exit chamber
      for (const g of w.goblins) if (w.regionAt(g.x, g.y).id !== g.nodeId) problems.push(`${tag}: goblin outside its zone`);
      if (w.regionAt(w.chest.x, w.chest.y).id !== f.exit) problems.push(`${tag}: chest not in the exit chamber`);
      if (w.goblins.length !== f.nodes.reduce((n, x) => n + x.monsters.length, 0)) problems.push(`${tag}: goblin count mismatch`);
      torchesMax = Math.max(torchesMax, w.torches.length);
    }
    add('14. 3D tile grid matches the floor graph (1000 seeds)', problems.length === 0,
      problems.length ? problems.slice(0, 5).join('; ')
        : `No overlaps, every corridor is a graph edge, chambers only touch their own corridors, every chamber is reachable on foot, ` +
          `goblins stand in their zones. ${Math.round(tilesTotal / 1000)} floor tiles per cave on average, up to ${torchesMax} torches (6 lit at once).`);
  }

  // 15. Collision: random walks never enter a wall
  if (data.floors) {
    let steps = 0, refused = 0, bad = 0;
    for (let i = 0; i < 50; i++) {
      const w = buildWorld(generateFloor(`${seed}:walk:${i}`, 1, data.floors));
      const rng = createRng(`${seed}:walker:${i}`);
      let p = { ...w.spawn };
      for (let k = 0; k < 2000; k++) {
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)];
        const t = { x: p.x + dx, y: p.y + dy };
        steps++;
        if (w.walkable(t.x, t.y)) p = t; else refused++;
        if (!w.isFloor(p.x, p.y)) bad++;
      }
    }
    add('15. The player never enters a wall (100,000 random steps)', bad === 0 && refused > 0,
      `${steps} steps, ${refused} refused at walls or the chest, ${bad} ended inside a wall.`);
  }

  return results;
}

/* ---------- Node entry point: node game/js/tests.js [seed] ---------- */
if (typeof window === 'undefined' && typeof process !== 'undefined' && process.argv?.[1] &&
    import.meta.url.endsWith('/' + process.argv[1].split(/[\\/]/).pop())) {
  const { readFileSync } = await import('node:fs');
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
  const data = Object.fromEntries(['characters', 'items', 'monsters', 'floors', 'progression', 'lines'].map(n => [n, load(n)]));
  const seed = process.argv[2] ?? '1';
  const results = runAcceptanceTests(data, { seed });
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.details}`);
  const b = runBatch(data, { seed });
  console.log(`\nScout vs Goblin, 1000 fights (light): win ${(b.winRate * 100).toFixed(1)}%, ` +
              `avg rounds ${b.avgRounds.toFixed(2)}, avg HP left ${b.avgHp.toFixed(2)}/${b.maxHp}`);
  process.exitCode = results.every(r => r.pass) ? 0 : 1;
}
