// Game UI: start screen -> floor map -> encounters -> chest -> floor end.
// All rules live in the engine (combat.js) and run state (run.js); this file only displays and forwards input.
import { createCharacter, createMonster } from './entity.js';
import { createRun } from './run.js';
import { createMapView } from './mapview.js';
import { getFloorDef } from './floor.js';
import { buildBeats, createLinePicker, SPEEDS } from './beats.js';
import { telegraph } from './ai.js';

const OUTCOME_DELAY = 600;  // pause before a run-ending screen
const ARRIVE_MS = 520;      // marker travel time before a fight starts
const SPEED_KEY = 'aayush-rpg:speed';

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

export function mountGame(root, data, { seed = null, view = null } = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    screen: 'start',
    characterId: Object.keys(data.characters)[0],
    run: null, enc: null, meta: null,
    busy: false, menuOpen: false, runs: 0,
    speed: loadSpeed(reduceMotion.matches),
    ui: {}, map: null,
    mode: '2d',                       // '2d' map or 'cave' (3D)
    prefer3d: view !== '2d',
    cave: null, caveUi: null, caveFailed: false
  };

  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  showStart();

  /* =========================== Page lifecycle =========================== */
  let pausedByHide = false;
  function onVisibility() {
    if (!state.cave) return;
    if (document.hidden) {
      if (!state.cave.isPaused()) { state.cave.pause(); pausedByHide = true; }
    } else if (pausedByHide) {
      pausedByHide = false;
      if (state.screen === 'cave') state.cave.resume();   // stays paused if a fight or the 2D map is open
    }
  }

  function returnToBase() {
    state.cave?.pause();
    const link = document.querySelector('.return-link');
    location.href = link ? link.href : '../index.html';
  }

  // returned to main.js: back/forward cache restores call reset()
  const api = {
    reset() { pausedByHide = false; state.busy = false; state.menuOpen = false; showStart(); },
    returnToBase
  };

  /* =========================== Start =========================== */
  function showStart() {
    setCombat(false);
    destroyCave();
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
      el('h1', { className: 'display title' }, 'The Sunken Cave'),
      el('p', { className: 'lede' }, 'The cave runs down in floors. Each floor ends at a chest, and something always guards it. Choose who goes in.'),
      el('fieldset', { className: 'choices' }, [el('legend', { className: 'sr-only' }, 'Choose a fighter'), ...choices]),
      el('p', { className: 'foe-line' }, `Floor 1: ${floorDef.name}. Goblins, a crevice, and a guarded chest.`),
      startBtn,
      el('p', { className: 'key-help' }, 'Keys: 1 or 2 to choose, Enter to start, Esc to return to the base.')
    ]));
    focusSoon(startBtn);                      // keyboard focus lands on the button
  }

  function nextSeed() {
    state.runs += 1;
    if (seed == null) return String(Math.floor(Math.random() * 1e9));
    return state.runs === 1 ? seed : `${seed}-${state.runs}`;
  }

  function startRun() {
    destroyCave();
    state.run = createRun(data, { characterId: state.characterId, runSeed: nextSeed() });
    if (state.prefer3d && canUse3d()) showCave();
    else showMap();
  }

  function canUse3d() { return !state.caveFailed && hasWebGL(); }

  /* =========================== Floor map =========================== */
  function showMap() {
    setCombat(false);
    const { run } = state;
    state.cave?.pause();
    state.mode = '2d';
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
          el('h1', { className: 'display title' }, `Floor ${run.floorNumber} · ${run.def.name}`),
        el('div', { className: 'head-right' }, [
          ...(canUse3d() ? [viewButton('3D view (M)', showCave)] : []),
          el('p', { className: 'round-count' }, `Seed ${run.runSeed}`)
        ])
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
    state.map.update();
    fillSide(state.ui);
  }

  function refreshExplore() { if (state.mode === 'cave') refreshCave(); else refreshMap(); }

  /** Status card, "you are at", context button, drink button, and new log lines. Shared by the 2D map and the 3D HUD. */
  function fillSide(ui) {
    const { run } = state;

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
      el('p', { className: 'fighter-role' }, `You · level ${run.level}`),
      el('h2', { className: 'fighter-name display' }, p.name),
      el('div', {
        className: `hp-bar ${low ? 'is-low' : ''}`, role: 'progressbar',
        ariaValuemin: '0', ariaValuemax: String(p.maxHp), ariaValuenow: String(run.hp),
        ariaLabel: `${p.name} HP: ${run.hp} of ${p.maxHp}`
      }, [fill]),
      el('p', { className: 'hp-text' }, `${run.hp} / ${p.maxHp} HP`),
      statList([
        ['Level', run.level], ['XP', (() => { const x = run.xpProgress(); return x.next ? `${x.xp} / ${x.next}` : `${x.xp}`; })()],
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
    const near = state.mode !== 'cave' || !!state.cave?.nearChest();
    const key = state.mode === 'cave' ? 'E' : 'Enter';
    if (run.canOpenChest() && near) { ui.context.hidden = false; ui.context.textContent = `Open chest (${key})`; }
    else if (run.canDescend() && near) { ui.context.hidden = false; ui.context.textContent = `Descend (${key})`; }
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
    refreshExplore();
  }

  function contextAction() {
    const { run } = state;
    if (state.busy) return;
    if (state.mode === 'cave' && (run.canOpenChest() || run.canDescend()) && !state.cave?.nearChest()) {
      toast('Get next to the chest first.');
      return;
    }
    if (run.canOpenChest()) {
      run.openChest();
      state.cave?.refresh();
      refreshExplore();
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

  /* =========================== 3D cave =========================== */
  async function showCave() {
    setCombat(false);
    const { run } = state;
    state.mode = 'cave';
    state.screen = 'cave';
    state.busy = false;
    const u = state.caveUi = {};

    u.host = el('div', { className: 'cave-view' }, [el('p', { className: 'loading' }, 'Lighting the torches…')]);
    u.overlay = el('div', { className: 'cave-overlay', hidden: true });
    u.status = el('div', { className: 'status-card' });
    u.here = el('div', { className: 'here-card' });
    u.drink = el('button', { className: 'btn btn-quiet', type: 'button', ariaKeyShortcuts: 'h' }, 'Drink draught (H)');
    u.drink.addEventListener('click', drink);
    u.context = el('button', { className: 'btn btn-primary', type: 'button', hidden: true });
    u.context.addEventListener('click', contextAction);
    u.log = el('ol', { className: 'log-list map-log', ariaLive: 'polite', ariaRelevant: 'additions', ariaLabel: 'Exploration log' });
    u.toast = el('p', { className: 'cave-toast', role: 'status' });
    u.minimapBox = el('div', { className: 'minimap', ariaHidden: 'true' });
    u.minimapBox.setAttribute('inert', '');
    u.dpad = dpadEl();

    root.replaceChildren(el('section', { className: 'cave-screen' }, [
      u.host,
      el('header', { className: 'cave-top' }, [
          el('h1', { className: 'display cave-title' }, `Floor ${run.floorNumber} · ${run.def.name}`),
        el('div', { className: 'cave-top-right' }, [viewButton('2D map (M)', showMap), el('span', { className: 'round-count' }, `Seed ${run.runSeed}`)])
      ]),
      el('aside', { className: 'cave-side' }, [
        u.status, u.here,
        el('div', { className: 'side-actions' }, [u.context, u.drink]),
        el('section', { className: 'log-panel map-log-panel', ariaLabel: 'Exploration log' }, [u.log])
      ]),
      u.minimapBox, u.toast,
      el('p', { className: 'cave-hint' }, 'WASD or arrow keys to move · E to interact · H to drink · M for the 2D map'),
      u.dpad, u.overlay
    ]));

    u.minimap = createMapView(u.minimapBox, run, { onMove() {}, onPreview() {} });
    u.marker = u.minimapBox.querySelector('.player-marker');
    run.log.forEach(line => appendLog(u.log, line, classify(line)));
    u.logCount = run.log.length;

    if (!state.cave) {
      try {
        const mod = await import('./cave3d/main.js');
        if (state.caveUi !== u) return;                        // switched away while loading
        state.cave = mod.mountCave(u.host, { run, dpad: u.dpad, hooks: caveHooks() });
      } catch (err) {
        console.warn('3D view unavailable, using the 2D map.', err);
        state.caveFailed = true;
        return showMap();
      }
    } else {
      state.cave.attach(u.host);
    }
    u.host.querySelector('.loading')?.remove();
    if (window.RPG) window.RPG.cave = state.cave;
    state.cave.syncToRun();
    refreshCave();
    if (state.screen === 'cave') state.cave.resume();
  }

  function caveHooks() {
    return {
      onEvent: ev => {
        refreshCave();
        if (ev.type === 'crevice' && !ev.success) toast("Too tight. You can't fit through.");
      },
      onEncounter: () => beginEncounter(),
      onArrive: () => refreshCave(),
      onBump: reason => { if (reason === 'blocked') toast('The crevice is too tight for you.'); },
      onFrame: pos => { const m = state.caveUi?.marker; if (m) m.style.transform = `translate(${pos.x}px, ${pos.y}px)`; },
      onInteract: () => contextAction()
    };
  }

  function refreshCave() {
    const u = state.caveUi;
    if (!u || !state.run) return;
    u.minimap.update();
    fillSide(u);
  }

  /** Back to exploring after a fight: the 3D cave if we came from it, otherwise the 2D map. */
  function explore(res) {
    setCombat(false);
    if (state.mode === 'cave' && state.cave && state.caveUi) {
      state.screen = 'cave';
      const u = state.caveUi;
      u.overlay.hidden = true;
      u.overlay.replaceChildren();
      state.cave.afterFight(res || {});
      refreshCave();
      state.cave.resume();
      document.activeElement?.blur?.();
    } else {
      showMap();
    }
  }

  function destroyCave() {
    state.cave?.destroy();
    state.cave = null;
    state.caveUi = null;
    if (window.RPG) window.RPG.cave = null;
  }

  function toast(text) {
    const t = state.caveUi?.toast;
    if (!t) return;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function encounterHost() {
    if (state.mode === 'cave' && state.caveUi) {
      state.caveUi.overlay.hidden = false;
      return state.caveUi.overlay;
    }
    return root;
  }

  /* =========================== Encounter =========================== */
  function setCombat(on) { document.body.classList.toggle('is-combat', on); }

  function beginEncounter() {
    setCombat(true);
    const { enc, meta } = state.run.startEncounter();
    state.enc = enc;
    state.meta = meta;
    state.pick = createLinePicker(data.lines, `${state.run.runSeed}:${meta.node.id}:${meta.index}:${enc.seed}`);
    state.flags = { stance: telegraph(enc.monster).stance };
    state.busy = false;
    state.menuOpen = false;
    state.screen = 'encounter';
    renderEncounter();
  }

  function renderEncounter() {
    const { enc, meta } = state;
    const ui = state.ui = {};

    ui.round = el('p', { className: 'round-count' }, 'Round 0');
    ui.player = fighterCard(enc.player, 'player', `You · level ${state.run.level}`);
    ui.monster = fighterCard(enc.monster, 'monster', meta.total > 1 ? `Foe ${meta.index + 1} of ${meta.total}` : 'Foe');
    ui.log = el('ol', { className: 'log-list log-rounds', ariaLive: 'polite', ariaRelevant: 'additions', ariaLabel: 'Combat log' });

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

    encounterHost().replaceChildren(el('section', { className: 'screen encounter-screen' }, [
      el('header', { className: 'enc-head' }, [
          el('h1', { className: 'display title' }, meta.node.label),
        el('div', { className: 'head-right' }, [speedControl(), ui.round])
      ]),
      el('div', { className: 'arena' }, [ui.player.wrap, el('span', { className: 'versus display', ariaHidden: 'true' }, 'vs'), ui.monster.wrap]),
      el('section', { className: 'log-panel', ariaLabel: 'Combat log' }, [ui.log]),
      el('div', { className: 'action-dock' }, [ui.menu, bar]),
      el('p', { className: 'seed-line' }, `Seed ${state.run.runSeed}`),
      ui.overlay
    ]));

    const intro = startRoundGroup('Before the fight');
    enc.log.forEach(line => addBeatLine(intro, { kind: 'note', text: line }));
    updateHp(enc.player.hp, enc.monster.hp);
    updateStance(telegraph(enc.monster));
    refreshButtons();
    focusSoon(ui.buttons.light.el);
  }

  function fighterCard(c, side, role) {
    const fill = el('div', { className: 'hp-fill' });
    const bar = el('div', { className: 'hp-bar', role: 'progressbar', ariaValuemin: '0', ariaValuemax: String(c.maxHp), ariaValuenow: String(c.hp) }, [fill]);
    const text = el('p', { className: 'hp-text' });
    const bubble = el('div', { className: `bubble bubble-${side}`, ariaHidden: 'true' });
    const stance = side === 'monster' ? el('div', { className: 'stance' }) : null;
    const card = el('article', { className: `fighter fighter-${side}` }, [
      el('p', { className: 'fighter-role' }, role),
      el('h2', { className: 'fighter-name display' }, c.name),
      bar, text,
      statList([['AC', c.ac], ['Attack', signed(c.attack.bonus)], ['Damage', damageText(c.attack)]]),
      ...(stance ? [stance] : [])
    ]);
    const wrap = el('div', { className: `fighter-wrap fighter-wrap-${side}` }, [bubble, card]);
    return { wrap, card, bar, fill, text, bubble, stance, max: c.maxHp, name: c.name };
  }

  function updateStance(tell) {
    const box = state.ui.monster?.stance;
    if (!box || !tell) return;
    const st = data.lines?.stances || {};
    const main = st[tell.stance] || { label: tell.stance, line: '' };
    const chips = [el('span', { className: `stance-chip is-${tell.stance}` }, [icon(tell.stance), main.label])];
    if (tell.flee) chips.push(el('span', { className: `stance-chip is-${tell.flee}`, title: st[tell.flee]?.line || '' }, [icon(tell.flee), st[tell.flee]?.label || tell.flee]));
    box.replaceChildren(
      el('div', { className: 'stance-chips' }, chips),
      el('p', { className: 'stance-line' }, main.line)
    );
    box.setAttribute('aria-label', `Stance: ${main.label}. ${main.line} ${tell.flee ? st[tell.flee]?.line || '' : ''}`);
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
    const itemName = action === 'heal' ? enc.healingItem(options.item)?.name : null;

    let result;
    try { result = enc.act(action, options); }
    catch (err) { addBeatLine(startRoundGroup('Note'), { kind: 'note', tone: 'hurt', text: err.message }); return; }

    state.busy = true;                       // buttons stay disabled until every beat has finished
    refreshButtons();
    const beats = buildBeats(result, { enc, before, pick: state.pick, flags: state.flags, item: itemName });
    await playBeats(beats, result.round);
    updateHp(enc.player.hp, enc.monster.hp);
    state.busy = false;
    refreshButtons();

    if (enc.outcome) {
      showOutcome(state.run.finishEncounter());
    } else {
      const target = ui.buttons[options.item ? 'item' : focused || ''];
      if (target && !target.el.disabled) target.el.focus();
      else if (focused) ui.buttons.light.el.focus();
    }
  }

  /** Plays beats strictly one after another. The next beat starts only after the previous one's time is up. */
  async function playBeats(beats, round) {
    const list = startRoundGroup(`Round ${round}`);
    for (const b of beats) {
      addBeatLine(list, b);
      updateHp(b.hp.p, b.hp.m);
      if (b.float) floatNumber(b.float);
      if (b.bubble) showBubble(b.bubble);
      if (b.roll) pulse(b.actor);
      if (b.stance) updateStance(b.stance);
      const ms = beatMs();
      if (ms) await wait(ms);
    }
  }

  function startRoundGroup(title) {
    const beatsList = el('ol', { className: 'log-beats' });
    state.ui.log.append(el('li', { className: 'log-round' }, [el('p', { className: 'log-round-title' }, title), beatsList]));
    return beatsList;
  }

  function addBeatLine(list, b) {
    list.append(el('li', { className: `log-line is-${b.kind}${b.tone ? ` tone-${b.tone}` : ''}` }, b.text));
    const box = state.ui.log;
    box.scrollTo({ top: box.scrollHeight, behavior: beatMs() ? 'smooth' : 'auto' });
  }

  function floatNumber(f) {
    const target = f.target === 'player' ? state.ui.player : state.ui.monster;
    const n = el('span', { className: `float ${f.heal ? 'is-heal' : 'is-dmg'}${f.crit ? ' is-crit' : ''}`, ariaHidden: 'true' }, f.text);
    target.card.append(n);
    target.card.classList.remove('is-hit', 'is-healed');
    void target.card.offsetWidth;
    target.card.classList.add(f.heal ? 'is-healed' : 'is-hit');
    setTimeout(() => n.remove(), 1100);
  }

  function showBubble(b) {
    const f = b.target === 'player' ? state.ui.player : state.ui.monster;
    clearTimeout(f.bubbleTimer);
    f.bubble.textContent = b.text;
    f.bubble.classList.toggle('is-narrate', !!b.narrate);
    f.bubble.classList.remove('show');
    void f.bubble.offsetWidth;
    f.bubble.classList.add('show');
    f.bubbleTimer = setTimeout(() => f.bubble.classList.remove('show'), Math.max(1800, beatMs() * 2.4));
  }

  function pulse(actor) {
    const f = actor === 'player' ? state.ui.player : actor === 'monster' ? state.ui.monster : null;
    if (!f) return;
    f.card.classList.remove('is-rolling');
    void f.card.offsetWidth;
    f.card.classList.add('is-rolling');
  }

  /* ---------- speed setting ---------- */
  function beatMs() { return SPEEDS[state.speed] ?? SPEEDS.normal; }

  function speedControl() {
    const wrap = el('div', { className: 'speed', role: 'radiogroup', ariaLabel: 'Beat speed' }, [el('span', { className: 'speed-label' }, 'Speed')]);
    const buttons = ['normal', 'fast', 'off'].map(k => {
      const b = el('button', { className: 'speed-btn', type: 'button', role: 'radio', ariaChecked: String(state.speed === k) }, k[0].toUpperCase() + k.slice(1));
      b.addEventListener('click', () => {
        state.speed = k;
        saveSpeed(k);
        buttons.forEach((x, i) => x.setAttribute('aria-checked', String(['normal', 'fast', 'off'][i] === k)));
      });
      return b;
    });
    wrap.append(...buttons);
    return wrap;
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
      text += ` ${res.remaining} more ${res.remaining === 1 ? `${monster} steps` : `${monster}s step`} forward.`;
      buttons = [['Next fight', beginEncounter]];
    } else if (res.outcome === 'win') {
      text += ` ${state.meta.node.label} is clear.`;
      buttons = [['Continue', () => explore(res)]];
    } else if (res.outcome === 'defeat') {
      buttons = [['New run', startRun], ['Change fighter', showStart]];
    } else {
      buttons = [[state.mode === 'cave' ? 'Back to the cave' : 'Back to the map', () => explore(res)]];
    }

    const btnEls = buttons.map(([label, fn], i) => {
      const b = el('button', { className: `btn ${i === 0 ? 'btn-primary' : 'btn-quiet'}`, type: 'button' }, label);
      b.addEventListener('click', fn);
      return b;
    });

    const xp = state.run.xpProgress();
    const extras = [];
    if (res.xpGained) extras.push(el('p', { className: 'xp-line' }, `+${res.xpGained} XP · ${xp.next ? `${xp.xp} / ${xp.next} to level ${xp.level + 1}` : `${xp.xp} XP, max level`}`));
    if (res.levelUp) {
      const u = res.levelUp;
      extras.push(el('div', { className: 'level-banner', role: 'status' }, [
        el('p', { className: 'level-banner-title display' }, `Level ${u.to}`),
        el('p', { className: 'level-banner-text' }, `Max HP ${u.maxHp} (+${u.hpGain}) · Proficiency +${u.proficiency} · Damage bonus +${u.damageBonus}`)
      ]));
    }

    const dialog = el('div', { className: `outcome is-${enc.outcome}`, role: 'dialog', ariaModal: 'true', ariaLabelledby: 'outcome-title' }, [
      ...(res.levelUp ? [extras.pop()] : []),
      el('h2', { className: 'display outcome-title', id: 'outcome-title' }, copy.title),
      el('p', { className: 'outcome-text' }, text),
      ...extras,
      statList([['Rounds', enc.round], ['HP left', `${state.run.hp} / ${state.run.player().maxHp}`], ['Draughts', pack]]),
      el('div', { className: 'outcome-buttons' }, btnEls)
    ]);
    trapTab(dialog, btnEls);
    ui.overlay.replaceChildren(dialog);
    ui.overlay.hidden = false;
    focusSoon(btnEls[0]);
  }

  /* =========================== Run end =========================== */
  function showRunEnd(kind) {
    setCombat(false);
    const { run } = state;
    destroyCave();
    state.screen = 'end';
    const p = run.player();
    const won = kind === 'complete';
    const newRun = el('button', { className: 'btn btn-primary', type: 'button' }, won ? 'New run' : 'Try again');
    const change = el('button', { className: 'btn btn-quiet', type: 'button' }, 'Change fighter');
    newRun.addEventListener('click', startRun);
    change.addEventListener('click', showStart);

    root.replaceChildren(el('section', { className: 'screen end-screen' }, [
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

    if (e.key === 'Escape') {
      e.preventDefault();
      if (state.menuOpen) { closeMenu(); return; }
      returnToBase();
      return;
    }

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

    if (state.screen === 'cave') {
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); drink(); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); showMap(); return; }
      if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter') && !e.target.matches?.('button, a')) { e.preventDefault(); contextAction(); }
      return;
    }

    if (state.screen === 'map') {
      if ((e.key === 'm' || e.key === 'M') && canUse3d()) { e.preventDefault(); showCave(); return; }
      if (ARROWS[e.key]) { e.preventDefault(); moveByArrow(...ARROWS[e.key]); return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); drink(); return; }
      if (e.key === 'Enter' && !e.target.matches?.('button, a, .node')) {
        if (!state.ui.context.hidden) { e.preventDefault(); contextAction(); }
      }
      return;
    }

    if (state.screen !== 'encounter') return;

    if (state.menuOpen) {
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

  return api;
}

/* =========================== Helpers =========================== */
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function viewButton(label, fn) {
  const b = el('button', { className: 'btn btn-quiet btn-small', type: 'button' }, label);
  b.addEventListener('click', fn);
  return b;
}

function dpadEl() {
  const btn = (dir, label, glyph) => el('button', { className: `dpad-btn dpad-${dir}`, type: 'button', 'data-dir': dir, ariaLabel: label }, glyph);
  return el('div', { className: 'dpad', role: 'group', ariaLabel: 'Move' }, [
    btn('up', 'Move forward', '▲'), btn('left', 'Move left', '◀'), btn('right', 'Move right', '▶'), btn('down', 'Move back', '▼')
  ]);
}

function loadSpeed(reduced) {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    if (v && v in SPEEDS) return v;
  } catch { /* storage blocked: fall through */ }
  return reduced ? 'off' : 'normal';
}
function saveSpeed(v) { try { localStorage.setItem(SPEED_KEY, v); } catch { /* ignore */ } }

const ICONS = {
  circling: 'M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12.6 2.4v2.6H10',
  wary: 'M8 2.2l4.8 1.9v3.6c0 2.9-2.2 4.9-4.8 5.9-2.6-1-4.8-3-4.8-5.9V4.1z',
  braced: 'M2.5 13.5h11M5 13.5V5.5M11 13.5V5.5M3.5 5.5h9'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'stance-icon');
  svg.innerHTML = `<path d="${ICONS[name] || ''}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}

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


const signed = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const damageText = a => (a.modifier ? `${a.dice}${a.modifier > 0 ? '+' : '−'}${Math.abs(a.modifier)}` : a.dice);
const wait = ms => new Promise(r => setTimeout(r, ms));
const focusSoon = node => { if (node) requestAnimationFrame(() => node.focus()); };
