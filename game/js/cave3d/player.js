// Player: tile-to-tile movement, collision via a tryStep callback, and the follow camera.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export const STEP_TIME = 0.15;   // seconds per tile (about 6.7 tiles per second)

// Camera: behind (west of) the player, slightly above, over the right shoulder, looking deeper into the cave.
const CAM_OFFSET = new THREE.Vector3(-3.3, 3.9, 0.7);
const CAM_LOOK = new THREE.Vector3(2.4, 0.35, 0.1);

export function createPlayer(scene, start) {
  const group = new THREE.Group();
  const cloak = new THREE.MeshLambertMaterial({ color: 0x4a6d8f, emissive: 0x0d1824 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc99572, emissive: 0x1a120c });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), cloak);
  body.position.y = 0.44;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin);
  head.position.y = 0.95;
  const lanternGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  lanternGlow.position.set(0.18, 0.62, 0.2);
  const lantern = new THREE.PointLight(0xffd29a, 3.2, 6, 1.4);
  lantern.position.set(-0.3, 1.3, 0.25);   // behind-right, so the player is lit from the camera side
  group.add(body, head, lanternGlow, lantern);
  scene.add(group);

  const p = {
    group, tile: { ...start }, from: { ...start }, to: { ...start },
    t: 1, moving: false, heading: 0, bump: 0, bumpDir: { dx: 0, dy: 0 }
  };
  place(start);

  function place(tile) {
    p.tile = { ...tile }; p.from = { ...tile }; p.to = { ...tile };
    p.t = 1; p.moving = false;
    group.position.set(tile.x, 0, tile.y);
  }

  function face(dir) { p.heading = Math.atan2(-dir.dy, dir.dx); }

  function tryStart(dir, tryStep) {
    const target = { x: p.tile.x + dir.dx, y: p.tile.y + dir.dy };
    face(dir);
    if (!tryStep(p.tile, target)) { p.bump = 0.18; p.bumpDir = dir; return false; }
    p.from = { ...p.tile }; p.to = target; p.t = 0; p.moving = true;
    return true;
  }

  /** dir: { dx, dy } or null. tryStep(from, to) -> boolean. onArrive(tile) may pause the game. */
  function update(dt, dir, tryStep, onArrive, isPaused) {
    if (p.moving) {
      p.t += dt / STEP_TIME;
      if (p.t >= 1) {
        const overflow = (p.t - 1) * STEP_TIME;
        p.t = 1; p.moving = false; p.tile = { ...p.to };
        onArrive?.(p.tile);
        // keep gliding if the key is still held, carrying leftover time so the speed stays even
        if (dir && !isPaused() && tryStart(dir, tryStep)) p.t = Math.min(0.99, overflow / STEP_TIME);
      }
    } else if (dir && p.bump <= 0) {
      tryStart(dir, tryStep);
    }
    const x = p.from.x + (p.to.x - p.from.x) * p.t;
    const z = p.from.y + (p.to.y - p.from.y) * p.t;
    group.position.set(x, 0, z);
  }

  function animate(dt, time) {
    // turn smoothly toward the heading
    let d = (p.heading - group.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    group.rotation.y += d * Math.min(1, dt * 14);
    // bob while walking, nudge when bumping a wall
    body.position.y = 0.44 + (p.moving ? Math.abs(Math.sin(time * 18)) * 0.05 : Math.sin(time * 2) * 0.01);
    if (p.bump > 0) {
      p.bump -= dt;
      const k = Math.sin((0.18 - Math.max(0, p.bump)) / 0.18 * Math.PI) * 0.08;
      group.position.x += p.bumpDir.dx * k;
      group.position.z += p.bumpDir.dy * k;
    }
  }

  const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3(), look = new THREE.Vector3();
  let camReady = false;
  function updateCamera(camera, dt) {
    camTarget.copy(group.position).add(CAM_OFFSET);
    lookTarget.copy(group.position).add(CAM_LOOK);
    if (!camReady) { camera.position.copy(camTarget); look.copy(lookTarget); camReady = true; }
    const k = 1 - Math.exp(-dt * 6);
    camera.position.lerp(camTarget, k);
    look.lerp(lookTarget, k);
    camera.lookAt(look);
  }

  return { ...p, state: p, group, place, update, animate, updateCamera, snapCamera: () => { camReady = false; } };
}
