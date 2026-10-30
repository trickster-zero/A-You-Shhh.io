/* Wandering characters with rotating quotes. Data: data/characters.json.
   Hover (or tap) a character to hold it in place and hear what it thinks. */
(() => {
  'use strict';

  const DATA_URL = 'data/characters.json';
  const HOLD_CYCLE = 3400;              // ms between quotes while hovered
  const CHATTER = [7000, 14000];        // ms between unprompted remarks
  const TYPE_SPEED = 24;                // ms per character
  const SIZE = 0.022;                   // sprite width as a share of map width

  const stage = document.getElementById('map-stage');
  const map = document.getElementById('map');
  const layer = document.getElementById('npcs');
  if (!stage || !layer) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEBUG = new URLSearchParams(location.search).has('debug');

  let W = 0, H = 0, last = 0;
  const npcs = [];

  /* ---------- Sprites: 20x28 viewBox, feet at the bottom, facing right ---------- */
  const SH = '<ellipse cx="10" cy="26.6" rx="5.5" ry="1.4" fill="rgba(0,0,0,.45)"/>';
  const legs = c => `<rect class="leg leg-a ol" x="7.2" y="19" width="2.4" height="7" rx="1" fill="${c}"/>` +
                    `<rect class="leg leg-b ol" x="10.4" y="19" width="2.4" height="7" rx="1" fill="${c}"/>`;
  const torso = c => `<path class="ol" d="M5.5 11.5 Q10 9.6 14.5 11.5 L15.2 20 H4.8 Z" fill="${c}"/>`;
  const head = (c = '#d9a77e') => `<circle class="ol" cx="10" cy="7" r="3.4" fill="${c}"/>`;

  const SPRITES = {
    guard: SH + legs('#2a2f38') + torso('#2c4a86') +
      '<rect x="9.2" y="11" width="1.6" height="9" fill="#e8b04b"/>' + head() +
      '<path class="ol" d="M6.4 7 A3.6 3.6 0 0 1 13.6 7 Z" fill="#8a93a0"/>' +
      '<rect x="16.1" y="2" width="0.9" height="23" fill="#7d5f40"/><path d="M16.55 0.3 L17.8 3 H15.3 Z" fill="#cfd6df"/>',
    runner: SH + legs('#3a3128') + torso('#3f6b4a') + head() +
      '<path d="M6.6 6.2 Q10 2.6 13.4 6.2 Q10 4.8 6.6 6.2Z" fill="#3a2a1c"/>' +
      '<path d="M6.5 10.4 H13.5 L12 12.4 H8 Z" fill="#b8473a"/>' +
      '<rect class="ol" x="12.4" y="14" width="3.6" height="3.2" rx=".6" fill="#7d5f40"/>',
    smith: SH + legs('#2e2620') + torso('#8a6a4a') +
      '<path class="ol" d="M6.5 12.5 H13.5 L14.2 20 H5.8 Z" fill="#5a3e2b"/>' + head('#c99572') +
      '<path d="M7.4 8.2 Q10 12.2 12.6 8.2 Z" fill="#6b4a2f"/>' +
      '<g class="tool"><rect x="14.6" y="9" width="1" height="8" fill="#7d5f40"/>' +
      '<rect class="ol" x="13.3" y="7.4" width="3.6" height="2.2" fill="#9aa3ad"/></g>',
    mage: SH + '<path class="ol" d="M5.6 11 Q10 9.4 14.4 11 L16 26 H4 Z" fill="#2f3f7a"/>' +
      '<rect x="5.4" y="17" width="9.4" height="1.1" fill="#e8b04b"/>' + head() +
      '<path class="ol" d="M5.8 6.8 L10 0.6 L14.2 6.8 Z" fill="#24305e"/>' +
      '<rect x="16.4" y="5" width="0.9" height="21" fill="#7d5f40"/><circle class="orb" cx="16.85" cy="4" r="1.8" fill="#8fd3ff"/>',
    recruit: SH + legs('#4a3d2c') + torso('#b9a582') + head() +
      '<path d="M6.6 6 Q10 2.8 13.4 6 Q12 4.9 10 5 Q8 4.9 6.6 6Z" fill="#6b4a2f"/>' +
      '<g class="tool"><rect x="15" y="11" width="1" height="8.5" fill="#a5835c"/>' +
      '<rect x="14" y="16.6" width="3" height=".9" fill="#7d5f40"/></g>',
    porter: SH + legs('#3a3128') + torso('#6b5a3a') + head() +
      '<path d="M6.6 6.2 Q10 3 13.4 6.2Z" fill="#2a2018"/>' +
      '<g class="crate"><rect class="ol" x="4.6" y="11.6" width="10.8" height="7.4" fill="#a5835c"/>' +
      '<path d="M4.6 15.3 H15.4 M10 11.6 V19" stroke="#7d5f40" stroke-width=".6"/></g>',
    scribe: SH + '<path class="ol" d="M5.6 11 Q10 9.4 14.4 11 L15.6 26 H4.4 Z" fill="#5b6170"/>' + head() +
      '<path class="ol" d="M6 8 Q6 3 10 3 Q14 3 14 8 Q12 5.8 10 5.8 Q8 5.8 6 8Z" fill="#4a4f5c"/>' +
      '<g class="book"><rect class="ol" x="7" y="13" width="6.4" height="4.2" fill="#e9e4da"/>' +
      '<rect x="10" y="13" width=".5" height="4.2" fill="#868b93"/></g>',
    cat: '<ellipse cx="10" cy="26.6" rx="5" ry="1.1" fill="rgba(0,0,0,.45)"/>' +
      '<path class="tail" d="M5.4 22.6 Q2.6 21 3.6 17.4" stroke="#2b2f36" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<rect class="leg leg-a" x="7" y="23.8" width="1.2" height="2.6" fill="#2b2f36"/>' +
      '<rect class="leg leg-b" x="11.8" y="23.8" width="1.2" height="2.6" fill="#2b2f36"/>' +
      '<ellipse class="ol" cx="10" cy="22.8" rx="5" ry="2.6" fill="#2b2f36"/>' +
      '<circle class="ol" cx="14.8" cy="20.4" r="2.3" fill="#2b2f36"/>' +
      '<path d="M13.3 19.1 L13.7 16.9 L14.8 18.5 Z M15.3 18.4 L16.3 16.8 L16.5 19 Z" fill="#2b2f36"/>' +
      '<circle cx="15.7" cy="20.2" r=".4" fill="#e8b04b"/>'
  };

  init();

  async function init() {
    let defs;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${DATA_URL}`);
      defs = await res.json();
    } catch (err) {
      console.warn('npcs.js: characters not loaded.', err);
      return;
    }

    defs.forEach(d => npcs.push(createNPC(d)));
    measure();
    new ResizeObserver(measure).observe(stage);
    npcs.forEach(render);

    if (DEBUG) drawDebugPaths(defs);
    if (!reduceMotion) requestAnimationFrame(tick);
    scheduleChatter();
  }

  function createNPC(def) {
    const el = make('div', `npc npc-${def.sprite}`);
    const body = make('div', 'npc-body');
    body.innerHTML = `<svg viewBox="0 0 20 28" aria-hidden="true">${SPRITES[def.sprite] || SPRITES.recruit}</svg>`;
    const bubble = make('div', 'npc-bubble');
    const quote = make('span', 'npc-quote');
    const ghost = make('span', 'npc-ghost');   // invisible full text: fixes the bubble size up front
    const typed = make('span', 'npc-typed');
    quote.append(ghost, typed);
    bubble.append(make('span', 'npc-name', def.name), quote);
    el.append(bubble, body);
    layer.appendChild(el);

    const p0 = def.path[0];
    const n = {
      def, el, body, bubble, ghost, typed,
      x: p0[0], y: p0[1], i: Math.min(1, def.path.length - 1), dir: 1,
      waitUntil: performance.now() + rand(0, 1500),
      held: false, queue: [], lastQuote: null,
      timers: { cycle: 0, hide: 0, type: 0, release: 0 }
    };

    body.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold(n); });
    body.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') release(n, 1500); });
    body.addEventListener('click', e => {
      if (e.pointerType === 'mouse') return;   // mouse is handled by hover
      hold(n);                                 // tap: next quote, then wander off
      release(n, 3800);
    });
    return n;
  }

  /* ---------- Movement ---------- */
  function tick(now) {
    const dt = Math.min(now - (last || now), 50) / 1000;
    last = now;
    for (const n of npcs) step(n, dt, now);
    requestAnimationFrame(tick);
  }

  function step(n, dt, now) {
    if (n.held || now < n.waitUntil) { setState(n, 'idle'); return; }

    const t = n.def.path[n.i];
    const dx = t[0] - n.x, dy = t[1] - n.y;
    const dist = Math.hypot(dx, dy * (H / W || 2 / 3)); // compare in width units
    const move = n.def.speed * dt;

    if (dist <= move) {
      n.x = t[0]; n.y = t[1];
      const pause = n.def.mode === 'wander' ? rand(...(n.def.pause || [1500, 4000])) : (t[2] || 0);
      if (pause) n.waitUntil = now + pause;
      advance(n);
    } else {
      const f = move / dist;
      n.x += dx * f; n.y += dy * f;
      if (Math.abs(dx) > 0.02) n.el.classList.toggle('face-left', dx < 0);
      setState(n, 'walking');
    }
    render(n);
  }

  function advance(n) {
    const len = n.def.path.length;
    if (len < 2) return;
    if (n.def.mode === 'loop') n.i = (n.i + 1) % len;
    else if (n.def.mode === 'wander') {
      let j; do { j = Math.floor(Math.random() * len); } while (j === n.i);
      n.i = j;
    } else {
      if (n.i + n.dir < 0 || n.i + n.dir >= len) n.dir *= -1;
      n.i += n.dir;
    }
  }

  function setState(n, s) {
    if (n.state === s) return;
    n.state = s;
    n.el.classList.toggle('is-walking', s === 'walking');
    n.el.classList.toggle('is-idle', s === 'idle');
  }

  function render(n) {
    n.el.style.transform = `translate3d(${(n.x / 100) * W}px, ${(n.y / 100) * H}px, 0)`;
    n.el.style.zIndex = Math.round(n.y * 10); // lower on the map = in front
  }

  function measure() {
    W = stage.clientWidth;
    H = stage.clientHeight;
    layer.style.setProperty('--npc', `${Math.max(16, W * SIZE)}px`);
    npcs.forEach(render);
  }

  /* ---------- Talking ---------- */
  function hold(n) {
    clearTimeout(n.timers.release);
    n.held = true;
    n.el.classList.add('is-held');
    say(n);
    clearInterval(n.timers.cycle);
    n.timers.cycle = setInterval(() => say(n), HOLD_CYCLE);
  }

  function release(n, delay) {
    clearTimeout(n.timers.release);
    n.timers.release = setTimeout(() => {
      clearInterval(n.timers.cycle);
      n.held = false;
      n.el.classList.remove('is-held');
      hideBubble(n);
    }, delay);
  }

  function say(n, duration) {
    const text = nextQuote(n);
    clearTimeout(n.timers.hide);
    clearInterval(n.timers.type);

    n.bubble.classList.add('show');
    n.ghost.textContent = text;
    n.typed.textContent = reduceMotion ? text : '';
    clampBubble(n);

    if (!reduceMotion) {
      let k = 0;
      n.timers.type = setInterval(() => {
        n.typed.textContent = text.slice(0, ++k);
        if (k >= text.length) clearInterval(n.timers.type);
      }, TYPE_SPEED);
    }
    if (duration) n.timers.hide = setTimeout(() => hideBubble(n), duration);
  }

  function hideBubble(n) {
    clearInterval(n.timers.type);
    n.bubble.classList.remove('show');
  }

  // Shuffled deck per character: every quote once before any repeats
  function nextQuote(n) {
    if (!n.queue.length) {
      n.queue = shuffle(n.def.quotes.slice());
      if (n.queue.length > 1 && n.queue[0] === n.lastQuote) n.queue.push(n.queue.shift());
    }
    n.lastQuote = n.queue.shift();
    return n.lastQuote;
  }

  function clampBubble(n) {
    const half = n.bubble.offsetWidth / 2;
    const cx = (n.x / 100) * W;
    const shift = Math.max(half + 6 - cx, Math.min(0, W - 6 - half - cx));
    n.bubble.style.setProperty('--bx', `${shift}px`);
  }

  function scheduleChatter() {
    setTimeout(() => {
      const busy = npcs.some(n => n.held || n.bubble.classList.contains('show'));
      if (!document.hidden && !busy && !map.classList.contains('has-active') && npcs.length) {
        say(npcs[Math.floor(Math.random() * npcs.length)], 4200);
      }
      scheduleChatter();
    }, rand(...CHATTER));
  }

  /* ---------- Debug: show each character's path points ---------- */
  function drawDebugPaths(defs) {
    defs.forEach(d => d.path.forEach((p, i) => {
      const dot = make('span', 'npc-debug-dot', i === 0 ? d.id : '');
      dot.style.left = `${p[0]}%`;
      dot.style.top = `${p[1]}%`;
      layer.appendChild(dot);
    }));
  }

  function make(tag, className, text) {
    const e = document.createElement(tag);
    e.className = className;
    if (text) e.textContent = text;
    return e;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})();
