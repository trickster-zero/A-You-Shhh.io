/* Home map: builds hotspots from data/buildings.json.
   Add a building = add one JSON entry. Append ?debug to the URL to align hotspots. */
(() => {
  'use strict';

  const DATA_URL = 'data/buildings.json';
  const NAV_DELAY = 800; // ms, matches the warp transition

  const map = document.getElementById('map');
  const layer = document.getElementById('hotspots');
  const card = document.getElementById('map-card');
  const warp = document.getElementById('warp');

  const DEBUG = new URLSearchParams(location.search).has('debug');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = window.matchMedia('(max-width: 640px)');

  const STATUS = {
    open:   { kicker: 'Enter',              aria: 'open' },
    locked: { kicker: 'Under construction', aria: 'under construction' },
    hub:    { kicker: 'Central plaza',      aria: 'site introduction' }
  };

  let activeEl = null;      // hotspot whose card is showing
  let armedId = null;       // touch: id that received the first tap
  let lastPointer = 'mouse';
  let navigating = false;

  init();

  async function init() {
    if (DEBUG) setupDebug();

    let buildings;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buildings = await res.json();
    } catch (err) {
      console.error('map.js: could not load', DATA_URL, err);
      map.classList.add('map-error');
      return;
    }

    const frag = document.createDocumentFragment();
    buildings.forEach(b => frag.appendChild(createHotspot(b)));
    layer.appendChild(frag);
    bindGlobal();
  }

  function createHotspot(b) {
    const s = STATUS[b.status] || STATUS.locked;
    const { x, y, w, h } = b.hotspot;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = `hotspot is-${b.status}`;
    el.dataset.id = b.id;
    // Positioned by center so the 44px minimum grows evenly around the building
    el.style.left = `${x + w / 2}%`;
    el.style.top = `${y + h / 2}%`;
    el.style.width = `${w}%`;
    el.style.height = `${h}%`;
    el.setAttribute('aria-label', `${b.label}, ${s.aria}`);
    if (b.status === 'locked') el.setAttribute('aria-disabled', 'true');

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
    const keyboard = e.detail === 0; // Enter/Space fires click with detail 0
    const touch = !keyboard && lastPointer === 'touch';
    const canNavigate = b.status === 'open' && b.href;

    // Touch: first tap on an open building shows the label, second tap enters
    if (touch && canNavigate && armedId !== b.id) {
      armedId = b.id;
      showCard(el, b, { armed: true });
      return;
    }
    armedId = null;

    if (canNavigate && !DEBUG) return go(el, b);

    showCard(el, b, { nudge: b.status === 'locked' });
    if (DEBUG) console.log(b.id, JSON.stringify(b.hotspot));
  }

  function showCard(el, b, opts = {}) {
    const s = STATUS[b.status] || STATUS.locked;
    if (activeEl && activeEl !== el) activeEl.classList.remove('is-active');
    activeEl = el;
    el.classList.add('is-active');

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
      void card.offsetWidth; // restart animation
      card.classList.add('nudge');
    }
  }

  function hideCard() {
    card.classList.remove('show', 'nudge');
    if (activeEl) activeEl.classList.remove('is-active');
    activeEl = null;
    armedId = null;
  }

  function positionCard(el) {
    if (narrow.matches) { // fixed bottom sheet on small screens (CSS)
      card.style.left = '';
      card.style.top = '';
      return;
    }
    const m = map.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const gap = 10, pad = 8;

    let left = r.left - m.left + r.width / 2 - cw / 2;
    left = Math.max(pad, Math.min(left, m.width - cw - pad));

    let top = r.top - m.top - ch - gap;          // above the building
    if (top < pad) top = r.bottom - m.top + gap; // flip below if no room
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

  function bindGlobal() {
    // Tap or click outside a hotspot closes the card
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

    // Back button from a sub-page (bfcache): reset the warp
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
    out.textContent = 'debug: hover the map for x/y %, click a hotspot to log it';
    document.body.appendChild(out);

    map.addEventListener('pointermove', e => {
      const m = map.getBoundingClientRect();
      const x = ((e.clientX - m.left) / m.width * 100).toFixed(1);
      const y = ((e.clientY - m.top) / m.height * 100).toFixed(1);
      out.textContent = `x ${x}%   y ${y}%`;
    });
  }

  function make(tag, className, text) {
    const n = document.createElement(tag);
    n.className = className;
    n.textContent = text;
    return n;
  }
})();
