/* Home map: builds hotspots + name plaques from data/buildings.json.
   Add a building = add one JSON entry. Append ?debug to the URL to align hotspots. */
(() => {
  'use strict';

  const DATA_URL = 'data/buildings.json';
  const NAV_DELAY = 800;          // ms, matches the warp transition
  const PARALLAX_PX = 10;         // max map drift on desktop mouse move

  const map = document.getElementById('map');
  const stage = document.getElementById('map-stage');
  const layer = document.getElementById('hotspots');
  const card = document.getElementById('map-card');
  const spot = document.getElementById('map-spotlight');
  const hint = document.getElementById('map-hint');
  const backdrop = document.getElementById('map-backdrop');
  const warp = document.getElementById('warp');

  const DEBUG = new URLSearchParams(location.search).has('debug');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = window.matchMedia('(max-width: 640px)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  const STATUS = {
    open:   { kicker: 'Enter',              aria: 'open' },
    locked: { kicker: 'Under construction', aria: 'under construction' },
    hub:    { kicker: 'Central plaza',      aria: 'site introduction' }
  };

  let activeEl = null;
  let armedId = null;
  let lastPointer = 'mouse';
  let navigating = false;

  if (!finePointer.matches) hint.textContent = 'Tap a building to explore';
  init();

  async function init() {
    if (DEBUG) setupDebug();

    let buildings;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${DATA_URL}`);
      buildings = await res.json();
    } catch (err) {
      console.error('map.js: could not load buildings.', err);
      map.classList.add('map-error');
      return;
    }

    const frag = document.createDocumentFragment();
    buildings.forEach((b, i) => frag.appendChild(createHotspot(b, i)));
    layer.appendChild(frag);
    map.classList.add('is-ready');   // triggers the plaque entrance
    bindGlobal();
    if (finePointer.matches && !reduceMotion.matches) bindParallax();
  }

  function createHotspot(b, i) {
    const s = STATUS[b.status] || STATUS.locked;
    const { x, y, w, h } = b.hotspot;
    const pin = b.pin || { x: x + w / 2, y: y + h * 0.2 };

    const el = document.createElement('button');
    el.type = 'button';
    el.className = `hotspot is-${b.status}`;
    el.dataset.id = b.id;
    el.style.left = `${x + w / 2}%`;
    el.style.top = `${y + h / 2}%`;
    el.style.width = `${w}%`;
    el.style.height = `${h}%`;
    el.setAttribute('aria-label', `${b.label}, ${s.aria}`);
    if (b.status === 'locked') el.setAttribute('aria-disabled', 'true');

    // Always-visible name plaque, anchored at the pin (converted to % of this button)
    const plaque = make('span', 'plaque');
    plaque.setAttribute('aria-hidden', 'true');
    plaque.style.left = `${((pin.x - x) / w) * 100}%`;
    plaque.style.top = `${((pin.y - y) / h) * 100}%`;
    plaque.style.setProperty('--i', i);
    plaque.append(make('span', 'plaque-mark'), make('span', 'plaque-name', b.label));
    el.appendChild(plaque);

    el.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; });
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showCard(el, b); });
    el.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && document.activeElement !== el) hideCard();
    });
    el.addEventListener('focus', () => showCard(el, b));
    el.addEventListener('blur', () => { if (!el.matches(':hover')) hideCard(); });
    el.addEventListener('click', e => onActivate(e, el, b));

    return el;
  }

  function onActivate(e, el, b) {
    if (navigating) return;
    const keyboard = e.detail === 0;
    const touch = !keyboard && lastPointer === 'touch';
    const canNavigate = b.status === 'open' && b.href;

    if (touch && canNavigate && armedId !== b.id) {   // first tap: show label
      armedId = b.id;
      showCard(el, b, { armed: true });
      return;
    }
    armedId = null;

    if (canNavigate && !DEBUG) return go(el, b);

    showCard(el, b, { nudge: b.status === 'locked' });
    if (DEBUG) console.log(b.id, JSON.stringify({ hotspot: b.hotspot, pin: b.pin }));
  }

  function showCard(el, b, opts = {}) {
    const s = STATUS[b.status] || STATUS.locked;
    if (activeEl && activeEl !== el) activeEl.classList.remove('is-active');
    activeEl = el;
    el.classList.add('is-active');
    hint.classList.add('is-dismissed');

    // Spotlight: dim everything except this building
    const { x, y, w, h } = b.hotspot;
    spot.style.setProperty('--sx', `${x + w / 2}%`);
    spot.style.setProperty('--sy', `${y + h / 2}%`);
    spot.style.setProperty('--sw', `${w * 0.85}%`);
    spot.style.setProperty('--sh', `${h * 0.85}%`);
    map.classList.add('has-active');

    card.dataset.status = b.status;
    card.replaceChildren(
      make('p', 'map-card-kicker', s.kicker),
      make('h2', 'map-card-title display', b.label),
      make('p', 'map-card-desc', b.description)
    );
    if (b.status === 'open' && b.href) {
      card.appendChild(make('p', 'map-card-hint', opts.armed ? 'Tap again to enter' : 'Select to enter'));
    }
    card.classList.add('show');
    positionCard(el);

    if (opts.nudge && !reduceMotion.matches) {
      card.classList.remove('nudge');
      void card.offsetWidth;
      card.classList.add('nudge');
    }
  }

  function hideCard() {
    card.classList.remove('show', 'nudge');
    map.classList.remove('has-active');
    if (activeEl) activeEl.classList.remove('is-active');
    activeEl = null;
    armedId = null;
  }

  function positionCard(el) {
    if (narrow.matches) { card.style.left = ''; card.style.top = ''; return; }
    const m = map.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const gap = 12, pad = 10;

    let left = r.left - m.left + r.width / 2 - cw / 2;
    left = Math.max(pad, Math.min(left, m.width - cw - pad));

    let top = r.bottom - m.top + gap;                 // below the building
    if (top + ch > m.height - pad) top = r.top - m.top - ch - gap; // else above
    top = Math.max(pad, Math.min(top, m.height - ch - pad));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function go(el, b) {
    navigating = true;
    if (reduceMotion.matches) { location.href = b.href; return; }
    const r = el.getBoundingClientRect();
    warp.style.left = `${r.left + r.width / 2}px`;
    warp.style.top = `${r.top + r.height / 2}px`;
    warp.classList.remove('go');
    void warp.offsetWidth;
    warp.classList.add('go');
    setTimeout(() => { location.href = b.href; }, NAV_DELAY);
  }

  function bindParallax() {
    let raf = 0, tx = 0, ty = 0;
    window.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      tx = (e.clientX / window.innerWidth - 0.5) * -2 * PARALLAX_PX;
      ty = (e.clientY / window.innerHeight - 0.5) * -2 * PARALLAX_PX;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        stage.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        backdrop.style.transform = `translate3d(${-tx * 1.6}px, ${-ty * 1.6}px, 0)`;
        if (activeEl) positionCard(activeEl);
      });
    });
  }

  function bindGlobal() {
    document.addEventListener('pointerdown', e => {
      if (e.target.closest('.hotspot')) return;
      const focused = document.activeElement;
      if (focused && focused.classList.contains('hotspot')) focused.blur();
      hideCard();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });

    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (activeEl) positionCard(activeEl); });
    });

    window.addEventListener('pageshow', e => {
      if (!e.persisted) return;
      navigating = false;
      warp.classList.remove('go');
      hideCard();
    });
  }

  function setupDebug() {
    map.classList.add('debug');
    const out = document.createElement('div');
    out.className = 'map-debug-readout';
    out.textContent = 'debug: hover for x/y %, click a hotspot to log it';
    document.body.appendChild(out);
    stage.addEventListener('pointermove', e => {
      const m = stage.getBoundingClientRect();
      const x = ((e.clientX - m.left) / m.width * 100).toFixed(1);
      const y = ((e.clientY - m.top) / m.height * 100).toFixed(1);
      out.textContent = `x ${x}%   y ${y}%`;
    });
  }

  function make(tag, className, text) {
    const n = document.createElement(tag);
    n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
})();
