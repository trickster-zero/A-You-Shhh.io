// Game UI: start screen -> floor map -> encounters -> chest -> floor end.
// All rules live in the engine (combat.js) and run state (run.js); this file only displays and forwards input.
import { createCharacter, createMonster } from './entity.js';
import { createRun } from './run.js';
import { createMapView } from './mapview.js';
import { getFloorDef } from './floor.js';

const STEP_MS = 420;        // delay between revealed steps of a combat round
const OUTCOME_DELAY = 600;  // pause before the outcome dialog
const ARRIVE_MS = 520;      // marker travel time before a fight starts

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
  win:    { title: 'Victory',   text: m => `The ${m} lies still.` },
  defeat: { title: 'Defeated',  text: m => `The ${m} stands over you. The dark keeps this one.` },
  fled:   { title: 'Escaped',   text: () => 'You fall back the way you came.' },
  draw:   { title: 'Stalemate', text: m => `Fifty rounds, and the ${m} gives no ground. You fall back.` }
};

const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export function mountGame(root, data, { seed = null } = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    screen: 'start',
    characterId: Object.keys(data.characters)[0],
    run: null, enc: null, meta: null,
    busy: false, menuOpen: false, runs: 0,
    ui: {}, map: null
  };

  document.addEventListener('keydown', onKey);
  showStart();

  /* =========================== Start =========================== */
  function showStart() {
    state.screen = 'start';
    state.run = null;
    const floorDef = getFloorDef(data.floors, 1);

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
          statList([['HP', c.maxHp], ['AC', c.ac], ['Attack', signed(c.attack.bonus)], ['Damage', damageText(c.attack)], ['Draughts', draughts]])
        ])
      ]);
    });

    const startBtn = el('button', { className: 'btn btn-primary', type: 'button' }, 'Enter the cave');
    startBtn.addEventListener('click', startRun);

    root.replaceChildren(el('section', { className: 'screen start-screen' }, [
      backLink(),
      el('h1', { className: 'display title' }, 'Into the tunnel'),
      el('p', { className: 'lede' }, 'The cave runs down in floors. Each floor ends at a chest, and something always guards it. Choose who goes in.'),
      el('fieldset', { className: 'choices' }, [el('legend', { className: 'sr-only' }, 'Choose a fighter'), ...choices]),
      el('p', { className: 'foe-line' }, `Floor 1: ${floorDef.name}. Goblins, a crevice, and a guarded chest.`),
      startBtn,
      el('p', { className: 'key-help' }, 'Keys: 1 or 2 to choose, Enter to start.')
    ]));
    focusSoon(root.querySelector('.choice-input:checked'));
  }

  function nextSeed() {
    state.runs += 1;
    if (seed == null) return String(Math.floor(Math.random() * 1e9));
    return state.runs === 1 ? seed : `${seed}-${state.runs}`;
  }

  function startRun() {
    state.run = createRun(data, { characterId: state.characterId, runSeed: nextSeed() });
    showMap();
  }

  /* =========================== Floor map =========================== */
  function showMap() {
    const { run } = state;
    state.screen = 'map';
    state.busy = false;
    const ui = state.ui = {};

    const mapBox = el('div', { className: 'map-box' });
    ui.here = el('div', { className: 'here-card' });
    ui.preview = el('p', { className: 'preview-line', ariaLive: 'polite' });
    ui.status = el('div', { className: 'status-card' });
    ui.drink = el('button', { className: 'btn btn-quiet', type: 'button', ariaKeyShortcuts: 'h' }, 'Drink draught (H)');
    ui.drink.addEventListener('click', drink);
    ui.context = el('button', { className: 'btn btn-primary', type: 'button', hidden: true });
    ui.context.addEventListener('click', contextAction);
    ui.log = el('ol', { className: 'log-list map-log', ariaLive: 'polite', ariaRelevant: 'additions', ariaLabel: 'Exploration log' });

    root.replaceChildren(el('section', { className: 'screen map-screen' }, [
      el('header', { className: 'enc-head' }, [
        backLink(),
        el('h1', { className: 'display title' }, `Floor ${run.floorNumber} · ${run.def.name}`),
        el('p', { className: 'round-count' }, `Seed ${run.runSeed}`)
      ]),
      el('div', { className: 'map-layout' }, [
        el('div', { className: 'map-col' }, [
          mapBox,
          el('p', { className: 'key-help' }, 'Click a lit passage or use the arrow keys. H drinks a draught.')
        ]),
        el('aside', { className: 'side-col' }, [
          ui.status, ui.here, ui.preview,
          el('div', { className: 'side-actions' }, [ui.context, ui.drink]),
          el('section', { className: 'log-panel map-log-panel', ariaLabel: 'Exploration log' }, [ui.log])
        ])
      ])
    ]));

    state.map = createMapView(mapBox, run, {
      onMove: id => travel(id),
      onPreview: id => preview(id)
    });
    run.log.forEach(line => appendLog(ui.log, line, 'note'));
    ui.logCount = run.log.length;
    refreshMap();
    focusSoon(root.querySelector('.node.is-reachable') || ui.context);
  }

  function refreshMap() {
    const { run, ui } = state;
    state.map.update();

    // new log lines since last refresh
    for (let i = ui.logCount; i < run.log.length; i++) appendLog(ui.log, run.log[i], classify(run.log[i]));
    ui.logCount = run.log.length;

    const p = run.player();
    const draughts = Object.entries(run.inventory).reduce((n, [id, c]) => n + (data.items.consumables[id]?.heal != null ? c : 0), 0);
    const tokens = run.inventory['save-token'] || 0;
    const fill = el('div', { className: 'hp-fill' });
    fill.style.width = `${(run.hp / p.maxHp) * 100}%`;
    const low = run.hp / p.maxHp <= 0.35;
    ui.status.replaceChildren(
      el('p', { className: 'fighter-role' }, 'You'),
      el('h2', { className: 'fighter-name display' }, p.name),
      el('div', {
        className: `hp-bar ${low ? 'is-low' : ''}`, role: 'progressbar',
        ariaValuemin: '0', ariaValuemax: String(p.maxHp), ariaValuenow: String(run.hp),
        ariaLabel: `${p.name} HP: ${run.hp} of ${p.maxHp}`
      }, [fill]),
      el('p', { className: 'hp-text' }, `${run.hp} / ${p.maxHp} HP`),
      statList([
        ['AC', p.ac], ['Weapon', `${p.attack.name} ${damageText(p.attack)}`],
        ['Gold', run.gold], ['Draughts', draughts], ...(tokens ? [['Save tokens', tokens]] : [])
      ])
    );

    const here = run.node(run.position);
    ui.here.replaceChildren(
      el('p', { className: 'fighter-role' }, 'You are at'),
      el('h3', { className: 'display here-title' }, here.label),
      el('p', { className: 'here-text' }, run.describe(here.id))
    );

    ui.drink.disabled = !run.canDrink() || state.busy;
    if (run.canOpenChest()) { ui.context.hidden = false; ui.context.textContent = 'Open chest (Enter)'; }
    else if (run.canDescend()) { ui.context.hidden = false; ui.context.textContent = 'Descend (Enter)'; }
    else ui.context.hidden = true;
    ui.context.disabled = state.busy;
  }

  function preview(id) {
    const { run, ui } = state;
    if (!ui.preview) return;
    if (!id || id === run.position) { ui.preview.textContent = ''; return; }
    const n = run.node(id);
    ui.preview.textContent = `${run.canMoveTo(id) ? 'Ahead' : 'Out of reach'}: ${n.label}. ${run.describe(id)}`;
  }

  async function travel(id) {
    const { run } = state;
    if (state.screen !== 'map' || state.busy) return;
    if (!run.canMoveTo(id)) { state.map.flash(id, 'is-denied'); return; }
    const ev = run.moveTo(id);
    refreshMap();

    if (ev.type === 'crevice' && !ev.success) {
      state.map.flash(id);
      requestAnimationFrame(() => state.map.focusNode(run.position));
      return;
    }
    if (ev.type === 'encounter') {
      state.busy = true;
      refreshMap();
      await wait(reduceMotion.matches ? 0 : ARRIVE_MS);
      state.busy = false;
      beginEncounter();
      return;
    }
    if (ev.type === 'chest' && run.canOpenChest()) focusSoon(state.ui.context);
    else requestAnimationFrame(() => state.map.focusNode(run.position));   // announces "You are here"
  }

  function drink() {
    if (!state.run.canDrink()) return;
    state.run.drinkDraught();
    refreshMap();
  }

  function contextAction() {
    const { run } = state;
    if (state.busy) return;
    if (run.canOpenChest()) {
      run.openChest();
      refreshMap();
      if (run.status === 'defeat') return setTimeout(() => showRunEnd('defeat'), reduceMotion.matches ? 0 : OUTCOME_DELAY);
      focusSoon(state.ui.context);
    } else if (run.canDescend()) {
      run.descend();
      showRunEnd('complete');
    }
  }

  function moveByArrow(dx, dy) {
    const { run } = state;
    const here = run.node(run.position);
    let best = null, bestScore = 0.35;
    for (const id of run.moves()) {
      const n = run.node(id);
      const vx = n.x - here.x, vy = n.y - here.y;
      const len = Math.hypot(vx, vy) || 1;
      const score = (vx * dx + vy * dy) / len;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (best) travel(best);
  }

  /* =========================== Encounter =========================== */
  function beginEncounter() {
    const { enc, meta } = state.run.startEncounter();
    state.enc = enc;
    state.meta = meta;
    state.busy = false;
    state.menuOpen = false;
    state.screen = 'encounter';
    renderEncounter();
  }

  function renderEncounter() {
    const { enc, meta } = state;
    const ui = state.ui = {};

    ui.round = el('p', { className: 'round-count' }, 'Round 0');
    ui.player = fighterCard(enc.player, 'player', 'You');
    ui.monster = fighterCard(enc.monster, 'monster', meta.total > 1 ? `Foe ${meta.index + 1} of ${meta.total}` : 'Foe');
    ui.log = el('ol', { className: 'log-list', ariaLive: 'polite', ariaRelevant: 'additions', ariaLabel: 'Combat log' });

    ui.buttons = {};
    const bar = el('div', { className: 'actions', role: 'group', ariaLabel: 'Actions' }, ACTIONS.map(def => {
      const count = el('span', { className: 'action-count' });
      const b = el('button', { className: `action action-${def.action}`, type: 'button', title: def.hint, ariaKeyShortcuts: def.key }, [
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
        el('h1', { className: 'display title' }, meta.node.label),
        ui.round
      ]),
      el('div', { className: 'arena' }, [ui.player.card, el('span', { className: 'versus display', ariaHidden: 'true' }, 'vs'), ui.monster.card]),
      el('section', { className: 'log-panel', ariaLabel: 'Combat log' }, [ui.log]),
      el('div', { className: 'action-dock' }, [ui.menu, bar]),
      el('p', { className: 'seed-line' }, `Seed ${state.run.runSeed}`),
      ui.overlay
    ]));

    enc.log.forEach(line => appendLog(ui.log, line, 'note'));
    updateHp(enc.player.hp, enc.monster.hp);
    refreshButtons();
    focusSoon(ui.buttons.light.el);
  }

  function fighterCard(c, side, role) {
    const fill = el('div', { className: 'hp-fill' });
    const bar = el('div', { className: 'hp-bar', role: 'progressbar', ariaValuemin: '0', ariaValuemax: String(c.maxHp), ariaValuenow: String(c.hp) }, [fill]);
    const text = el('p', { className: 'hp-text' });
    const card = el('article', { className: `fighter fighter-${side}` }, [
      el('p', { className: 'fighter-role' }, role),
      el('h2', { className: 'fighter-name display' }, c.name),
      bar, text,
      statList([['AC', c.ac], ['Attack', signed(c.attack.bonus)], ['Damage', damageText(c.attack)]])
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
    const focused = Object.entries(ui.buttons).find(([, b]) => b.el === document.activeElement)?.[0];
    const before = { p: enc.player.hp, m: enc.monster.hp };
    let result;
    try { result = enc.act(action, options); }
    catch (err) { appendLog(ui.log, err.message, 'error'); return; }

    state.busy = true;
    refreshButtons();
    await playRound(result, before);
    updateHp(enc.player.hp, enc.monster.hp);
    state.busy = false;
    refreshButtons();

    if (enc.outcome) {
      await wait(reduceMotion.matches ? 0 : OUTCOME_DELAY);
      showOutcome(state.run.finishEncounter());
    } else {
      const target = ui.buttons[options.item ? 'item' : focused || ''];
      if (target && !target.el.disabled) target.el.focus();
      else if (focused) ui.buttons.light.el.focus();
    }
  }

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
      } else if (ev.type === 'heal') { cls = 'heal'; delta = ev.restored; hit = 'player'; p = ev.after; }
      else if (ev.type === 'outcome') cls = 'outcome';
      else if (ev.type === 'flee') cls = ev.escaped ? 'heal' : 'miss';
      steps.push({ lines: lines.splice(0, n), p, m, cls, hit, delta, heal: ev.type === 'heal' });
    }
    if (lines.length || steps.some(s => !s.lines.length)) {
      return [{ lines: result.lines.slice(), p: state.enc.player.hp, m: state.enc.monster.hp, cls: 'note' }];
    }
    return steps;
  }

  async function playRound(result, before) {
    const steps = buildSteps(result, before);
    const delay = reduceMotion.matches ? 0 : STEP_MS;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (i > 0 && delay) await wait(delay);
      s.lines.forEach((line, j) => appendLog(state.ui.log, line, j === 0 ? s.cls : (s.cls === 'crit' || s.cls === 'hit' ? 'damage' : s.cls)));
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

  /* ---------- item menu ---------- */
  function openMenu() {
    const { enc, ui } = state;
    const items = Object.values(enc.player.inventory || {}).filter(i => i.count > 0);
    const buttons = items.map((item, i) => {
      const usable = item.heal != null;
      const b = el('button', { className: 'menu-item', type: 'button', disabled: !usable }, [
        el('span', { className: 'action-key', ariaHidden: 'true' }, String(i + 1)),
        el('span', { className: 'menu-name' }, item.name),
        el('span', { className: 'menu-meta' }, usable ? `${item.count} left · restores ${item.heal} HP` : `${item.count} left · no use in combat yet`)
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

  /* ---------- outcome dialog ---------- */
  function showOutcome(res) {
    const { enc, ui } = state;
    state.screen = 'outcome';
    const copy = OUTCOME_COPY[enc.outcome];
    const monster = enc.monster.name.toLowerCase();
    const pack = Object.values(enc.player.inventory || {}).reduce((n, i) => n + (i.heal != null ? i.count : 0), 0);

    let text = copy.text(monster);
    let buttons;
    if (res.outcome === 'win' && res.next === 'encounter') {
      text += ` ${res.remaining} more ${res.remaining === 1 ? 'goblin steps' : 'goblins step'} forward.`;
      buttons = [['Next fight', beginEncounter]];
    } else if (res.outcome === 'win') {
      text += ` ${state.meta.node.label} is clear.`;
      buttons = [['Continue', showMap]];
    } else if (res.outcome === 'defeat') {
      buttons = [['New run', startRun], ['Change fighter', showStart]];
    } else {
      buttons = [['Back to the map', showMap]];
    }

    const btnEls = buttons.map(([label, fn], i) => {
      const b = el('button', { className: `btn ${i === 0 ? 'btn-primary' : 'btn-quiet'}`, type: 'button' }, label);
      b.addEventListener('click', fn);
      return b;
    });
    const dialog = el('div', { className: `outcome is-${enc.outcome}`, role: 'dialog', ariaModal: 'true', ariaLabelledby: 'outcome-title' }, [
      el('h2', { className: 'display outcome-title', id: 'outcome-title' }, copy.title),
      el('p', { className: 'outcome-text' }, text),
      statList([['Rounds', enc.round], ['HP left', `${enc.player.hp} / ${enc.player.maxHp}`], ['Draughts', pack]]),
      el('div', { className: 'outcome-buttons' }, btnEls)
    ]);
    trapTab(dialog, btnEls);
    ui.overlay.replaceChildren(dialog);
    ui.overlay.hidden = false;
    focusSoon(btnEls[0]);
  }

  /* =========================== Run end =========================== */
  function showRunEnd(kind) {
    const { run } = state;
    state.screen = 'end';
    const p = run.player();
    const won = kind === 'complete';
    const newRun = el('button', { className: 'btn btn-primary', type: 'button' }, won ? 'New run' : 'Try again');
    const change = el('button', { className: 'btn btn-quiet', type: 'button' }, 'Change fighter');
    newRun.addEventListener('click', startRun);
    change.addEventListener('click', showStart);

    root.replaceChildren(el('section', { className: 'screen end-screen' }, [
      backLink(),
      el('div', { className: `outcome end-card ${won ? 'is-win' : 'is-defeat'}` }, [
        el('h1', { className: 'display outcome-title' }, won ? `Floor ${run.floorNumber} cleared` : 'Run over'),
        el('p', { className: 'outcome-text' }, won
          ? 'The chest is empty and the way down is open, but the stairs are sealed for now. Deeper floors are on their way.'
          : `${p.name} won't be leaving ${run.def.name.toLowerCase()}.`),
        statList([
          ['HP', `${run.hp} / ${p.maxHp}`], ['Gold', run.gold],
          ['Weapon', p.attack.name], ['Armor', p.armor.name],
          ['Save tokens', run.inventory['save-token'] || 0]
        ]),
        el('div', { className: 'outcome-buttons' }, [newRun, change])
      ])
    ]));
    focusSoon(newRun);
  }

  /* =========================== Keyboard =========================== */
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
        startRun();
      }
      return;
    }

    if (state.screen === 'map') {
      if (ARROWS[e.key]) { e.preventDefault(); moveByArrow(...ARROWS[e.key]); return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); drink(); return; }
      if (e.key === 'Enter' && !e.target.matches?.('button, a, .node')) {
        if (!state.ui.context.hidden) { e.preventDefault(); contextAction(); }
      }
      return;
    }

    if (state.screen !== 'encounter') return;

    if (state.menuOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
      const items = [...state.ui.menu.querySelectorAll('.menu-item')];
      const n = Number(e.key);
      if (n >= 1 && n <= items.length) { e.preventDefault(); if (!items[n - 1].disabled) items[n - 1].click(); }
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

/* =========================== Helpers =========================== */
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

function appendLog(list, text, cls = 'note') {
  list.append(el('li', { className: `log-line is-${cls}` }, text));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.scrollTo({ top: list.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
}

function classify(line) {
  if (/Failure|bites|collapses|falls|can't fit/i.test(line)) return 'miss';
  if (/Inside:|Disarmed|squeeze through|clear\.|\+\d+ HP/i.test(line)) return 'heal';
  if (/block|blocks|guards/i.test(line)) return 'hit';
  return 'note';
}

function trapTab(dialog, order) {
  dialog.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || order.length < 1) return;
    const i = order.indexOf(document.activeElement);
    e.preventDefault();
    order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
}

function statList(pairs) {
  return el('dl', { className: 'stat-list' }, pairs.map(([k, v]) => el('div', {}, [el('dt', {}, k), el('dd', {}, String(v))])));
}

function backLink() { return el('a', { className: 'back-link', href: '../index.html' }, 'Back to the base'); }

const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const damageText = a => (a.modifier ? `${a.dice}${a.modifier > 0 ? '+' : '−'}${Math.abs(a.modifier)}` : a.dice);
const wait = ms => new Promise(r => setTimeout(r, ms));
const focusSoon = node => { if (node) requestAnimationFrame(() => node.focus()); };
