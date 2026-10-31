// Run state for one floor: position, HP, pack, gold, gear, cleared nodes, chest. No DOM.
// Fights are delegated to the combat engine; HP and items are copied in before and out after.
import { createCharacter, createMonster } from './entity.js';
import { createEncounter } from './combat.js';
import { generateFloor, getFloorDef, neighbors } from './floor.js';
import { openChest as rollChest } from './chest.js';
import { createRng } from './rng.js';
import { abilityCheck, healAmount } from './rules.js';

const clone = o => JSON.parse(JSON.stringify(o));

export function createRun(data, { characterId, runSeed, floorNumber = 1 }) {
  const basePreset = data.characters[characterId];
  if (!basePreset) throw new Error(`Unknown character "${characterId}"`);
  const preset = clone(basePreset);
  const floor = generateFloor(runSeed, floorNumber, data.floors);
  const def = getFloorDef(data.floors, floorNumber);
  const byId = Object.fromEntries(floor.nodes.map(n => [n.id, n]));
  const start = createCharacter(preset, data.items);
  const tag = `${runSeed}:f${floorNumber}`;

  const run = {
    runSeed, characterId, floorNumber, floor, def, preset,
    hp: start.maxHp, gold: 0,
    inventory: { ...(preset.inventory || {}) },    // { itemId: count }
    position: floor.entrance, previous: null,
    visited: new Set([floor.entrance]),
    cleared: new Set([floor.entrance]),
    blocked: new Set(),
    defeated: {},                                   // nodeId -> monsters beaten
    attempts: {},
    chestOpened: false, chestResult: null,
    status: 'exploring',                            // exploring | encounter | defeat | complete
    pending: null, encounter: null, drinks: 0,
    log: [],
    node: id => byId[id],
    player, moves, canMoveTo, moveTo, remaining, isResolved,
    startEncounter, finishEncounter,
    canDrink, drinkDraught, canOpenChest, openChest, canDescend, descend, describe
  };

  say(`${start.name} enters ${def.name.toLowerCase()}. ${def.intro || ''}`.trim());
  return run;

  /* ---------------- helpers ---------------- */
  function say(text) { run.log.push(text); return text; }
  function player() {
    const c = createCharacter({ ...run.preset, inventory: run.inventory }, data.items);
    c.hp = Math.min(run.hp, c.maxHp);
    return c;
  }
  function remaining(id) {
    const n = byId[id];
    return n.monsters.length - (run.defeated[id] || 0);
  }
  function isResolved(id) {
    const n = byId[id];
    if (n.kind === 'fight' || n.kind === 'guard') return remaining(id) <= 0;
    if (n.kind === 'crevice') return run.cleared.has(id);
    if (n.kind === 'chest') return run.chestOpened;
    return true;
  }
  function moves() {
    if (run.status !== 'exploring') return [];
    return neighbors(floor, run.position).filter(id => !run.blocked.has(id));
  }
  function canMoveTo(id) { return moves().includes(id); }
  function monsterName(id, n) {
    const name = data.monsters[id]?.name || id;
    return n === 1 ? `a ${name.toLowerCase()}` : `${n} ${name.toLowerCase()}s`;
  }

  /* ---------------- movement ---------------- */
  function moveTo(id) {
    if (!canMoveTo(id)) throw new Error('That passage is not reachable from here.');
    const node = byId[id];
    run.previous = run.position;
    run.position = id;
    run.visited.add(id);

    if ((node.kind === 'fight' || node.kind === 'guard') && remaining(id) > 0) {
      run.status = 'encounter';
      run.pending = { nodeId: id };
      const left = remaining(id);
      say(`${node.label}: ${monsterName(node.monsters[run.defeated[id] || 0], left)} ${left === 1 ? 'blocks' : 'block'} the way.`);
      return { type: 'encounter', node };
    }

    if (node.kind === 'crevice' && !run.cleared.has(id)) {
      const p = player();
      const mod = p.mods[node.check.ability] ?? 0;
      const check = abilityCheck(createRng(`${tag}:crevice:${id}`), { mod, dc: node.check.dc });
      const roll = `Dex check: ${check.natural} ${mod >= 0 ? '+' : '-'} ${Math.abs(mod)} = ${check.total} vs DC ${check.dc}.`;
      if (check.success) {
        run.cleared.add(id);
        say(`${node.label}: ${roll} You squeeze through.`);
        return { type: 'crevice', success: true, check, node };
      }
      run.blocked.add(id);
      run.position = run.previous;
      say(`${node.label}: ${roll} You can't fit. This way is closed to you.`);
      return { type: 'crevice', success: false, check, node };
    }

    if (node.kind !== 'chest') run.cleared.add(id);
    say(node.kind === 'chest'
      ? (run.chestOpened ? `${node.label}. The chest lies open.` : `${node.label}. A chest waits in the dark.`)
      : `You move to the ${node.label.toLowerCase()}.`);
    return { type: node.kind === 'chest' ? 'chest' : 'moved', node };
  }

  /* ---------------- fights ---------------- */
  function startEncounter() {
    if (run.status !== 'encounter' || !run.pending) throw new Error('No fight is waiting.');
    const node = byId[run.pending.nodeId];
    const index = run.defeated[node.id] || 0;
    const monsterId = node.monsters[index];
    const key = `${node.id}:${index}`;
    run.attempts[key] = (run.attempts[key] || 0) + 1;
    const enc = createEncounter(player(), createMonster(data.monsters[monsterId]), `${tag}:${key}:${run.attempts[key]}`);
    run.encounter = enc;
    return { enc, meta: { node, index, total: node.monsters.length, monsterId } };
  }

  function finishEncounter() {
    const enc = run.encounter;
    if (!enc || !enc.outcome) throw new Error('The fight is not over.');
    run.encounter = null;
    run.hp = enc.player.hp;
    for (const [id, item] of Object.entries(enc.player.inventory || {})) run.inventory[id] = item.count;

    const node = byId[run.pending.nodeId];
    const outcome = enc.outcome;

    if (outcome === 'win') {
      run.defeated[node.id] = (run.defeated[node.id] || 0) + 1;
      const left = remaining(node.id);
      if (left > 0) return { outcome, next: 'encounter', remaining: left };
      run.status = 'exploring';
      run.pending = null;
      run.cleared.add(node.id);
      say(`${node.label} is clear.`);
      return { outcome, next: 'map' };
    }
    if (outcome === 'defeat') {
      run.status = 'defeat';
      say(`${player().name} falls in the ${node.label.toLowerCase()}.`);
      return { outcome, next: 'end' };
    }
    // fled or draw: back to where you came from
    run.status = 'exploring';
    run.pending = null;
    run.position = run.previous ?? floor.entrance;
    say(`You fall back to the ${byId[run.position].label.toLowerCase()}.`);
    return { outcome, next: 'map' };
  }

  /* ---------------- healing on the map ---------------- */
  function healingItemId() {
    return Object.keys(run.inventory).find(id => run.inventory[id] > 0 && data.items.consumables?.[id]?.heal != null) || null;
  }
  function canDrink() {
    return run.status === 'exploring' && run.hp < player().maxHp && !!healingItemId();
  }
  function drinkDraught() {
    if (!canDrink()) throw new Error('Nothing to drink, or already at full health.');
    const id = healingItemId();
    const item = data.items.consumables[id];
    const max = player().maxHp;
    const amount = healAmount(createRng(`${tag}:drink:${++run.drinks}`), item.heal);
    const before = run.hp;
    run.hp = Math.min(max, run.hp + amount);
    run.inventory[id] -= 1;
    say(`You drink a ${item.name.toLowerCase()}: +${run.hp - before} HP (${run.hp}/${max}). ${run.inventory[id]} left.`);
    return { amount, restored: run.hp - before };
  }

  /* ---------------- chest ---------------- */
  function canOpenChest() {
    return run.status === 'exploring' && run.position === floor.exit && !run.chestOpened && isResolved(floor.guard);
  }
  function openChest() {
    if (!canOpenChest()) throw new Error('The chest cannot be opened right now.');
    const p = player();
    const res = rollChest({
      chest: floor.chest, def: def.chest, dexMod: p.mods.dex,
      equipped: { armor: run.preset.armor, weapon: run.preset.weapon },
      items: data.items, tier: def.tier, rng: createRng(`${tag}:chest`)
    });
    run.chestOpened = true;
    run.chestResult = res;

    if (res.trapped) {
      const d = res.disarm;
      const roll = `Dex check: ${d.natural} ${d.mod >= 0 ? '+' : '-'} ${Math.abs(d.mod)} = ${d.total} vs DC ${d.dc}.`;
      if (d.success) say(`A needle trap clicks under the lid. ${roll} Disarmed.`);
      else {
        run.hp = Math.max(0, run.hp - res.damage);
        say(`A needle trap clicks under the lid. ${roll} It bites for ${res.damage} damage (${run.hp}/${p.maxHp} HP).`);
      }
    } else {
      say('The lid creaks open.');
    }

    run.gold += res.gold;
    for (const [id, n] of Object.entries(res.items)) run.inventory[id] = (run.inventory[id] || 0) + n;
    if (res.gear) equip(res.gear);

    const parts = [`${res.gold} gold`];
    for (const [id, n] of Object.entries(res.items)) {
      const name = data.items.consumables[id]?.name || id;
      parts.push(`${n} ${name.toLowerCase()}${n > 1 ? 's' : ''}`);
    }
    if (res.gear) parts.push(`${res.gear.name.toLowerCase()} (equipped)`);
    say(`Inside: ${parts.join(', ')}.`);

    if (run.hp === 0) {
      run.status = 'defeat';
      say(`${p.name} collapses beside the chest.`);
    }
    return res;
  }
  function equip(gear) {
    const old = run.preset[gear.slot];
    run.preset[gear.slot] = gear.id;
    const prof = run.preset.proficiencies || (run.preset.proficiencies = []);
    if (prof.includes(old) && !prof.includes(gear.id)) prof.push(gear.id);
  }

  function canDescend() { return run.status === 'exploring' && run.position === floor.exit && run.chestOpened; }
  function descend() {
    if (!canDescend()) throw new Error('Open the chest first.');
    run.status = 'complete';
    say(`You leave ${def.name.toLowerCase()} behind.`);
  }

  /* ---------------- text for the UI ---------------- */
  function describe(id) {
    const n = byId[id];
    const left = remaining(id);
    switch (n.kind) {
      case 'entrance': return 'The cave mouth. Grey daylight behind you.';
      case 'passage': return 'A quiet stretch of rock. Nothing moves.';
      case 'fight':
      case 'guard':
        if (left <= 0) return n.kind === 'guard' ? 'The guard post is empty now.' : 'Still bodies and silence. Cleared.';
        return n.kind === 'guard'
          ? `${capital(monsterName(n.monsters[0], 1))} guards the way to the chest.`
          : `${capital(monsterName(n.monsters[run.defeated[id] || 0], left))} ${left === 1 ? 'waits' : 'wait'} here.`;
      case 'crevice':
        if (run.blocked.has(id)) return "A crack too tight for you. You couldn't fit.";
        if (run.cleared.has(id)) return 'The crevice you squeezed through.';
        return `A narrow crack in the rock. Squeezing through takes a Dex check (DC ${n.check.dc}).`;
      case 'chest':
        if (run.chestOpened) return 'An open, empty chest.';
        return isResolved(floor.guard) ? 'A chest sits in the dark, unguarded now.' : 'A chest, watched by the guard post.';
      default: return '';
    }
  }
}

const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
