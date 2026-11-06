// 3D cave: game loop and mode switching between exploring and paused (fight overlay, 2D map).
// Game rules stay in run.js and combat.js; this module only moves the player and reports events.
import { buildWorld } from './world.js';
import { createScene } from './scene.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';

/**
 * mountCave(host, { run, dpad, hooks })
 * hooks:
 *   onEvent(ev)        a run event happened (moved, crevice, chest, encounter)
 *   onEncounter(ev)    the player stepped into a goblin's zone; the cave is paused
 *   onArrive()         the player finished a step (for HUD refresh)
 *   onBump(reason)     a step was refused (wall, blocked crevice)
 *   onFrame(mapPos)    every frame, with the player's position on the 2D map
 *   onInteract(what)   chest or exit tapped
 */
export function mountCave(host, { run, dpad, hooks = {} }) {
  const world = buildWorld(run.floor);
  const view = createScene(host, world);
  const player = createPlayer(view.scene, world.spawn);
  const input = createInput({ dpad });

  let paused = true;
  let raf = 0, last = 0;
  let pending = null;        // run event to deliver when the current step finishes
  let entryFrom = null;      // tile the player stood on before entering the current chamber
  let observer = null;
  const fps = { frames: 0, acc: 0, value: 0, worst: 0, prev: 0 };
  // ?fps in the URL shows a frame-rate readout
  const fpsEl = new URLSearchParams(location.search).has('fps') ? Object.assign(document.createElement('p'), { className: 'cave-fps' }) : null;
  if (fpsEl) host.append(fpsEl);

  view.syncEntities(run);
  syncToRun();
  observe(host);
  view.renderer.domElement.addEventListener('pointerup', onTap);

  function observe(el) {
    observer?.disconnect();
    observer = new ResizeObserver(() => { view.setSize(el.clientWidth, el.clientHeight); if (paused) view.render(); });
    observer.observe(el);
    view.setSize(el.clientWidth, el.clientHeight);
  }

  /* ---------- loop ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    const time = now / 1000;

    if (!paused) player.update(dt, input.direction(), tryStep, onArrive, () => paused);
    player.animate(dt, time);
    player.updateCamera(view.camera, dt);
    view.update(dt, player.group.position, time);
    view.render();
    hooks.onFrame?.(world.mapPos(player.group.position.x, player.group.position.z));

    // real frame timing (dt above is capped for movement; this is not)
    const real = fps.prev ? (now - fps.prev) / 1000 : 0;
    fps.prev = now;
    fps.frames++; fps.acc += real; fps.worst = Math.max(fps.worst, real);
    if (fps.acc >= 1) {
      fps.value = Math.round(fps.frames / fps.acc); fps.lastWorst = fps.worst;
      fps.frames = 0; fps.acc = 0; fps.worst = 0;
      if (fpsEl) fpsEl.textContent = `${fps.value} fps · worst frame ${Math.round(fps.lastWorst * 1000)} ms`;
    }
  }
  function start() { if (!raf) { last = 0; fps.prev = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  /* ---------- movement rules: walls, chambers, and the run's graph ---------- */
  function tryStep(from, to) {
    if (!world.walkable(to.x, to.y)) { hooks.onBump?.('wall'); return false; }
    const r = world.regionAt(to.x, to.y);
    if (r.type !== 'chamber' || r.id === run.position) return true;

    // stepping into a different chamber = moving along the graph edge we're on
    if (run.status !== 'exploring') return false;
    if (run.blocked.has(r.id)) { hooks.onBump?.('blocked'); return false; }
    if (!run.canMoveTo(r.id)) { hooks.onBump?.('unreachable'); return false; }
    const ev = run.moveTo(r.id);
    if (ev.type === 'crevice' && !ev.success) { hooks.onEvent?.(ev); return false; }   // didn't fit: stay outside
    entryFrom = { ...from };
    pending = ev;
    return true;
  }

  function onArrive() {
    if (pending) {
      const ev = pending;
      pending = null;
      hooks.onEvent?.(ev);
      if (ev.type === 'encounter') { pause(); hooks.onEncounter?.(ev); return; }
    }
    hooks.onArrive?.();
  }

  function onTap(e) {
    if (paused || e.pointerType === 'mouse' && e.button !== 0) return;
    const hit = view.pick(e.clientX, e.clientY);
    if (hit) hooks.onInteract?.(hit);
  }

  /* ---------- state sync with the run ---------- */
  function syncToRun() {
    const here = world.regionAt(player.state.tile.x, player.state.tile.y);
    const fine = (here.type === 'chamber' && here.id === run.position) ||
                 (here.type === 'corridor' && (here.a === run.position || here.b === run.position));
    if (!fine) {
      const c = world.chambers[run.position];
      const tile = run.position === run.floor.entrance ? world.spawn : { x: c.cx, y: c.cy };
      const spot = world.walkable(tile.x, tile.y) ? tile : { x: c.cx - 1, y: c.cy };
      player.place(spot);
      player.snapCamera();
    }
    view.syncEntities(run);
  }

  /** Call after the fight overlay closes. Won: goblin removed, player stays put. Fled or draw: back outside. */
  function afterFight(res) {
    if ((res.outcome === 'fled' || res.outcome === 'draw') && entryFrom) player.place(entryFrom);
    view.syncEntities(run);
  }

  function pause() { paused = true; input.setEnabled(false); stop(); view.render(); }
  function resume() { paused = false; input.setEnabled(true); start(); }

  function nearChest() {
    const t = player.state.tile;
    return !player.state.moving && Math.abs(t.x - world.chest.x) <= 1 && Math.abs(t.y - world.chest.y) <= 1;
  }

  function attach(el) { view.attach(el); if (fpsEl) el.append(fpsEl); observe(el); }

  function destroy() {
    stop();
    observer?.disconnect();
    input.destroy();
    view.dispose();
  }

  return {
    world, view, player, run,
    pause, resume, afterFight, syncToRun, nearChest, attach, destroy,
    refresh: () => view.syncEntities(run),
    isPaused: () => paused,
    stats: () => ({ fps: fps.value, worstFrameMs: Math.round((fps.lastWorst || 0) * 1000), drawCalls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles }),
    tile: () => ({ ...player.state.tile })
  };
}
