// Builds the Three.js scene from the tile grid. Rendering only: no game rules.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const C = {
  bg: 0x06080c,
  stoneLo: new THREE.Color(0x1d2633),
  stoneHi: new THREE.Color(0x3a4759),
  floorLo: new THREE.Color(0x161c25),
  floorHi: new THREE.Color(0x262e3a),
  zone: new THREE.Color(0x3a1813),
  torch: 0xffa24a,
  exit: 0x8fd3ff,
  goblin: 0x66744a,
  wood: 0x5a3b22,
  amber: 0xe8b04b
};
export const MAX_TORCH_LIGHTS = 6;
const DUST = 240;

export function createScene(host, world) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.domElement.className = 'cave-canvas';
  renderer.domElement.setAttribute('aria-label', '3D view of the cave');
  renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.FogExp2(C.bg, 0.062);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0x4a6688, 0x0b0e14, 1.25));

  const disposables = [];
  const keep = (...xs) => { disposables.push(...xs); return xs[0]; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();

  /* ---------- floor (one instanced mesh) ---------- */
  const zoneNodes = new Set(world.goblins.map(g => g.nodeId));
  const floorGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const floorMat = keep(new THREE.MeshLambertMaterial());
  const floors = new THREE.InstancedMesh(floorGeo, floorMat, world.floors.length);
  const floorIndexByNode = {};
  world.floors.forEach((f, i) => {
    m4.makeTranslation(f.x, 0, f.y);
    floors.setMatrixAt(i, m4);
    col.copy(C.floorLo).lerp(C.floorHi, f.shade);
    if (zoneNodes.has(f.region)) {
      col.lerp(C.zone, 0.55);
      (floorIndexByNode[f.region] ||= []).push(i);
    }
    floors.setColorAt(i, col);
  });
  scene.add(floors);

  /* ---------- walls (one instanced mesh, noisy colour and height) ---------- */
  const wallGeo = keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const wallMat = keep(new THREE.MeshLambertMaterial({ flatShading: true }));
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, world.walls.length);
  world.walls.forEach((w, i) => {
    q.setFromAxisAngle(v.set(0, 1, 0), w.tilt);
    m4.compose(v.set(w.x, 0, w.y), q, s.set(1.04, w.h, 1.04));
    walls.setMatrixAt(i, m4);
    walls.setColorAt(i, col.copy(C.stoneLo).lerp(C.stoneHi, w.shade));
  });
  scene.add(walls);

  /* ---------- torches: holders, flame sprites, and a pool of 6 lights ---------- */
  const flameTex = keep(radialTexture('rgba(255,214,140,1)', 'rgba(255,140,40,0.55)', 'rgba(255,120,30,0)'));
  const flameMat = keep(new THREE.SpriteMaterial({ map: flameTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const holderGeo = keep(new THREE.BoxGeometry(0.08, 0.32, 0.08));
  const holderMat = keep(new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
  const holders = new THREE.InstancedMesh(holderGeo, holderMat, world.torches.length);
  const torchPoints = world.torches.map((t, i) => {
    const wallZ = t.y + t.side * 0.47;
    m4.makeTranslation(t.x, 1.0, wallZ);
    holders.setMatrixAt(i, m4);
    const flame = new THREE.Sprite(flameMat);
    flame.position.set(t.x, 1.22, wallZ - t.side * 0.06);
    flame.scale.setScalar(0.42);
    scene.add(flame);
    return { pos: new THREE.Vector3(t.x, 1.25, t.y + t.side * 0.25), flame, phase: t.phase };
  });
  scene.add(holders);

  const lightPool = Array.from({ length: MAX_TORCH_LIGHTS }, () => {
    const l = new THREE.PointLight(C.torch, 0, 9, 1.4);
    scene.add(l);
    return { light: l, torch: null };
  });

  /* ---------- exit glow ---------- */
  const portalTex = keep(radialTexture('rgba(220,245,255,0.95)', 'rgba(143,211,255,0.45)', 'rgba(143,211,255,0)'));
  const portal = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(1.3, 1.9)),
    keep(new THREE.MeshBasicMaterial({ map: portalTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  );
  portal.position.set(world.exit.x, 0.95, world.exit.y);
  portal.rotation.y = -Math.PI / 2;
  scene.add(portal);
  const exitLight = new THREE.PointLight(C.exit, 3, 7, 1.6);
  exitLight.position.set(world.exit.x - 0.6, 1.1, world.exit.y);
  scene.add(exitLight);

  /* ---------- chest: a glowing box ---------- */
  const chest = new THREE.Group();
  const chestBase = new THREE.Mesh(keep(new THREE.BoxGeometry(0.72, 0.4, 0.5)), keep(new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.8 })));
  chestBase.position.y = 0.2;
  const lidPivot = new THREE.Group();
  lidPivot.position.set(-0.36, 0.4, 0);
  const lid = new THREE.Mesh(keep(new THREE.BoxGeometry(0.72, 0.16, 0.52)), chestBase.material);
  lid.position.set(0.36, 0.08, 0);
  lidPivot.add(lid);
  const bandMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a1c10, emissive: C.amber, emissiveIntensity: 1.6, roughness: 0.4 }));
  const band = new THREE.Mesh(keep(new THREE.BoxGeometry(0.75, 0.06, 0.54)), bandMat);
  band.position.y = 0.4;
  const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: flameTex, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })));
  halo.position.y = 0.45;
  halo.scale.setScalar(1.6);
  chest.add(chestBase, lidPivot, band, halo);
  chest.position.set(world.chest.x, 0, world.chest.y);
  chest.rotation.y = Math.PI / 2;
  scene.add(chest);

  /* ---------- goblins: capsule body + small head, with a patrol-zone ring ---------- */
  const gobBodyGeo = keep(new THREE.CapsuleGeometry(0.2, 0.32, 4, 10));
  const gobHeadGeo = keep(new THREE.SphereGeometry(0.16, 14, 10));
  const gobEarGeo = keep(new THREE.ConeGeometry(0.05, 0.16, 6));
  const gobMat = keep(new THREE.MeshLambertMaterial({ color: C.goblin }));
  const eyeMat = keep(new THREE.MeshBasicMaterial({ color: 0xffc95a }));
  const eyeGeo = keep(new THREE.SphereGeometry(0.025, 6, 4));
  const ringGeo = keep(new THREE.RingGeometry(1.15, 1.25, 48).rotateX(-Math.PI / 2));
  const ringMat = keep(new THREE.MeshBasicMaterial({ color: 0xc2563f, transparent: true, opacity: 0.45, depthWrite: false }));
  const goblins = world.goblins.map(g => {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(gobBodyGeo, gobMat); body.position.y = 0.38;
    const head = new THREE.Mesh(gobHeadGeo, gobMat); head.position.y = 0.82;
    const earL = new THREE.Mesh(gobEarGeo, gobMat); earL.position.set(0, 0.86, -0.17); earL.rotation.x = -1.2;
    const earR = new THREE.Mesh(gobEarGeo, gobMat); earR.position.set(0, 0.86, 0.17); earR.rotation.x = 1.2;
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(0.13, 0.85, -0.06);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.13, 0.85, 0.06);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 0.02;
    grp.add(body, head, earL, earR, eyeL, eyeR, ring);
    grp.position.set(g.x, 0, g.y);
    grp.rotation.y = Math.PI;              // face back toward the entrance
    grp.userData = { ...g, ring, body };
    scene.add(grp);
    return grp;
  });

  /* ---------- dust drifting in torchlight ---------- */
  const dustGeo = keep(new THREE.BufferGeometry());
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = Array.from({ length: DUST }, (_, i) => ({
    slot: i % MAX_TORCH_LIGHTS, ox: hash(i, 1) * 2.4 - 1.2, oz: hash(i, 2) * 2.4 - 1.2, oy: hash(i, 3) * 1.8,
    speed: 0.05 + hash(i, 4) * 0.12, phase: hash(i, 5) * 6.28
  }));
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = keep(new THREE.PointsMaterial({ color: 0xffcf8a, size: 0.04, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  /* ---------- per-frame updates ---------- */
  let lightTimer = 0;
  function assignLights(playerPos) {
    const sorted = torchPoints
      .map(t => ({ t, d: t.pos.distanceToSquared(playerPos) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_TORCH_LIGHTS);
    lightPool.forEach((slot, i) => {
      const pick = sorted[i];
      slot.torch = pick && pick.d < 16 * 16 ? pick.t : null;
      if (slot.torch) slot.light.position.copy(slot.torch.pos);
    });
  }

  function update(dt, playerPos, time) {
    lightTimer -= dt;
    if (lightTimer <= 0) { assignLights(playerPos); lightTimer = 0.2; }

    for (const slot of lightPool) {
      if (!slot.torch) { slot.light.intensity = 0; continue; }
      const p = slot.torch.phase;
      slot.light.intensity = 8 * (0.82 + 0.1 * Math.sin(time * 9 + p) + 0.08 * Math.sin(time * 23 + p * 2));
    }
    for (const t of torchPoints) t.flame.scale.setScalar(0.4 + 0.04 * Math.sin(time * 11 + t.phase));

    // dust follows whichever torches are lit near the player
    for (let i = 0; i < DUST; i++) {
      const d = dustSeed[i];
      const slot = lightPool[d.slot];
      const o = i * 3;
      if (!slot.torch) { dustPos[o + 1] = -50; continue; }
      const y = (d.oy + time * d.speed) % 1.8;
      dustPos[o] = slot.torch.pos.x + d.ox + Math.sin(time * 0.6 + d.phase) * 0.15;
      dustPos[o + 1] = 0.15 + y;
      dustPos[o + 2] = slot.torch.pos.z + d.oz + Math.cos(time * 0.5 + d.phase) * 0.15;
    }
    dustGeo.attributes.position.needsUpdate = true;

    for (const g of goblins) {
      if (!g.visible) continue;
      const u = g.userData;
      g.position.y = Math.abs(Math.sin(time * 2.4 + u.phase)) * 0.04;
      const dx = playerPos.x - g.position.x, dz = playerPos.z - g.position.z;
      if (dx * dx + dz * dz < 64) {
        const target = Math.atan2(-dz, dx);
        g.rotation.y += shortest(g.rotation.y, target) * Math.min(1, dt * 3);
      }
      u.ring.material.opacity = 0.3 + 0.15 * Math.sin(time * 2 + u.phase);
    }

    halo.material.opacity = state.chestOpen ? 0.12 : 0.45 + 0.1 * Math.sin(time * 3);
    portal.material.opacity = state.exitOpen ? 0.95 : 0.4 + 0.08 * Math.sin(time * 1.5);
    exitLight.intensity = state.exitOpen ? 7 + Math.sin(time * 2) : 2.5;
  }

  /* ---------- reflect run state ---------- */
  const state = { chestOpen: false, exitOpen: false };
  function syncEntities(run) {
    for (const g of goblins) {
      const u = g.userData;
      g.visible = u.index >= (run.defeated[u.nodeId] || 0);
    }
    for (const [nodeId, list] of Object.entries(floorIndexByNode)) {
      const cleared = run.isResolved(nodeId);
      for (const i of list) {
        const f = world.floors[i];
        col.copy(C.floorLo).lerp(C.floorHi, f.shade);
        if (!cleared) col.lerp(C.zone, 0.55);
        floors.setColorAt(i, col);
      }
    }
    floors.instanceColor.needsUpdate = true;
    state.chestOpen = run.chestOpened;
    state.exitOpen = run.chestOpened;
    lidPivot.rotation.z = run.chestOpened ? 1.9 : 0;
    bandMat.emissiveIntensity = run.chestOpened ? 0.25 : 1.6;
  }

  /* ---------- picking for tap-to-open ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(chest, true).length) return 'chest';
    if (raycaster.intersectObject(portal, false).length) return 'exit';
    return null;
  }

  function setSize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    disposables.forEach(d => d.dispose?.());
    floors.dispose(); walls.dispose(); holders.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    renderer, scene, camera, update, syncEntities, pick, setSize, dispose,
    render: () => renderer.render(scene, camera),
    attach: el => el.append(renderer.domElement)
  };
}

function radialTexture(inner, mid, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, mid);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function hash(i, k) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }
function shortest(from, to) { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
