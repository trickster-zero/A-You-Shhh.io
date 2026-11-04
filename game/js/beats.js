// Beat builder: turns one engine round into an ordered list of readable beats. Pure, no DOM.
// Each beat is one sentence, plus optional HP snapshot, floating number, and speech bubble.
import { createRng } from './rng.js';
import { telegraph } from './ai.js';

export const SPEEDS = { normal: 700, fast: 280, off: 0 };
export const LOW_HP = 0.35;

/** Seeded line picker. Uses its own rng stream so dialogue never shifts the combat dice. */
export function createLinePicker(lines, seed) {
  const rng = createRng(`${seed}:lines`);
  const last = {};
  return function pick(event, vars = {}) {
    const def = lines?.events?.[event];
    const pool = def?.lines || [];
    if (!pool.length) return null;
    let i = rng.int(0, pool.length - 1);
    if (pool.length > 1 && i === last[event]) i = (i + 1) % pool.length;
    last[event] = i;
    const raw = pool[i];
    const narrate = raw.startsWith('*');              // "*..." marks narration rather than speech
    return { text: fill(narrate ? raw.slice(1) : raw, vars), speaker: def.speaker || 'monster', narrate };
  };
}

/**
 * buildBeats(result, ctx)
 * result: return value of encounter.act()
 * ctx: { enc, before: { p, m }, pick, flags, item }
 *   flags is a persistent object per fight ({ playerLow, monsterLow, stance }) so low-HP lines fire once.
 * Returns [{ kind, round, text, hp: { p, m }, float?, bubble? }]
 */
export function buildBeats(result, ctx) {
  const { enc, pick, flags } = ctx;
  const P = enc.player.name;
  const mName = enc.monster.name.toLowerCase();
  const M = `The ${mName}`;
  const vars = { player: P, monster: mName };
  const beats = [];
  let p = ctx.before.p, m = ctx.before.m;

  const push = (kind, text, extra = {}) => beats.push({ kind, round: result.round, text, hp: { p, m }, ...extra });
  const say = (event, who) => {
    const line = pick?.(event, vars);
    if (!line) return null;
    const target = who || (line.speaker === 'player' ? 'player' : 'monster');
    return { target, text: line.text, narrate: line.narrate };
  };

  // 1. Declare
  const healEv = result.events.find(e => e.type === 'heal');
  const declare = {
    light: `${P} makes a light attack.`,
    hard: `${P} winds up a hard attack.`,
    flee: `${P} turns to run.`,
    heal: `${P} reaches for a ${(ctx.item || 'healing draught').toLowerCase()}.`
  }[result.action];
  push('declare', declare);

  // 2. Reactions that change the roll come before it
  if (result.response === 'dodge') push('reaction', `${M} dodges, so this attack needs ${enc.monster.ac + 2} to hit.`, { bubble: say('dodge', 'monster') });
  if (result.response === 'block') push('reaction', `${M} moves to block the way out.`, { bubble: say('block', 'monster') });
  if (result.response === 'letGo') push('reaction', `${M} doesn't try to stop ${P}.`);

  // 3. Events in engine order (initiative already decided the order)
  for (const ev of result.events) {
    if (ev.type === 'attack' && ev.by === 'player') {
      const r = ev.roll;
      push('roll', `${P} rolls ${r.natural} ${sign(r.bonus)} = ${r.total} against AC ${r.targetAC}.`, { roll: r, actor: 'player' });
      if (r.hit) {
        push('result', r.crit ? 'A natural 20: critical hit.' : `${P} hits.`, { tone: r.crit ? 'crit' : 'hit', bubble: say(r.crit ? 'crit' : 'playerHit', 'monster') });
        m = Math.max(0, m - ev.damage);
        push('damage', `${ev.damage} damage. ${M} has ${m} HP left.`, { tone: 'hit', float: { target: 'monster', text: `−${ev.damage}`, crit: r.crit } });
      } else {
        push('result', r.fumble ? `A natural 1. ${P} misses badly.` : `${P} misses.`, { tone: 'miss', bubble: say('playerMiss', 'player') });
      }
    } else if (ev.type === 'attack' && ev.by === 'monster') {
      const r = ev.roll;
      const lead = { counter: `${M} counterattacks.`, free: `${M} gets a free swing as ${P} turns.`, turn: `${M} attacks while ${P} drinks.` }[ev.kind];
      if (lead) push('reaction', lead);
      push('roll', `${M} rolls ${r.natural} ${sign(r.bonus)} = ${r.total} against AC ${r.targetAC}.`, { roll: r, actor: 'monster' });
      if (r.hit) {
        push('result', r.crit ? `A natural 20 for the ${mName}.` : `${M} hits.`, { tone: r.crit ? 'crit' : 'hurt', bubble: say('goblinHit', 'monster') });
        p = Math.max(0, p - ev.damage);
        push('damage', `${ev.damage} damage. ${P} has ${p} HP left.`, { tone: 'hurt', float: { target: 'player', text: `−${ev.damage}`, crit: r.crit } });
      } else {
        push('result', r.fumble ? `A natural 1. ${M} swings at nothing.` : `${M} misses.`, { tone: 'miss', bubble: say('goblinMiss', 'monster') });
      }
    } else if (ev.type === 'heal') {
      p = ev.after;
      push('heal', `${P} recovers ${ev.restored} HP (${p}/${enc.player.maxHp}).`, { tone: 'good', float: { target: 'player', text: `+${ev.restored}`, heal: true } });
    } else if (ev.type === 'flee') {
      const c = ev.check;
      push('roll', ev.method === 'contest'
        ? `${P} rolls ${c.a.total} (Dex) against the ${mName}'s ${c.b.total} (Str).`
        : `${P} rolls ${c.natural} ${sign(c.mod)} = ${c.total} against DC ${c.dc}.`, { actor: 'player' });
      push('result', ev.escaped ? `${P} slips away.` : `${P} is caught.`,
        { tone: ev.escaped ? 'good' : 'hurt', bubble: say(ev.escaped ? 'fleeSuccess' : 'fleeFailed', ev.escaped ? 'player' : 'monster') });
    }
  }
  if (result.action === 'heal' && !healEv && !result.outcome) push('result', `${P} never gets the cork out.`);

  // 4. Close the round: outcome, or a status line with stance and low-HP chatter
  if (result.outcome) {
    const text = {
      win: `${M} is defeated.`,
      defeat: `${P} falls.`,
      fled: `${P} escapes into the dark.`,
      draw: `Round ${result.round}. Neither side gives way, and the fight ends in a draw.`
    }[result.outcome];
    const loser = result.outcome === 'win' ? 'monster' : result.outcome === 'defeat' ? 'player' : null;
    push('outcome', text, loser ? { bubble: say('defeat', loser) } : {});
    return beats;
  }

  const tell = telegraph({ ...enc.monster, hp: m });
  let text = `End of round ${result.round}. ${P} ${p}/${enc.player.maxHp} HP, ${mName} ${m}/${enc.monster.maxHp} HP.`;
  if (flags && tell.stance !== flags.stance) {
    text += ` The ${mName} looks ${tell.stance === 'wary' ? 'wary now' : 'ready to strike back'}.`;
    flags.stance = tell.stance;
  }
  let bubble = null;
  if (flags && !flags.playerLow && p > 0 && p / enc.player.maxHp <= LOW_HP) { flags.playerLow = true; bubble = say('lowHp', 'player'); }
  else if (flags && !flags.monsterLow && m > 0 && m / enc.monster.maxHp <= LOW_HP) { flags.monsterLow = true; bubble = say('lowHp', 'monster'); }
  push('status', text, { bubble, stance: tell });
  return beats;
}

/** Start time of each beat for a given speed. Beats never overlap: each starts when the previous ends. */
export function schedule(beats, beatMs) {
  let t = 0;
  return beats.map(b => {
    const start = t;
    const duration = beatMs;
    t += duration;
    return { ...b, start, duration };
  });
}

const sign = n => (n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`);
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
