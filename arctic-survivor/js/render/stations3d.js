// 施設の描画: カウンター・置き場トレイ・投入/受取ゾーン・動線チェブロン・
// 加工ステーション(レベル別ティアモデル/加工アニメ)・台上の山(肉/金)。
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { buildModel } from "../models.js";
import { addDecal, glowDecal, makeZoneDecalTexture, makeChevronTexture, makeBeltTexture } from "./decals.js";
import { itemModelKey, STACK_H, flickerFlames } from "./effects3d.js";

// 山の表示上限(肉36 / 金40 で統一)
const PILE_CAP_MEAT = 36;
const PILE_CAP_MONEY = 40;

// 山の i 番目の置き位置(2個/層 ±10 オフセットで高く積む。baseH=トレイ上面 44 の少し上。
// トレイや天板と同一高さに置くと z-fighting でチラつくため必ず浮かせる)
function pileSlotPos(anchor, i, stackH, baseH = 44.5) {
  return {
    x: anchor.x + ((i % 2) - 0.5) * 20,
    y: baseH + Math.floor(i / 2) * stackH,
    z: anchor.y + ((Math.floor(i / 2) % 2) - 0.5) * 6,
  };
}

export function createStations3d(ctx) {
  const { scene, world, clock, fx } = ctx;
  const counter = world.counter ?? null;

  // ---- カウンター(西柵に埋め込み、長辺は南北。前面化粧板は東=ゾーン側を向く) ----
  if (counter) {
    try {
      const counterModel = buildModel("counter");
      counterModel.position.set(counter.x, 0, counter.y);
      counterModel.rotation.y = Math.PI / 2;
      scene.add(counterModel);
    } catch { /* モデル未実装でも進行 */ }
  }

  // ---- ゾーン矩形デカール(台前の投入/受取判定。in=白枠+▼ / out=金枠+▲、中に立つと緑に光る) ----
  // アイテム絵文字と枠色をデカールに焼き込み、文字を使わず「何を置く/取る場所か」を示す
  const KIND_ICON = { raw: "🥩", slice: "🥓", cooked: "🍖", money: "💵" };
  const ZONE_IN_FRAME = "#e8f4ff";
  const ZONE_OUT_FRAME = "#ffd84d";
  const zoneEntries = []; // {zone, decal}

  function addZone(zone, kind, frameColor, arrowGlyph) {
    if (!zone) return;
    const texture = makeZoneDecalTexture(KIND_ICON[kind] ?? "", frameColor, arrowGlyph);
    const decal = addDecal(scene, texture, zone.x, zone.y, zone.w, zone.h);
    zoneEntries.push({ zone, decal });
  }
  for (const st of world.stations ?? []) {
    const proc = CONFIG.process?.[st.key];
    addZone(st.inZone, proc?.inKind ?? "raw", ZONE_IN_FRAME, "▼");
    addZone(st.outZone, proc?.outKind ?? "raw", ZONE_OUT_FRAME, "▲");
  }
  addZone(counter?.inZone, CONFIG.counter?.inKind ?? "cooked", ZONE_IN_FRAME, "▼");
  addZone(counter?.outZone, "money", ZONE_OUT_FRAME, "▲");

  // ---- 動線チェブロン(カット→焼き→売りの流れを地面に薄く示す。静的) ----
  {
    const chevronTexture = makeChevronTexture();
    // 動線は東→西→南の一方通行: カット台in(1215,790)→out(1085)→焼き台in(925)→out(795)
    // →カウンターin(747,870)→金回収out(747,960)。各ゾーン間隙の中央に置き、
    // ゾーン矩形・パッドデカール(半幅66)と重ねない(rz: 0=東向き, π=西向き, -π/2=南向き)
    const chevrons = [
      { x: 1150, y: 790, rz: Math.PI, size: 36 },
      { x: 1020, y: 790, rz: Math.PI, size: 36 },
      { x: 990, y: 790, rz: Math.PI, size: 36 },
      { x: 860, y: 790, rz: Math.PI, size: 36 },
      { x: 747, y: 915, rz: -Math.PI / 2, size: 24 },
    ];
    for (const cv of chevrons) {
      const m = addDecal(scene, chevronTexture, cv.x, cv.y, cv.size);
      m.material.opacity = 0.25;
      m.rotation.z = cv.rz;
    }
  }

  // ---- ベルトコンベア(台が conveyor.unlockLevel 以上で出現。搬送ロジックは game/production) ----
  // 矢羽根テクスチャが from→to へ流れる。山と同じ高さ(≈45)に浮かせた橋として描く
  const beltEntries = []; // {lvKey, mesh, texture}

  function addBelt(lvKey, from, to) {
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const texture = makeBeltTexture();
    texture.repeat.set(len / 48, 1);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 26),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(dy, dx); // チェブロンと同じ流儀(rz=0 が +x 向き)
    mesh.position.set((from.x + to.x) / 2, 45, (from.y + to.y) / 2);
    mesh.visible = false;
    scene.add(mesh);
    beltEntries.push({ lvKey, mesh, texture });
  }

  {
    const cutboardSt = (world.stations ?? []).find((s) => s.key === "cutboard");
    const grillSt = (world.stations ?? []).find((s) => s.key === "grill");
    addBelt("cutboard", cutboardSt?.outPile, grillSt?.inPile);
    addBelt("grill", grillSt?.outPile, counter?.inPile);
  }

  // ---- 置き場トレイ(テーブル上の山アンカーの目印。天板上面=42 の上に載せる) ----
  // 天板と面一(上面同士が同一平面)にすると z-fighting で移動中にチラつくため重ねない
  function addTray(anchor) {
    if (!anchor) return;
    try {
      const m = buildModel("tray");
      m.position.set(anchor.x, 42, anchor.y);
      scene.add(m);
    } catch { /* モデル未実装でも進行 */ }
  }
  for (const st of world.stations ?? []) {
    addTray(st.inPile);
    addTray(st.outPile);
  }
  addTray(counter?.inPile);
  addTray(counter?.outPile);

  // ---- ステーション(cutboard / grill。テーブルは常設) ----
  // モデルはレベルで進化する(Lv1-2: 手作業 / Lv3-4: 機械 / Lv5: 自動ライン)。
  // tier 変化は sync が save.levels から検知して差し替える
  const stationEntries = [];
  const stationFlames = []; // ティア差し替えで増減する炎の揺らぎ対象

  function attachStationModel(e, tier) {
    if (e.model) {
      scene.remove(e.model);
      const fi = stationFlames.findIndex((f) => f.mesh === e.flame);
      if (fi >= 0) stationFlames.splice(fi, 1);
    }
    e.model = null;
    e.flame = null;
    e.spins = [];
    let model;
    try { model = buildModel(tier > 1 ? `${e.st.key}_${tier}` : e.st.key); }
    catch {
      try { model = buildModel(e.st.key); } catch { return; }
    }
    model.position.set(e.st.x, 0, e.st.y);
    scene.add(model);
    e.model = model;
    e.tier = tier;
    model.traverse((o) => {
      if (o.name === "flame") {
        e.flame = o;
        stationFlames.push({ mesh: o, bx: o.scale.x, by: o.scale.y, bz: o.scale.z, seed: e.st.x });
      } else if (o.name === "spin") {
        e.spins.push(o); // 加工中に回す部品(丸ノコ/クランク)
      }
    });
  }

  for (const st of world.stations ?? []) {
    const def = CONFIG.process?.[st.key];
    const e = {
      st, model: null, flame: null, spins: [], tier: 0, synced: false,
      inKey: itemModelKey(def?.inKind ?? "raw"),
      outKey: itemModelKey(def?.outKind ?? "raw"),
      inMeshes: [], outMeshes: [],
    };
    attachStationModel(e, 1);
    if (!e.model) continue;
    stationEntries.push(e);
  }

  // テーブル上の山(メッシュは作り置きして可視数で出し分ける)
  function updatePile(arr, key, anchor, count) {
    if (!anchor) return;
    while (arr.length < count) {
      let m;
      try { m = buildModel(key); } catch { return; }
      const i = arr.length;
      const p = pileSlotPos(anchor, i, STACK_H[key] ?? 8);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = i * 0.9;
      m.visible = false;
      scene.add(m);
      arr.push(m);
    }
    for (let i = 0; i < arr.length; i++) {
      const v = i < count;
      if (arr[i].visible !== v) arr[i].visible = v;
    }
  }

  // カウンターの肉山(投入待ちの焼き肉)メッシュプール
  const counterInMeshes = [];

  // ---- 金の山(save.counterMoney を counter.outPile に積む。増えた瞬間に最上段が跳ねる) ----
  const moneyPileMeshes = [];
  let moneyPilePrevN = null;
  let moneyPileBounceT = 0;

  function updateMoneyPile(state, rawDt) {
    const anchor = counter?.outPile;
    if (!anchor) return;
    const n = Math.min(PILE_CAP_MONEY, Math.ceil((state.save.counterMoney ?? 0) / (CONFIG.money?.billValue ?? 20)));
    if (moneyPilePrevN !== null && n > moneyPilePrevN) moneyPileBounceT = 0.25;
    moneyPilePrevN = n;
    if (moneyPileBounceT > 0) moneyPileBounceT = Math.max(0, moneyPileBounceT - rawDt);
    while (moneyPileMeshes.length < n) {
      let m;
      try { m = buildModel("money"); } catch { return; }
      const i = moneyPileMeshes.length;
      const p = pileSlotPos(anchor, i, STACK_H.money ?? 7);
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = (i % 4) * 0.35 - 0.5;
      m.visible = false;
      scene.add(m);
      moneyPileMeshes.push(m);
    }
    for (let i = 0; i < moneyPileMeshes.length; i++) {
      const m = moneyPileMeshes[i];
      const v = i < n;
      if (m.visible !== v) m.visible = v;
      const baseY = pileSlotPos(anchor, i, STACK_H.money ?? 7).y;
      if (i === n - 1 && moneyPileBounceT > 0) {
        const b = moneyPileBounceT / 0.25;
        m.scale.setScalar(1 + 0.5 * b);
        m.position.y = baseY + b * 6;
      } else if (m.scale.x !== 1) {
        m.scale.setScalar(1);
        m.position.y = baseY;
      }
    }
  }

  function sync(state, dt, rawDt) {
    const player = state.player;

    // ステーション: 台上の inPile/outPile に山を積む。レベルで見た目ティアが進化
    for (const e of stationEntries) {
      const lv = state.save.levels?.[e.st.key] ?? 1;
      const tier = lv >= 5 ? 3 : lv >= 3 ? 2 : 1;
      if (tier !== e.tier) {
        attachStationModel(e, tier);
        // 初回同期はセーブの反映なので演出なし。レベルアップ由来の差し替えだけ burst
        if (e.synced) fx.spawnBurst({ x: e.st.x, y: e.st.y, color: "#ffd84d", count: 20, life: 0.6 });
      }
      e.synced = true;
      const data = state.stations?.[e.st.key];
      const inLen = data?.input?.length ?? 0;
      const outLen = data?.output?.length ?? 0;
      updatePile(e.inMeshes, e.inKey, e.st.inPile, Math.min(PILE_CAP_MEAT, inLen));
      updatePile(e.outMeshes, e.outKey, e.st.outPile, Math.min(PILE_CAP_MEAT, outLen));
      // 加工中は台が小さく揺れ、炎が点き、spin 部品(丸ノコ/クランク)が回る
      const processing = inLen > 0;
      if (e.model) e.model.rotation.z = processing ? Math.sin(clock.elapsed * 26 + e.st.x) * 0.025 : 0;
      if (e.flame && e.flame.visible !== processing) e.flame.visible = processing;
      if (processing) for (const sp of e.spins) sp.rotation.y += dt * 9;
    }
    flickerFlames(stationFlames, clock.elapsed);

    // ベルトコンベア: 解放状態の反映と矢羽根のスクロール(from→to へ流れて見える向き)
    for (const be of beltEntries) {
      const unlocked = (state.save.levels?.[be.lvKey] ?? 0) >= CONFIG.conveyor.unlockLevel;
      if (be.mesh.visible !== unlocked) be.mesh.visible = unlocked;
      if (unlocked) be.texture.offset.x -= dt * 0.9;
    }

    // カウンターの肉山(投入待ちの焼き肉)と金の山
    updatePile(counterInMeshes, "meat_cooked", counter?.inPile,
      Math.min(PILE_CAP_MEAT, state.counter?.input?.length ?? 0));
    updateMoneyPile(state, rawDt);

    // ゾーン矩形: プレイヤーが中にいると緑に光って脈動(パッドと同じ流儀。枠色はテクスチャ焼き込み)
    for (const ze of zoneEntries) {
      const z = ze.zone;
      const inside = Math.abs(player.x - z.x) < z.w / 2 && Math.abs(player.y - z.y) < z.h / 2;
      const zs = glowDecal(ze.decal, inside, clock.elapsed);
      ze.decal.scale.set(zs, zs, 1);
    }
  }

  return { sync };
}
