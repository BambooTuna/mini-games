// 環境の描画: 拠点(土・柵)と拡張演出、氷壁タイルと破壊アニメ、装飾(開拓対象含む)、
// 木箱・イグルー、焚き火の揺らぎ、降雪。
import * as THREE from "three";
import { insideCamp } from "../world.js";
import { buildModel } from "../models.js";
import { flickerFlames } from "./effects3d.js";

export function createEnvironment(ctx) {
  const { scene, world, clock, fx, camTarget } = ctx;
  const camp = world.camp;
  const counter = world.counter ?? null;

  // ---- 拠点の土と柵 ----
  const dirtMat = new THREE.MeshLambertMaterial({ color: 0xc29b72 });

  function buildDirt(c) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(c.x2 - c.x1 + 60, c.y2 - c.y1 + 60),
      dirtMat
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((c.x1 + c.x2) / 2, 0.8, (c.y1 + c.y2) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  let dirt = buildDirt(camp);
  let fenceGroup = buildFence(scene, camp, counter);
  // 拠点拡張の変化検知(構築時の寸法を保持。camp は in-place 更新なので毎フレーム寸法を比較する。
  // state.campStage は main の初期化順に依存するため検知には使わない)
  let builtCampX2 = camp.x2;
  let builtCampY2 = camp.y2;
  let prevCampStage = null; // 拡張 burst 演出の発火用(初回フレームは記録のみ)

  function rebuildCamp() {
    scene.remove(fenceGroup);
    scene.remove(dirt);
    fenceGroup = buildFence(scene, camp, counter);
    dirt = buildDirt(camp);
    builtCampX2 = camp.x2;
    builtCampY2 = camp.y2;
  }

  // ---- 氷壁(world.walls が無い/モデル未実装でも動く) ----
  const WALL_TILE_GAP = 110;
  const WALL_BREAK_DUR = 0.45;
  const wallEntries = []; // {wall, tiles:[{mesh,gx,gy,baseS,delay,burst}], prevBroken, anim}
  let icewallOk = true;
  for (const wall of world.walls ?? []) {
    const tiles = [];
    if (icewallOk) {
      for (const seg of wall.segments ?? []) {
        const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        const n = Math.max(1, Math.round(len / WALL_TILE_GAP));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const gx = seg.x1 + (seg.x2 - seg.x1) * t;
          const gy = seg.y1 + (seg.y2 - seg.y1) * t;
          let m;
          try { m = buildModel("icewall"); } catch { icewallOk = false; break; }
          m.position.set(gx, 0, gy);
          m.rotation.y = -Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) + ((gx * 7.7) % 0.16) - 0.08;
          const baseS = 0.92 + ((gx + gy) * 3.3) % 0.16;
          m.scale.setScalar(baseS);
          m.visible = wall.broken !== true;
          scene.add(m);
          tiles.push({ mesh: m, gx, gy, baseS, delay: tiles.length * 0.045, burst: false });
        }
        if (!icewallOk) break;
      }
    }
    wallEntries.push({ wall, tiles, prevBroken: wall.broken === true, anim: -1 });
  }

  // ---- 装飾(開拓対象・焚き火の光/炎を含む)----
  const fireLights = []; // campfire の揺らぎ対象
  const flames = [];
  const clearableDecos = []; // 開拓対象(拡張予定地の木など)。拠点に入ったら伐採演出で消す
  for (const deco of world.decorations) {
    let m;
    try { m = buildModel(deco.kind); } catch { continue; } // 未知 kind は無視
    m.position.set(deco.x, 0, deco.y);
    m.scale.setScalar(deco.scale);
    m.rotation.y = deco.rot ?? (deco.x * 13.37) % (Math.PI * 2); // 向きをばらす(決定的)
    m.traverse((o) => {
      if (o.name === "firelight" && o.isLight) fireLights.push({ light: o, base: o.intensity, seed: deco.x });
      else if (o.name === "flame") flames.push({ mesh: o, bx: o.scale.x, by: o.scale.y, bz: o.scale.z, seed: deco.x });
    });
    scene.add(m);
    if (deco.clear) {
      // 起動時点で既に拡張済みの領域内なら最初から非表示(演出なし)
      const cleared = insideCamp(camp, deco.x, deco.y);
      if (cleared) m.visible = false;
      clearableDecos.push({ mesh: m, x: deco.x, y: deco.y, cleared });
    }
  }
  for (const c of world.crates ?? []) {
    const m = buildModel("crate");
    m.position.set(c.x, 0, c.y);
    m.rotation.y = (c.x * 7.77) % 0.8 - 0.4;
    scene.add(m);
  }
  if (world.igloo) {
    const igloo = buildModel("igloo");
    igloo.position.set(world.igloo.x, 0, world.igloo.y);
    igloo.rotation.y = Math.PI;
    scene.add(igloo);
  }

  // ---- 降雪 ----
  const SNOW_COUNT = 500;
  const snowPos = new Float32Array(SNOW_COUNT * 3);
  for (let i = 0; i < SNOW_COUNT; i++) {
    snowPos[i * 3] = world.spawn.x + (Math.random() - 0.5) * 1800;
    snowPos[i * 3 + 1] = Math.random() * 700;
    snowPos[i * 3 + 2] = world.spawn.y + (Math.random() - 0.5) * 1800;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({
      color: 0xffffff, size: 4, sizeAttenuation: false,
      transparent: true, opacity: 0.85, depthWrite: false,
    })
  );
  scene.add(snow);

  function sync(state, dt, rawDt) {
    // 拠点拡張: camp 寸法が構築時と変わったら柵と土を再構築(衝突は world 側で自動追従)
    if (camp.x2 !== builtCampX2 || camp.y2 !== builtCampY2) {
      rebuildCamp();
      // 開拓: 新しく拠点内になった木や岩を伐採演出で消す(ブロッカー除去は game 側の契約)
      for (const cd of clearableDecos) {
        if (cd.cleared || !insideCamp(camp, cd.x, cd.y)) continue;
        cd.cleared = true;
        cd.mesh.visible = false;
        fx.spawnBurst({ x: cd.x, y: cd.y, color: "#8fcf9a", count: 12, life: 0.6 });
      }
    }
    // 拡張の瞬間(campStage 増加)はゲート両脇と東柵中央で burst(柵が伸びた演出)
    const campStage = state.campStage ?? 0;
    if (prevCampStage !== null && campStage > prevCampStage) {
      fx.spawnBurst({ x: camp.gate.x - camp.gate.halfW, y: camp.y2, color: "#ffe08a", count: 14, life: 0.7 });
      fx.spawnBurst({ x: camp.gate.x + camp.gate.halfW, y: camp.y2, color: "#ffe08a", count: 14, life: 0.7 });
      fx.spawnBurst({ x: camp.x2, y: (camp.y1 + camp.y2) / 2, color: "#ffe08a", count: 14, life: 0.7 });
    }
    prevCampStage = campStage;

    // 氷壁の破壊(false→true 遷移のみで発火。初期状態は構築時に反映済み)
    for (const entry of wallEntries) {
      const broken = entry.wall.broken === true;
      if (broken && !entry.prevBroken) {
        entry.anim = 0;
        for (const tile of entry.tiles) tile.burst = false;
      } else if (!broken && entry.prevBroken) {
        // 再建(もしあれば)に備えて復元
        entry.anim = -1;
        for (const tile of entry.tiles) {
          tile.mesh.visible = true;
          tile.mesh.position.y = 0;
          tile.mesh.scale.setScalar(tile.baseS);
        }
      }
      entry.prevBroken = broken;
      if (entry.anim < 0) continue;
      entry.anim += rawDt;
      let done = true;
      for (let i = 0; i < entry.tiles.length; i++) {
        const tile = entry.tiles[i];
        const t = entry.anim - tile.delay;
        if (t < 0) { done = false; continue; }
        if (t >= WALL_BREAK_DUR) {
          if (tile.mesh.visible) tile.mesh.visible = false;
          continue;
        }
        done = false;
        if (!tile.burst) {
          tile.burst = true;
          if (i % 3 === 0) fx.spawnBurst({ x: tile.gx, y: tile.gy, color: "#bfe6ff", count: 8, life: 0.5 });
        }
        const k = t / WALL_BREAK_DUR;
        tile.mesh.position.y = -k * k * 55;                  // 沈めながら
        tile.mesh.scale.setScalar(tile.baseS * (1 - k * 0.92)); // 縮めて消す
      }
      if (done) entry.anim = -1;
    }

    // campfire の揺らぎ(sin 合成の擬似ノイズ)。夜は火明かりを強めて存在感を出す
    const fireBoost = 1 + (state.time?.nightF ?? 0) * 1.6;
    for (const f of fireLights) {
      f.light.intensity =
        f.base * fireBoost *
        (0.8 + Math.sin(clock.elapsed * 9 + f.seed) * 0.12 + Math.sin(clock.elapsed * 23 + f.seed * 1.7) * 0.08);
    }
    flickerFlames(flames, clock.elapsed);

    // 降雪(カメラ周辺へリサイクル)
    const pos = snow.geometry.attributes.position;
    for (let i = 0; i < SNOW_COUNT; i++) {
      let y = pos.getY(i) - 130 * rawDt;
      if (y < 0) {
        y = 600 + Math.random() * 100;
        pos.setX(i, camTarget.x + (Math.random() - 0.5) * 1800);
        pos.setZ(i, camTarget.z + (Math.random() - 0.5) * 1800);
      }
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  return { sync };
}

// ---- 柵 ----
// counter があれば西辺をカウンター開口部で2分割する(衝突は camp 矩形のまま)。
// 拠点拡張(rebuildCamp)で作り直すため group を返す。

function buildFence(scene, camp, counter) {
  const postGeo = new THREE.BoxGeometry(10, 46, 10);
  const capGeo = new THREE.ConeGeometry(8, 14, 4);
  const railGeo = new THREE.BoxGeometry(1, 5, 4);
  const matWood = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });
  const matCap = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const group = new THREE.Group();
  const spacing = 46;

  function post(x, z) {
    const p = new THREE.Mesh(postGeo, matWood);
    p.position.set(x, 23, z);
    p.castShadow = true;
    const cap = new THREE.Mesh(capGeo, matCap);
    cap.position.set(x, 53, z);
    cap.rotation.y = Math.PI / 4;
    group.add(p, cap);
  }

  function rail(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const r = new THREE.Mesh(railGeo, matWood);
    r.scale.x = len;
    r.position.set((x1 + x2) / 2, 30, (z1 + z2) / 2);
    r.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(r);
  }

  function line(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1) return;
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      post(x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n);
    }
    rail(x1, z1, x2, z2);
  }

  const g = camp.gate;
  line(camp.x1, camp.y1, camp.x2, camp.y1); // 北
  if (counter) {
    // 西(カウンターの全長 hh*2 ぶん開けて2分割)
    const cy1 = counter.y - counter.hh;
    const cy2 = counter.y + counter.hh;
    line(camp.x1, camp.y1, camp.x1, Math.max(camp.y1, cy1));
    line(camp.x1, Math.min(camp.y2, cy2), camp.x1, camp.y2);
  } else {
    line(camp.x1, camp.y1, camp.x1, camp.y2); // 西
  }
  line(camp.x2, camp.y1, camp.x2, camp.y2); // 東
  line(camp.x1, camp.y2, g.x - g.halfW, camp.y2); // 南西
  line(g.x + g.halfW, camp.y2, camp.x2, camp.y2); // 南東

  scene.add(group);
  return group;
}
