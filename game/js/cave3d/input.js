// Keyboard and touch input for the 3D cave. Directions are grid directions; the camera looks east,
// so Up/W walks deeper into the cave (east), Down/S walks back, Left/A and Right/D step sideways.

const KEYS = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right'
};
export const DIRS = {
  up: { dx: 1, dy: 0 },
  down: { dx: -1, dy: 0 },
  left: { dx: 0, dy: -1 },
  right: { dx: 0, dy: 1 }
};

export function createInput({ dpad } = {}) {
  const held = [];           // most recent key wins
  let enabled = false;

  const press = k => { if (!held.includes(k)) held.push(k); };
  const release = k => { const i = held.indexOf(k); if (i >= 0) held.splice(i, 1); };

  function onDown(e) {
    if (!enabled || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches?.('input, textarea, select')) return;
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    press(k);
  }
  function onUp(e) { const k = KEYS[e.key]; if (k) release(k); }
  function clear() { held.length = 0; }

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', clear);

  // on-screen d-pad: hold to walk
  const cleanups = [];
  if (dpad) {
    for (const btn of dpad.querySelectorAll('[data-dir]')) {
      const k = btn.dataset.dir;
      const down = e => { if (!enabled) return; e.preventDefault(); btn.setPointerCapture?.(e.pointerId); press(k); btn.classList.add('is-held'); };
      const up = () => { release(k); btn.classList.remove('is-held'); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', e => e.preventDefault());
      cleanups.push(() => {
        btn.removeEventListener('pointerdown', down);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        btn.removeEventListener('lostpointercapture', up);
      });
    }
  }

  return {
    direction() { const k = held[held.length - 1]; return k ? DIRS[k] : null; },
    setEnabled(v) { enabled = v; if (!v) clear(); },
    destroy() {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      cleanups.forEach(f => f());
    }
  };
}
