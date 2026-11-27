// Animation layer. The queue is DOM-free (tested in Node); the effects below touch the page only when called.
// Effects use transform and opacity only, via the Web Animations API, so they stay smooth on phones.

/**
 * A strict one-at-a-time queue.
 *   run(item)    -> Promise   plays one item (motion on)
 *   settle(item) -> void      applies an item's end result at once (motion off)
 *   reducedMotion() -> bool   checked per push; when true, everything settles synchronously
 */
export function createQueue({ run, settle = () => {}, reducedMotion = () => false, onBusyChange = () => {} } = {}) {
  const items = [];
  let running = false, active = 0, maxActive = 0, waiters = [];
  const done = () => { const w = waiters; waiters = []; w.forEach(fn => fn()); };
  async function loop() {
    running = true; onBusyChange(true);
    while (items.length) {
      const item = items.shift();
      active++; maxActive = Math.max(maxActive, active);
      if (reducedMotion()) settle(item);
      else { try { await run(item); } catch (err) { console.warn('Animation failed, showing the end state:', err); settle(item); } }
      active--;
    }
    running = false; onBusyChange(false);
    done();
  }
  return {
    push(list) {
      list = [].concat(list);
      if (reducedMotion()) {
        if (running) { items.push(...list); return; }   // a running queue settles them in order
        list.forEach(settle);
        done();
        return;
      }
      items.push(...list);
      if (!running) loop();
    },
    whenIdle() { return running || items.length ? new Promise(r => waiters.push(r)) : Promise.resolve(); },
    get busy() { return running || items.length > 0; },
    get maxActive() { return maxActive; }
  };
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- effects (browser only) ---------------- */

/** Global pace. 1 = the original timings; higher is slower. Every duration and delay below goes through T(). */
export const SPEED = 1.4;
export const T = ms => Math.round(ms * SPEED);

const done = anim => anim.finished.catch(() => {});
const wait = ms => new Promise(r => setTimeout(r, ms));
function layer() {
  let el = document.getElementById('fx-layer');
  if (!el) { el = document.createElement('div'); el.id = 'fx-layer'; el.setAttribute('aria-hidden', 'true'); document.body.append(el); }
  return el;
}
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
export const onScreen = r => r && r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

/** Briefly scale an element up and back. */
export function pulse(el, scale = 1.28) {
  if (!el) return Promise.resolve();
  return done(el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: .35 }, { transform: 'scale(1)' }], { duration: T(320), easing: 'ease-out' }));
}

/** A small card that flies between two screen rects along a gentle arc. */
export function flyCard(from, to, { icon = null, color = '#c9a57a', back = false, duration = 220, delay = 0, arc = 40, onLand } = {}) {
  const a = center(from), b = center(to);
  const card = document.createElement('div');
  card.className = `fx-card${back ? ' back' : ''}`;
  card.style.setProperty('--fx-color', color);
  if (icon && !back) { const img = document.createElement('img'); img.src = icon; img.alt = ''; card.append(img); }
  layer().append(card);
  const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - arc;
  const at = (x, y, s = 1, r = 0) => `translate(${x - 13}px, ${y - 17}px) scale(${s}) rotate(${r}deg)`;
  const anim = card.animate([
    { transform: at(a.x, a.y, .6, -8), opacity: 0 },
    { transform: at(a.x, a.y, 1, -4), opacity: 1, offset: .12 },
    { transform: at(mx, my, 1.08, 6), opacity: 1, offset: .55 },
    { transform: at(b.x, b.y, .85, 0), opacity: 1 }
  ], { duration: T(duration), delay: T(delay), easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' });
  return done(anim).then(() => { card.remove(); onLand?.(); });
}

/** Floating "+1" / "−2" that rises and fades over 800 ms. */
export function floatText(rect, text, color, { delay = 0, icon = null } = {}) {
  const c = center(rect);
  const el = document.createElement('div');
  el.className = 'fx-float';
  el.style.color = color;
  if (icon) { const img = document.createElement('img'); img.src = icon; img.alt = ''; el.append(img); }
  el.append(text);
  layer().append(el);
  const anim = el.animate([
    { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) translateY(4px)`, opacity: 0 },
    { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) translateY(-8px)`, opacity: 1, offset: .2 },
    { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) translateY(-34px)`, opacity: 0 }
  ], { duration: T(800), delay: T(delay), easing: 'ease-out', fill: 'both' });
  return done(anim).then(() => el.remove());
}

/**
 * Dice roll in the centre of the screen: a short shake, a tumble with changing faces, a bounce to rest,
 * a brief hold, then the dice shrink into their slot in the panel (`slotEls`).
 */
export async function rollDice(slotEls, finalFaces, drawFace) {
  const stage = document.createElement('div');
  stage.className = 'fx-dice-stage';
  const dice = finalFaces.map(() => { const d = document.createElement('div'); d.className = 'die fx-die'; stage.append(d); return d; });
  dice.forEach(d => drawFace(d, 1 + Math.floor(Math.random() * 6)));
  layer().append(stage);
  slotEls.forEach(el => { el.style.opacity = '0'; });
  const intro = done(stage.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], { duration: T(120), easing: 'ease-out', fill: 'both' }));
  await intro;
  await Promise.all(dice.map(d => done(d.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px) rotate(-6deg)' }, { transform: 'translateX(5px) rotate(6deg)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }],
    { duration: T(160), easing: 'linear' }))));
  let spin = true;
  (async () => { while (spin) { dice.forEach(d => drawFace(d, 1 + Math.floor(Math.random() * 6))); await wait(T(70)); } })();
  await Promise.all(dice.map((d, i) => done(d.animate([
    { transform: 'translateY(0) rotate(0deg) scale(1)' },
    { transform: `translateY(-46px) rotate(${i ? 220 : -240}deg) scale(.92)`, offset: .45 },
    { transform: `translateY(0) rotate(${i ? 360 : -360}deg) scale(1)` }
  ], { duration: T(400), easing: 'cubic-bezier(.3,.5,.4,1)' }))));
  spin = false;
  dice.forEach((d, i) => drawFace(d, finalFaces[i]));
  await Promise.all(dice.map(d => done(d.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-12px) scale(1.05)', offset: .4 }, { transform: 'translateY(0)' }], { duration: T(180), easing: 'ease-out' }))));
  await wait(T(380));
  // Fly each die into its panel slot (or simply fade if the slot is off screen)
  await Promise.all(dice.map((d, i) => {
    const from = d.getBoundingClientRect(), to = slotEls[i]?.getBoundingClientRect();
    if (!to || !onScreen(to)) return done(d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T(200), fill: 'both' }));
    const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const k = to.width / from.width;
    return done(d.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: .9 }], { duration: T(320), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' }));
  }));
  slotEls.forEach(el => { el.style.opacity = ''; });
  stage.remove();
}

/** Amber glow over hexes that produced. */
export function glowHexes(els) {
  return Promise.all(els.map(el => done(el.animate([{ opacity: 0 }, { opacity: .9, offset: .3 }, { opacity: 0 }], { duration: T(700), easing: 'ease-out' }))));
}

/** Robber drop with a dust puff. `puffAt` is a screen rect under the robber. */
export function dropRobber(bodyEl, puffAt) {
  const drop = done(bodyEl.animate([
    { transform: 'translateY(-26px)', opacity: 0 },
    { transform: 'translateY(0) scale(1.06, .92)', opacity: 1, offset: .8 },
    { transform: 'none', opacity: 1 }
  ], { duration: T(200), easing: 'cubic-bezier(.5,0,.8,.4)' }));
  const puff = drop.then(() => {
    if (!puffAt) return;
    const c = center(puffAt);
    const parts = [-1, -.4, .4, 1].map(dir => {
      const d = document.createElement('div');
      d.className = 'fx-dust';
      layer().append(d);
      return done(d.animate([
        { transform: `translate(${c.x}px, ${c.y + 10}px) scale(.4)`, opacity: .7 },
        { transform: `translate(${c.x + dir * 22}px, ${c.y + 4 - Math.abs(dir) * 4}px) scale(1.3)`, opacity: 0 }
      ], { duration: T(380), easing: 'ease-out' })).then(() => d.remove());
    });
    return Promise.all(parts);
  });
  return puff;
}

/** Road: draws along its edge. Settlement: drops and squashes. City: rises with a bigger bounce. */
export function buildPiece(el, kind) {
  el.classList.remove('fx-pending');
  if (kind === 'road') {
    el.style.transformOrigin = '0% 50%';
    return done(el.animate([{ transform: 'scaleX(0)', opacity: .6 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: T(300), easing: 'cubic-bezier(.4,0,.2,1)' }));
  }
  el.style.transformOrigin = '50% 100%';
  if (kind === 'city') {
    return done(el.animate([
      { transform: 'translateY(4px) scale(.72)', opacity: .5 },
      { transform: 'translateY(-6px) scale(1.12, 1.12)', opacity: 1, offset: .5 },
      { transform: 'translateY(0) scale(1.16, .82)', offset: .72 },
      { transform: 'translateY(-2px) scale(.96, 1.05)', offset: .88 },
      { transform: 'none' }
    ], { duration: T(350), easing: 'ease-out' }));
  }
  return done(el.animate([
    { transform: 'translateY(-20px)', opacity: 0 },
    { transform: 'translateY(0) scale(1.14, .82)', opacity: 1, offset: .72 },
    { transform: 'none' }
  ], { duration: T(250), easing: 'cubic-bezier(.5,0,.7,1)' }));
}

/** Turn change: a band wipes across, the next player's token rises, then the band clears. */
export function turnWipe({ color, letter, name }) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-wipe';
  wrap.style.setProperty('--fx-color', color);
  wrap.innerHTML = `<div class="fx-wipe-band"></div><div class="fx-wipe-token"><span class="chip big" style="background:${color}">${letter}</span><span class="fx-wipe-name"></span></div>`;
  wrap.querySelector('.fx-wipe-name').textContent = name;
  layer().append(wrap);
  const band = wrap.querySelector('.fx-wipe-band'), token = wrap.querySelector('.fx-wipe-token');
  const a = done(band.animate([
    { transform: 'translateX(-105%) skewX(-12deg)' },
    { transform: 'translateX(0) skewX(-12deg)', offset: .4 },
    { transform: 'translateX(0) skewX(-12deg)', offset: .7 },
    { transform: 'translateX(105%) skewX(-12deg)' }
  ], { duration: T(720), easing: 'cubic-bezier(.6,0,.3,1)' }));
  const b = done(token.animate([
    { transform: 'translate(-50%, -50%) translateY(40px)', opacity: 0 },
    { transform: 'translate(-50%, -50%) translateY(40px)', opacity: 0, offset: .3 },
    { transform: 'translate(-50%, -50%)', opacity: 1, offset: .55 },
    { transform: 'translate(-50%, -50%)', opacity: 1, offset: .72 },
    { transform: 'translate(-50%, -50%) translateY(-12px)', opacity: 0 }
  ], { duration: T(720), easing: 'ease-out' }));
  return Promise.all([a, b]).then(() => wrap.remove());
}

/** Confetti burst on a canvas that removes itself. */
export function confetti(colors, { duration = T(2500), count = 160 } = {}) {
  const c = document.createElement('canvas');
  c.className = 'fx-confetti';
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  layer().append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .42,
    vx: (Math.random() - .5) * 14, vy: -6 - Math.random() * 10,
    w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
    r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));
  return new Promise(resolve => {
    let start = null;
    const frame = t => {
      start ??= t;
      const k = (t - start) / duration;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += .32; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - .6) / .4);
        ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (k < 1) requestAnimationFrame(frame); else { c.remove(); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

/** Title banner with the winner's name. Stays until removeBanner(). */
export function banner(text, color, { animate = true } = {}) {
  removeBanner();
  const el = document.createElement('div');
  el.className = 'fx-banner';
  el.id = 'fx-banner';
  el.style.setProperty('--fx-color', color);
  el.innerHTML = '<p class="eyebrow">The archipelago is claimed</p><h2></h2>';
  el.querySelector('h2').textContent = text;
  document.body.append(el);
  if (!animate) return Promise.resolve();
  return done(el.animate([
    { transform: 'translate(-50%, -50%) scale(.8)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.04)', opacity: 1, offset: .6 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
  ], { duration: T(520), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' })).then(() => wait(T(900)));
}
export function removeBanner() { document.getElementById('fx-banner')?.remove(); }
