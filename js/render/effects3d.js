// 3D エフェクト: burst/ring パーティクルと、kind 別メッシュプール(itemFly / carryFlights)。
// state.effects から新規 fx を検知して発火する。spawnBurst は他の render モジュールにも貸し出す。
import * as THREE from "three";
import { buildModel } from "../models.js";

// アイテム kind → モデルキー(raw=既存 meat)
export function itemModelKey(kind) {
  if (kind === "slice") return "meat_slice";
  if (kind === "cooked") return "meat_cooked";
  if (kind === "money") return "money";
  return "meat";
}

// 積んだときの1段ぶんの高さ(モデルキー別)
export const STACK_H = { meat: 8, meat_slice: 4, meat_cooked: 7.5, money: 7 };

// 炎メッシュの揺らぎ(sin 合成の擬似ノイズ)。flames: [{mesh,bx,by,bz,seed}]
export function flickerFlames(flames, elapsed) {
  for (const f of flames) {
    const n = 1 + Math.sin(elapsed * 11 + f.seed) * 0.1 + Math.sin(elapsed * 27 + f.seed * 1.7) * 0.06;
    f.mesh.scale.set(f.bx * (2 - n), f.by * n, f.bz * (2 - n));
  }
}

export function createEffects3d(ctx) {
  const { scene, clock } = ctx;

  // ---- burst パーティクルプール ----
  const firedFx = new WeakSet(); // 発火済み fx(fx は寿命まで配列に残る)
  const PARTICLE_MAX = 200;
  const particleGeo = new THREE.BoxGeometry(7, 7, 7);
  const particles = [];
  for (let i = 0; i < PARTICLE_MAX; i++) {
    const mesh = new THREE.Mesh(
      particleGeo,
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    );
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, vx: 0, vy: 0, vz: 0, age: 0, life: 1 });
  }
  let particleCursor = 0;

  function spawnBurst(fx) {
    const n = Math.min(fx.count ?? 10, 24);
    for (let i = 0; i < n; i++) {
      const p = particles[particleCursor];
      particleCursor = (particleCursor + 1) % PARTICLE_MAX;
      p.age = 0;
      p.life = (fx.life || 0.6) * (0.7 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 180;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 150 + Math.random() * 220;
      p.mesh.visible = true;
      p.mesh.position.set(fx.x, 30, fx.y);
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      p.mesh.material.color.set(fx.color ?? "#ffffff");
      p.mesh.material.opacity = 1;
    }
  }

  // ---- ring(地面の衝撃波)プール ----
  const RING_MAX = 5;
  const ringGeo = new THREE.RingGeometry(0.86, 1, 32);
  const ringPool = [];
  for (let i = 0; i < RING_MAX; i++) {
    const mesh = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 2;
    mesh.renderOrder = 2;
    mesh.visible = false;
    scene.add(mesh);
    ringPool.push({ mesh, age: 0, life: 1 });
  }
  let ringCursor = 0;

  function spawnRing(fx) {
    const r = ringPool[ringCursor];
    ringCursor = (ringCursor + 1) % RING_MAX;
    r.age = 0;
    r.life = fx.life || 0.5;
    r.mesh.visible = true;
    r.mesh.position.set(fx.x, 2, fx.y);
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.mesh.visible = false; continue; }
      p.vy -= 900 * dt;
      const pos = p.mesh.position;
      pos.x += p.vx * dt;
      pos.y += p.vy * dt;
      pos.z += p.vz * dt;
      if (pos.y < 3.5) pos.y = 3.5;
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.z += dt * 4;
      p.mesh.material.opacity = 1 - p.age / p.life;
    }
    for (const r of ringPool) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      if (r.age >= r.life) { r.mesh.visible = false; continue; }
      const t = r.age / r.life;
      r.mesh.scale.setScalar(20 + 140 * t);
      r.mesh.material.opacity = 1 - t;
    }
  }

  // ---- kind 別メッシュのプール(itemFly / carryFlights 共用ヘルパー) ----
  function takeFromPool(pool, key, maxTotal) {
    const free = pool.free.get(key);
    if (free?.length) return free.pop();
    if (pool.total >= maxTotal) return null;
    let m;
    try { m = buildModel(key); } catch { return null; }
    m.visible = false;
    scene.add(m);
    pool.total++;
    return m;
  }

  function releaseToPool(pool, key, mesh) {
    mesh.visible = false;
    mesh.rotation.set(0, 0, 0);
    let free = pool.free.get(key);
    if (!free) { free = []; pool.free.set(key, free); }
    free.push(mesh);
  }

  // ---- itemFly(点→点の放物線飛行 fx)。プール16 ----
  const ITEMFLY_MAX = 16;
  const itemFlyPool = { free: new Map(), total: 0 };
  const itemFlyMap = new Map(); // fx オブジェクト → {mesh, key, alive}

  function updateItemFly(state) {
    for (const fx of state.effects ?? []) {
      if (fx.kind !== "itemFly") continue;
      let entry = itemFlyMap.get(fx);
      if (!entry) {
        const key = itemModelKey(fx.itemKind ?? "raw");
        const mesh = takeFromPool(itemFlyPool, key, ITEMFLY_MAX);
        if (!mesh) continue;
        mesh.visible = true;
        entry = { mesh, key, alive: false };
        itemFlyMap.set(fx, entry);
      }
      entry.alive = true;
      const t = fx.life > 0 ? Math.min(1, fx.age / fx.life) : 1;
      entry.mesh.position.set(
        fx.x + (fx.tx - fx.x) * t,
        fx.flat ? 50 : 40 + Math.sin(t * Math.PI) * 50, // flat=ベルト上をスライド / 通常は弧を描く
        fx.y + (fx.ty - fx.y) * t
      );
      entry.mesh.rotation.y = fx.flat ? t * 2 : t * 9;
      entry.mesh.rotation.x = fx.flat ? 0 : t * 5;
    }
    // 寿命切れ(state.effects から消えた fx)のメッシュをプールへ返却
    for (const [fx, entry] of itemFlyMap) {
      if (entry.alive) {
        entry.alive = false;
      } else {
        releaseToPool(itemFlyPool, entry.key, entry.mesh);
        itemFlyMap.delete(fx);
      }
    }
  }

  // ---- carryFlights(背中へホーミング中のアイテム)。位置はロジック側更新済みの x,y,z をそのまま使う。プール48 ----
  const CARRY_MAX = 48;
  const carryPool = { free: new Map(), total: 0 };
  const carryMap = new Map(); // id → {mesh, key, alive}

  function updateCarryFlights(state) {
    const flights = state.carryFlights ?? [];
    const iter = Array.isArray(flights) ? flights : (flights.values?.() ?? []);
    for (const cf of iter) {
      const key = itemModelKey(cf.kind ?? "raw");
      let entry = carryMap.get(cf.id);
      if (entry && entry.key !== key) {
        releaseToPool(carryPool, entry.key, entry.mesh);
        carryMap.delete(cf.id);
        entry = null;
      }
      if (!entry) {
        const mesh = takeFromPool(carryPool, key, CARRY_MAX);
        if (!mesh) continue; // プール超過は非描画で可
        mesh.visible = true;
        entry = { mesh, key, alive: false };
        carryMap.set(cf.id, entry);
      }
      entry.alive = true;
      entry.mesh.position.set(cf.x, cf.z ?? 20, cf.y);
      entry.mesh.rotation.y = clock.elapsed * 6 + (cf.id ?? 0) * 0.7;
    }
    for (const [id, entry] of carryMap) {
      if (entry.alive) {
        entry.alive = false;
      } else {
        releaseToPool(carryPool, entry.key, entry.mesh);
        carryMap.delete(id);
      }
    }
  }

  function sync(state, dt, rawDt) {
    // 新規 burst / ring fx を検知して発火(他 kind は無視)
    for (const fx of state.effects) {
      if (firedFx.has(fx)) continue;
      firedFx.add(fx);
      if (fx.kind === "burst") spawnBurst(fx);
      else if (fx.kind === "ring") spawnRing(fx);
    }
    updateParticles(rawDt);
    updateItemFly(state);
    updateCarryFlights(state);
  }

  return { sync, spawnBurst };
}
