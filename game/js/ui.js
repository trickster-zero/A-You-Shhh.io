// Encounter UI: start screen, encounter screen, outcome screen.
// All game rules live in the engine; this file only displays state and forwards actions.
import { createCharacter, createMonster } from './entity.js';
import { createEncounter } from './combat.js';

const STEP_MS = 420;        // delay between revealed steps of a round
const OUTCOME_DELAY = 600;  // pause before the outcome screen

const ACTIONS = [
  { key: '1', action: 'light', label: 'Light', hint: 'Normal attack' },
  { key: '2', action: 'hard',  label: 'Hard',  hint: '−2 to hit, best of two damage rolls' },
  { key: '3', action: 'flee',  label: 'Flee',  hint: 'Try to escape' },
  { key: '4', action: 'heal',  label: 'Heal',  hint: 'Drink a healing draught' },
  { key: '5', action: 'item',  label: 'Item',  hint: 'Open your pack' }
];

const BLURBS = {
  scout: 'Light on their feet and hard to pin down. Strikes with finesse.',
  guard: 'Chain and a heavy mace. Slow to fall, slow to flee.'
};

const OUTCOME_COPY = {
  win:    { title: 'Victory',   text: m => `The ${m} lies still. The way ahead is clear.`, primary: 'continue', secondary: 'again' },
  defeat: { title: 'Defeated',  text: m => `The ${m} stands over you. The dark keeps this one.`, primary: 'retry', secondary: 'change' },
  fled:   { title: 'Escaped',   text: m => `You slip back into the dark. The ${m} lets you go, this time.`, primary: 'continue', secondary: 'again' },
  draw:   { title: 'Stalemate', text: m => `Fifty rounds, and neither you nor the ${m} gives ground.`, primary: 'retry', secondary: 'change' }
};

const BUTTON_TEXT = { continue: 'Continue', retry: 'Retry', again: 'Fight again', change: 'Change fighter' };

export function mountGame(root, data, { seed = null } = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    screen: 'start',
    characterId: Object.keys(data.characters)[0],
    monsterId: Object.keys(data.monsters)[0],
    enc: null, busy: false, menuOpen: false, runs: 0, seed: null,
    ui: {}
  };

  document.addEventListener('keydown', onKey);
  showStart();

  /* ======================= Start screen ======================= */
  function showStart() {
    state.screen = 'start';
    state.enc = null;
    const monster = createMonster(data.monsters[state.monsterId]);

    const choices = Object.values(data.characters).map((preset, i) => {
      const c = createCharacter(preset, data.items);
      const input = el('input', { type: 'radio', name: 'fighter', value: preset.id, className: 'choice-input' });
      input.checked = preset.id === state.characterId;
      input.addEventListener('change', () => { state.characterId = preset.id; });
      const draughts = Object.values(c.inventory).reduce((n, it) => n + (it.heal != null ? it.count : 0), 0);
      return el('label', { className: 'choice' }, [
        input,
        el('span', { className: 'choice-card' }, [
          el('span', { className: 'choice-key', ariaHidden: 'true' }, String(i + 1)),
          el('span', { className: 'choice-name display' }, c.name),
          el('span', { className: 'choice-blurb' }, preset.blurb || BLURBS[preset.id] || `${c.armor.name}, ${c.attack.name.toLowerCase()}.`),
          statList([
            ['HP', c.maxHp], ['AC', c.ac],
            ['Attack', signed(c.attack.bonus)], ['Damage', damageText(c.attack)],
            ['Draughts', draughts]
          ])
        ])
      ]);
    });

    const startBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Start encounter');
    startBtn.addEventListener('click', startEncounter);

    root.replaceChildren(el('section', { className: 'screen start-screen' }, [
      backLink(),
      el('h1', { className: 'display title' }, 'Into the tunnel'),
      el('p', { className: 'lede' }, `Something moves in the dark ahead. A ${monster.name.toLowerCase()}, by the smell of it. Choose who goes in.`),
      el('fieldset', { className: 'choices' }, [el('legend', { className: 'sr-only' }, 'Choose a fighter'), ...choices]),
      el('p', { className: 'foe-line' }, `Opponent: ${monster.name}, ${monster.maxHp} HP, AC ${monster.ac}.`),
      startBtn,
      el('p', { className: 'key-help' }, 'Keys: 1 or 2 to choose, Enter to start.')
    ]));
    focusSoon(root.querySelector('.choice-input:checked'));
  }

  /* ======================= Encounter screen ======================= */
  function nextSeed() {
    state.runs += 1;
    if (seed == null) return String(Math.floor(Math.random() * 1e9));
    return state.runs === 1 ? seed : `${seed}-${state.runs}`;
  }

  function startEncounter() {
    const player = createCharacter(data.characters[state.characterId], data.items);
    const monster = createMonster(data.monsters[state.monsterId]);
    state.seed = nextSeed();
    state.enc = createEncounter(player, monster, state.seed);
    state.busy = false;
    state.menuOpen = false;
    state.screen = 'encounter';
    renderEncounter();
  }

  function renderEncounter() {
    const { enc } = state;
    const ui = state.ui = {};

    ui.round = el('p', { className: 'round-count' }, 'Round 0');
    ui.player = fighterCard(enc.player, 'player', 'You');
    ui.monster = fighterCard(enc.monster, 'monster', 'Foe');

    ui.log = el('ol', { className: 'log-list', ariaLive: 'polite', ariaRelevant: 'additions', ariaLabel: 'Combat log' });
    const logPanel = el('section', { className: 'log-panel', ariaLabel: 'Combat log' }, [ui.log]);

    ui.buttons = {};
    const bar = el('div', { className: 'actions', role: 'group', ariaLabel: 'Actions' }, ACTIONS.map(def => {
      const count = el('span', { className: 'action-count' });
      const b = el('button', {
        className: `action action-${def.action}`, type: 'button', title: def.hint,
        ariaKeyShortcuts: def.key
      }, [
        el('span', { className: 'action-key', ariaHidden: 'true' }, def.key),
        el('span', { className: 'action-label' }, def.label),
        el('span', { className: 'action-hint' }, def.hint),
        count
      ]);
      b.addEventListener('click', () => trigger(def.action));
      ui.buttons[def.action] = { el: b, count };
      return b;
    }));

    ui.menu = el('div', { className: 'item-menu', role: 'dialog', ariaLabel: 'Your pack', hidden: true });
    ui.overlay = el('div', { className: 'outcome-overlay', hidden: true });

    root.replaceChildren(el('section', { className: 'screen encounter-screen' }, [
      el('header', { className: 'enc-head' }, [
        backLink(),
        el('h1', { className: 'display title' }, `A ${enc.monster.name.toLowerCase()} blocks the way`),
        ui.round
      ]),
      el('div', { className: 'arena' }, [ui.player.card, el('span', { className: 'versus display', ariaHidden: 'true' }, 'vs'), ui.monster.card]),
      logPanel,
      el('div', { className: 'action-dock' }, [ui.menu, bar]),
      el('p', { className: 'seed-line' }, `Seed ${state.seed}`),
      ui.overlay
    ]));

    enc.log.forEach(line => addLine(line, 'note'));
    updateHp(enc.player.hp, enc.monster.hp);
    refreshButtons();
    focusSoon(ui.buttons.light.el);
  }

  function fighterCard(c, side, role) {
    const fill = el('div', { className: 'hp-fill' });
    const bar = el('div', {
      className: 'hp-bar', role: 'progressbar',
      ariaValuemin: '0', ariaValuemax: String(c.maxHp), ariaValuenow: String(c.hp)
    }, [fill]);
    const text = el('p', { className: 'hp-text' });
    const stats = [['AC', c.ac], ['Attack', signed(c.attack.bonus)], ['Damage', damageText(c.attack)]];
    const card = el('article', { className: `fighter fighter-${side}` }, [
      el('p', { className: 'fighter-role' }, role),
      el('h2', { className: 'fighter-name display' }, c.name),
      bar, text, statList(stats)
    ]);
    return { card, bar, fill, text, max: c.maxHp, name: c.name };
  }

  function updateHp(playerHp, monsterHp) {
    setBar(state.ui.player, playerHp);
    setBar(state.ui.monster, monsterHp);
  }

  function setBar(f, hp) {
    const ratio = Math.max(0, hp) / f.max;
    f.fill.style.width = `${ratio * 100}%`;
    f.bar.setAttribute('aria-valuenow', String(hp));
    f.bar.setAttribute('aria-label', `${f.name} HP: ${hp} of ${f.max}`);
    f.text.textContent = `${hp} / ${f.max} HP`;
    f.card.classList.toggle('is-low', ratio > 0 && ratio <= 0.35);
    f.card.classList.toggle('is-down', hp <= 0);
  }

  function refreshButtons() {
    const { enc, ui } = state;
    const avail = new Set(enc.availableActions());
    const inv = Object.values(enc.player.inventory || {});
    const healing = inv.filter(i => i.heal != null).reduce((n, i) => n + i.count, 0);
    const packCount = inv.reduce((n, i) => n + i.count, 0);

    for (const def of ACTIONS) {
      const b = ui.buttons[def.action];
      let enabled = !state.busy && !enc.outcome;
      if (def.action === 'heal') { enabled = enabled && avail.has('heal'); b.count.textContent = `×${healing}`; }
      else if (def.action === 'item') { enabled = enabled && packCount > 0; b.count.textContent = `×${packCount}`; }
      else enabled = enabled && avail.has(def.action);
      b.el.disabled = !enabled;
    }
    ui.round.textContent = `Round ${enc.round}`;
  }

  /* ======================= Actions ======================= */
  function trigger(action) {
    if (state.screen !== 'encounter' || state.busy || state.enc.outcome) return;
    const b = state.ui.buttons[action];
    if (!b || b.el.disabled) return;
    if (action === 'item') return state.menuOpen ? closeMenu() : openMenu();
    closeMenu(false);
    perform(action);
  }

  async function perform(action, options = {}) {
    const { enc, ui } = state;
    const focusedAction = Object.entries(ui.buttons).find(([, b]) => b.el === document.activeElement)?.[0];
    const before = { p: enc.player.hp, m: enc.monster.hp };

    let result;
    try {
      result = enc.act(action, options);
    } catch (err) {
      addLine(err.message, 'error');
      return;
    }

    state.busy = true;
    refreshButtons();
    await playRound(result, before);
    updateHp(enc.player.hp, enc.monster.hp);   // final sync with engine state
    state.busy = false;
    refreshButtons();

    if (enc.outcome) {
      await wait(reduceMotion.matches ? 0 : OUTCOME_DELAY);
      showOutcome();
    } else {
      const target = ui.buttons[action === 'heal' && options.item ? 'item' : focusedAction || ''];
      if (target && !target.el.disabled) target.el.focus();
      else if (focusedAction) ui.buttons.light.el.focus();
    }
  }

  /** Splits a round into steps (log lines + HP at that moment) using the round's events. */
  function buildSteps(result, before) {
    const lines = result.lines.slice();
    let p = before.p, m = before.m;
    const steps = [{ lines: lines.splice(0, 1), p, m, cls: 'round' }];

    for (const ev of result.events) {
      let n = 1, cls = 'note', hit = null, delta = 0;
      if (ev.type === 'attack') {
        const landed = ev.damage != null;
        n = landed ? 2 : 1;
        cls = ev.roll.crit ? 'crit' : landed ? 'hit' : 'miss';
        if (landed) {
          delta = -ev.damage;
          if (ev.by === 'player') { m = Math.max(0, m - ev.damage); hit = 'monster'; }
          else { p = Math.max(0, p - ev.damage); hit = 'player'; }
        }
      } else if (ev.type === 'heal') {
        cls = 'heal'; delta = ev.restored; hit = 'player'; p = ev.after;
      } else if (ev.type === 'outcome') {
        cls = 'outcome';
      } else if (ev.type === 'flee') {
        cls = ev.escaped ? 'heal' : 'miss';
      }
      steps.push({ lines: lines.splice(0, n), p, m, cls, hit, delta, heal: ev.type === 'heal' });
    }

    const mismatch = lines.length > 0 || steps.some(s => s.lines.length === 0);
    if (mismatch) return [{ lines: result.lines.slice(), p: state.enc.player.hp, m: state.enc.monster.hp, cls: 'note' }];
    return steps;
  }

  async function playRound(result, before) {
    const steps = buildSteps(result, before);
    const delay = reduceMotion.matches ? 0 : STEP_MS;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (i > 0 && delay) await wait(delay);
      s.lines.forEach((line, j) => addLine(line, j === 0 ? s.cls : (s.cls === 'crit' || s.cls === 'hit' ? 'damage' : s.cls)));
      updateHp(s.p, s.m);
      if (s.hit) feedback(s.hit === 'player' ? state.ui.player : state.ui.monster, s.delta, s.heal);
    }
  }

  function feedback(f, delta, heal) {
    if (!delta) return;
    const float = el('span', { className: `float ${heal ? 'is-heal' : 'is-dmg'}`, ariaHidden: 'true' }, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
    f.card.append(float);
    f.card.classList.remove('is-hit', 'is-healed');
    void f.card.offsetWidth;
    f.card.classList.add(heal ? 'is-healed' : 'is-hit');
    setTimeout(() => float.remove(), 1000);
  }

  function addLine(text, cls = 'note') {
    const li = el('li', { className: `log-line is-${cls}` }, text);
    state.ui.log.append(li);
    state.ui.log.scrollTo({ top: state.ui.log.scrollHeight, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  /* ======================= Item menu ======================= */
  function openMenu() {
    const { enc, ui } = state;
    const items = Object.values(enc.player.inventory || {}).filter(i => i.count > 0);
    const buttons = items.map((item, i) => {
      const usable = item.heal != null;
      const b = el('button', { className: 'menu-item', type: 'button', disabled: !usable }, [
        el('span', { className: 'action-key', ariaHidden: 'true' }, String(i + 1)),
        el('span', { className: 'menu-name' }, item.name),
        el('span', { className: 'menu-meta' }, usable
          ? `${item.count} left · restores ${item.heal} HP`
          : `${item.count} left · no use in combat yet`)
      ]);
      b.addEventListener('click', () => { closeMenu(false); perform('heal', { item: item.id }); });
      return b;
    });
    const cancel = el('button', { className: 'menu-cancel', type: 'button' }, 'Close (Esc)');
    cancel.addEventListener('click', () => closeMenu());

    ui.menu.replaceChildren(
      el('p', { className: 'menu-title display' }, 'Your pack'),
      ...(buttons.length ? buttons : [el('p', { className: 'menu-empty' }, 'Your pack is empty.')]),
      cancel
    );
    ui.menu.hidden = false;
    state.menuOpen = true;
    ui.buttons.item.el.setAttribute('aria-expanded', 'true');
    focusSoon(ui.menu.querySelector('.menu-item:not([disabled])') || cancel);
  }

  function closeMenu(returnFocus = true) {
    if (!state.menuOpen) return;
    state.menuOpen = false;
    state.ui.menu.hidden = true;
    state.ui.buttons.item.el.setAttribute('aria-expanded', 'false');
    if (returnFocus && !state.ui.buttons.item.el.disabled) state.ui.buttons.item.el.focus();
  }

  /* ======================= Outcome ======================= */
  function showOutcome() {
    const { enc, ui } = state;
    state.screen = 'outcome';
    const copy = OUTCOME_COPY[enc.outcome];
    const draughts = Object.values(enc.player.inventory || {}).reduce((n, i) => n + i.count, 0);

    const primary = el('button', { className: 'btn btn-primary', type: 'button' }, BUTTON_TEXT[copy.primary]);
    const secondary = el('button', { className: 'btn btn-quiet', type: 'button' }, BUTTON_TEXT[copy.secondary]);
    primary.addEventListener('click', () => outcomeAction(copy.primary));
    secondary.addEventListener('click', () => outcomeAction(copy.secondary));

    const dialog = el('div', {
      className: `outcome is-${enc.outcome}`, role: 'dialog', ariaModal: 'true', ariaLabelledby: 'outcome-title'
    }, [
      el('h2', { className: 'display outcome-title', id: 'outcome-title' }, copy.title),
      el('p', { className: 'outcome-text' }, copy.text(enc.monster.name.toLowerCase())),
      statList([['Rounds', enc.round], ['HP left', `${enc.player.hp} / ${enc.player.maxHp}`], ['Pack', draughts]]),
      el('div', { className: 'outcome-buttons' }, [primary, secondary])
    ]);
    dialog.addEventListener('keydown', e => {      // keep Tab inside the dialog
      if (e.key !== 'Tab') return;
      const order = [primary, secondary];
      const i = order.indexOf(document.activeElement);
      e.preventDefault();
      order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
    });

    ui.overlay.replaceChildren(dialog);
    ui.overlay.hidden = false;
    focusSoon(primary);
  }

  function outcomeAction(kind) {
    if (kind === 'retry' || kind === 'again') startEncounter();
    else showStart();   // "continue" and "change" both return here until the cave map exists
  }

  /* ======================= Keyboard ======================= */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches?.('input[type="text"], textarea, select')) return;

    if (state.screen === 'start') {
      const presets = Object.keys(data.characters);
      const n = Number(e.key);
      if (n >= 1 && n <= presets.length) {
        state.characterId = presets[n - 1];
        const input = root.querySelector(`.choice-input[value="${presets[n - 1]}"]`);
        if (input) { input.checked = true; input.focus(); }
        e.preventDefault();
      } else if (e.key === 'Enter' && !e.target.matches?.('button, a')) {
        e.preventDefault();
        startEncounter();
      }
      return;
    }

    if (state.screen !== 'encounter') return;

    if (state.menuOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
      const items = [...state.ui.menu.querySelectorAll('.menu-item')];
      const n = Number(e.key);
      if (n >= 1 && n <= items.length) {
        e.preventDefault();
        if (!items[n - 1].disabled) items[n - 1].click();
      }
      return;
    }

    const def = ACTIONS.find(d => d.key === e.key);
    if (!def) return;
    e.preventDefault();
    const b = state.ui.buttons[def.action];
    if (b && !b.el.disabled) {
      b.el.classList.add('is-pressed');
      setTimeout(() => b.el.classList.remove('is-pressed'), 160);
    }
    trigger(def.action);
  }
}

/* ======================= Helpers ======================= */
function el(tag, props = {}, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'className') n.className = v;
    else if (k.startsWith('aria')) n.setAttribute(`aria-${k.slice(4).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-/, '')}`, v);
    else if (k === 'hidden' || k === 'disabled') n[k] = Boolean(v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (children != null) (Array.isArray(children) ? children : [children]).forEach(c => n.append(c));
  return n;
}

function statList(pairs) {
  return el('dl', { className: 'stat-list' }, pairs.map(([k, v]) =>
    el('div', {}, [el('dt', {}, k), el('dd', {}, String(v))])));
}

function backLink() {
  return el('a', { className: 'back-link', href: '../index.html' }, 'Back to the base');
}

const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const damageText = a => (a.modifier ? `${a.dice}${a.modifier > 0 ? '+' : '−'}${Math.abs(a.modifier)}` : a.dice);
const wait = ms => new Promise(r => setTimeout(r, ms));
const focusSoon = node => { if (node) requestAnimationFrame(() => node.focus()); };
