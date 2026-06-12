// ローポリ3Dモデルをプリミティブ合成で組み立てる。
// assets/models/<key>.glb を置けばそちらが優先される(差し替え用)。
import * as THREE from "three";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { clone as cloneWithSkeleton } from "../vendor/utils/SkeletonUtils.js";

const MODEL_KEYS = [
  "player", "hunter", "bear_t1", "bear_t2", "bear_t3", "bear_t4",
  "meat", "meat_slice", "meat_cooked", "tree", "rock", "crate", "igloo",
  "iceshard", "snowpile", "deadtree", "bones",
  "tent", "campfire", "logpile", "path",
  "icewall", "money", "customer", "lake",
  "counter", "cutboard", "cutboard_2", "cutboard_3", "grill", "grill_2", "grill_3", "tray",
];

const glbOverrides = {};

// glb差し替えモデルの正規化(寸法は assets/README.md の目安サイズに合わせる)。
// height: y寸法 / width: 水平最大寸法 / rotateY: 前方を +Z に合わせる補正 /
// decorate: ゲーム側の名前契約(weapon/flame/firelight)をテンプレートに足す
const GLB_SPECS = {
  player: { height: 50, pose: "Idle", hide: /^handslot/, decorate: addCodeAxe },
  hunter: { height: 50, pose: "Idle", hide: /^handslot/, decorate: addCodeAxe },
  customer: { height: 50, pose: "Idle", hide: /^handslot/ },
  bear_t1: { height: 55 }, bear_t2: { height: 55 }, bear_t3: { height: 55 }, bear_t4: { height: 55 },
  tree: { height: 100 },
  rock: { width: 40 },
  crate: { width: 36 },
  igloo: { width: 90 },
  snowpile: { width: 50 },
  tent: { height: 51 },
  campfire: { width: 55, decorate: addFireGlow },
  logpile: { width: 44 },
};

// 足元 y=0・中心 x/z=0・目安サイズへスケールしたテンプレートに包む
function normalizeOverride(key, gltf) {
  const root = gltf.scene;
  const spec = GLB_SPECS[key] ?? {};
  if (spec.rotateY) root.rotation.y = spec.rotateY;
  // 同梱の持ち物(handslot 配下の武器・盾など)を隠す
  if (spec.hide) root.traverse((o) => { if (spec.hide.test(o.name)) o.visible = false; });
  // 指定クリップの先頭フレームで静的ポーズを付ける(T ポーズ回避。クローンにも引き継がれる)
  if (spec.pose && gltf.animations?.length) {
    const clip = gltf.animations.find((a) => a.name === spec.pose);
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.update(0);
    }
  }
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let s = 1;
  if (spec.height) s = spec.height / (size.y || 1);
  else if (spec.width) s = spec.width / (Math.max(size.x, size.z) || 1);
  root.scale.setScalar(s);
  root.position.set(
    -((box.min.x + box.max.x) / 2) * s,
    -box.min.y * s,
    -((box.min.z + box.max.z) / 2) * s
  );
  const wrap = new THREE.Group();
  wrap.add(root);
  spec.decorate?.(wrap);
  return wrap;
}

// 人型glbにコード製のオノを持たせる(swing/強化色のweapon・axehead契約を維持)
function addCodeAxe(wrap) {
  const weapon = new THREE.Group();
  weapon.name = "weapon";
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 26, 8),
    new THREE.MeshLambertMaterial({ color: 0x7a4a22 })
  );
  handle.position.y = 8;
  const headAxe = new THREE.Mesh(
    new THREE.BoxGeometry(10, 8, 3),
    new THREE.MeshLambertMaterial({ color: 0xb8c4cd })
  );
  headAxe.name = "axehead";
  headAxe.position.y = 20;
  weapon.add(handle, headAxe);
  weapon.position.set(14, 16, 2);
  weapon.rotation.z = -0.4;
  wrap.add(weapon);
}

// 焚き火glbに炎と光を足す(environment が flame/firelight 名で揺らぎを付ける契約)
function addFireGlow(wrap) {
  wrap.add(makeFlame(9, 26, 0, 20, 0));
  const light = new THREE.PointLight(0xffa040, 90, 250, 1);
  light.name = "firelight";
  light.position.set(0, 30, 0);
  wrap.add(light);
}

export async function loadModelOverrides() {
  const loader = new GLTFLoader();
  await Promise.all(
    MODEL_KEYS.map(async (key) => {
      const url = `assets/models/${key}.glb`;
      try {
        const head = await fetch(url, { method: "HEAD" });
        if (!head.ok) return;
        const gltf = await loader.loadAsync(url);
        glbOverrides[key] = normalizeOverride(key, gltf);
      } catch {
        // 無ければプリミティブ製を使う
      }
    })
  );
}

export function buildModel(key) {
  if (glbOverrides[key]) {
    // スキンメッシュ(KayKitキャラ等)は骨ごと複製が必要なので SkeletonUtils を使う
    const clone = cloneWithSkeleton(glbOverrides[key]);
    clone.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    return clone;
  }
  const builder = BUILDERS[key];
  const group = builder();
  group.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });
  return group;
}

// ---- キャッシュ(装飾を大量に置くため geometry/material を共有する) ----
// material は実行時に emissive 等を書き換えるモデル(クマ/人型)だけ個体別にする。

const geoCache = new Map();
const matCache = new Map();
let sharedMat = true;

function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

function cachedMat(key, make) {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

// クマ/人型のビルダーを包み、その間だけ material を個体別生成にする
function perInstance(builder) {
  return () => {
    sharedMat = false;
    const g = builder();
    sharedMat = true;
    return g;
  };
}

// ---- 部品ヘルパー(ローポリ感を出すためセグメント数は少なく) ----

function mat(color) {
  if (!sharedMat) return new THREE.MeshLambertMaterial({ color });
  return cachedMat(color, () => new THREE.MeshLambertMaterial({ color }));
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo(`box:${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(color));
  m.position.set(x, y, z);
  return m;
}

function sphere(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo(`sph:${r}`, () => new THREE.SphereGeometry(r, 8, 6)), mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

function cylinder(rTop, rBottom, h, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo(`cyl:${rTop},${rBottom},${h}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, 8)), mat(color));
  m.position.set(x, y, z);
  return m;
}

function cone(r, h, color, x = 0, y = 0, z = 0, seg = 6) {
  const m = new THREE.Mesh(geo(`cone:${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), mat(color));
  m.position.set(x, y, z);
  return m;
}

// ---- 人型(主人公/ハンター) ----
// 前方は +Z。足元が y=0。

function buildHumanoid({ coat, hood, skin = 0xffd9b3, armed = true }) {
  const g = new THREE.Group();
  // 脚
  g.add(box(7, 10, 8, 0x2c3a4a, -5, 5, 0));
  g.add(box(7, 10, 8, 0x2c3a4a, 5, 5, 0));
  // コート(裾広がり)
  g.add(cylinder(11, 14, 24, coat, 0, 22, 0));
  // 腕
  g.add(cylinder(3.5, 3.5, 16, coat, -14, 24, 0));
  g.add(cylinder(3.5, 3.5, 16, coat, 14, 24, 0));
  // 手
  g.add(sphere(3.5, skin, -14, 16, 0));
  g.add(sphere(3.5, skin, 14, 16, 0));
  // 頭
  g.add(sphere(8.5, skin, 0, 41, 1));
  // フード(後頭部を覆う殻)
  const hoodMesh = new THREE.Mesh(
    geo("hood", () => new THREE.SphereGeometry(10, 8, 6, Math.PI * 0.75, Math.PI * 1.5)),
    mat(hood)
  );
  hoodMesh.position.set(0, 42, -1);
  g.add(hoodMesh);
  // フードの毛皮の縁
  const fur = new THREE.Mesh(geo("fur", () => new THREE.TorusGeometry(8.5, 2.2, 6, 10)), mat(0xe8e0d0));
  fur.position.set(0, 42, 3);
  g.add(fur);
  // 目
  g.add(sphere(1.2, 0x27364a, -3, 42, 8.2));
  g.add(sphere(1.2, 0x27364a, 3, 42, 8.2));
  // 武器(オノ)を右手に。swing アニメ用に名前を付ける
  if (armed) {
    const weapon = new THREE.Group();
    weapon.name = "weapon";
    const handle = cylinder(1.5, 1.5, 26, 0x7a4a22, 0, 8, 0);
    const headAxe = box(10, 8, 3, 0xb8c4cd, 0, 20, 0);
    headAxe.name = "axehead"; // 武器レベルで色を変えるための契約名
    weapon.add(handle, headAxe);
    weapon.position.set(14, 16, 2);
    weapon.rotation.z = -0.4;
    g.add(weapon);
  }
  return g;
}

// 村人(客)のコート配色パレット
const CUSTOMER_PALETTES = [
  { coat: 0x8a5a3b, hood: 0x6e4429 }, // 茶
  { coat: 0xb04a4a, hood: 0x8a3636 }, // 赤
  { coat: 0x7a5aa0, hood: 0x5c4380 }, // 紫
  { coat: 0xc28a3a, hood: 0x9a6c2a }, // 黄土
];

// ---- クマ ----
// 前方は +Z。足元が y=0。

function buildBear(bodyColor, { angry = false, scar = false, boss = false } = {}) {
  const g = new THREE.Group();
  const dark = 0x2c3a47;
  // 脚
  for (const [x, z] of [[-13, 8], [13, 8], [-13, -12], [13, -12]]) {
    g.add(cylinder(6, 7, 14, bodyColor, x, 7, z));
  }
  // 体(でっぷり)
  g.add(sphere(20, bodyColor, 0, 26, -4, 1.1, 1.0, 1.35));
  // おなか
  g.add(sphere(14, 0xffffff, 0, 22, 6, 1.0, 0.8, 0.9));
  // 頭
  g.add(sphere(13, bodyColor, 0, 42, 16));
  // 耳
  g.add(sphere(4, bodyColor, -8, 52, 12));
  g.add(sphere(4, bodyColor, 8, 52, 12));
  // マズル
  g.add(sphere(6, 0xffffff, 0, 39, 27, 1, 0.8, 1));
  g.add(sphere(2.2, dark, 0, 41, 31.5));
  // 目
  const eyeColor = angry && scar ? 0xcc3333 : dark;
  g.add(sphere(1.8, eyeColor, -5.5, 45, 26));
  g.add(sphere(1.8, eyeColor, 5.5, 45, 26));
  // 怒り眉
  if (angry) {
    const browL = box(5, 1.6, 1.6, dark, -6, 48, 26.5);
    browL.rotation.z = -0.5;
    const browR = box(5, 1.6, 1.6, dark, 6, 48, 26.5);
    browR.rotation.z = 0.5;
    g.add(browL, browR);
  }
  // ボスの迫力増し(牙・顔と体の傷)
  if (boss) {
    const fangL = cone(1.6, 6, 0xffffff, -3.5, 35, 29, 5);
    fangL.rotation.x = Math.PI;
    const fangR = cone(1.6, 6, 0xffffff, 3.5, 35, 29, 5);
    fangR.rotation.x = Math.PI;
    g.add(fangL, fangR);
    const scarFace = box(1.8, 10, 1.8, 0x8a3a3a, 8.5, 46, 23.5);
    scarFace.rotation.z = 0.35;
    const scarBody = box(2, 14, 2, 0x8a3a3a, -14, 32, 12);
    scarBody.rotation.z = -0.5;
    g.add(scarFace, scarBody);
  }
  // しっぽ
  g.add(sphere(4.5, bodyColor, 0, 28, -32));
  return g;
}

// ---- テーブル共通形状(footprint 200×50、天板上面 y=42)。counter/cutboard/grill が共有 ----

function woodTable(g) {
  g.add(box(200, 34, 50, 0x8a5a2b, 0, 17, 0));
  g.add(box(208, 8, 56, 0x6e4521, 0, 38, 0));
  g.add(box(200, 24, 4, 0x9c6b38, 0, 16, 25));
}

function stoneTable(g) {
  g.add(box(200, 34, 50, 0x6b7680, 0, 17, 0));
  g.add(box(208, 8, 56, 0x4d5860, 0, 38, 0));
  g.add(box(200, 24, 4, 0x7d8a94, 0, 16, 25));
}

// 炎(render 側が name="flame" で揺らぎ + 加工中のみ表示にする契約)
function makeFlame(r, h, x, y, z) {
  const flame = new THREE.Mesh(
    geo(`flame:${r},${h}`, () => new THREE.ConeGeometry(r, h, 6)),
    new THREE.MeshLambertMaterial({ color: 0xffc060, emissive: 0xff6a00, transparent: true, opacity: 0.9 })
  );
  flame.name = "flame";
  flame.position.set(x, y, z);
  flame.userData.noShadow = true;
  return flame;
}

// ---- 各モデル ----

const BUILDERS = {
  player: perInstance(() => buildHumanoid({ coat: 0x3b6ea5, hood: 0x2a5080 })),
  hunter: perInstance(() => buildHumanoid({ coat: 0x3a8a5c, hood: 0x2a6a44 })),
  bear_t1: perInstance(() => buildBear(0xf4f6f8)),
  bear_t2: perInstance(() => buildBear(0xcfd8e0, { angry: true })),
  bear_t3: perInstance(() => buildBear(0x9fb2c0, { angry: true, scar: true })),
  bear_t4: perInstance(() => buildBear(0x5b6b78, { angry: true, scar: true, boss: true })),

  meat: () => {
    const g = new THREE.Group();
    // 骨
    const bone = cylinder(1.6, 1.6, 16, 0xf6f1e6, 0, 5, 0);
    bone.rotation.z = Math.PI / 2;
    g.add(bone);
    g.add(sphere(3, 0xf6f1e6, -8, 5, 0));
    g.add(sphere(3, 0xf6f1e6, 8, 5, 0));
    // 肉
    g.add(sphere(7.5, 0xd9534f, 0, 5, 0, 1.25, 0.9, 0.95));
    g.add(sphere(4, 0xef9a9a, -2, 8, 2, 1.2, 0.6, 0.8));
    return g;
  },

  meat_slice: () => {
    // スライス肉(薄いピンクの板 w14×h3)
    const g = new THREE.Group();
    g.add(box(14, 3, 10, 0xef9a9a, 0, 1.5, 0));
    g.add(box(10, 3.4, 6, 0xf8c4c4, 0, 1.7, 0));
    return g;
  },

  meat_cooked: () => {
    // 焼き肉(茶ブロック + 焼き目2トーン)
    const g = new THREE.Group();
    g.add(box(14, 7, 11, 0x8a5230, 0, 3.5, 0));
    g.add(box(14.6, 1.6, 2.2, 0x5c3318, 0, 5.6, -2.6));
    g.add(box(14.6, 1.6, 2.2, 0x5c3318, 0, 5.6, 2.6));
    return g;
  },

  tree: () => {
    const g = new THREE.Group();
    g.add(cylinder(5, 6, 18, 0x7a5230, 0, 9, 0));
    g.add(cone(30, 36, 0x2e6b4f, 0, 34, 0, 7));
    g.add(cone(24, 32, 0x357a5b, 0, 56, 0, 7));
    g.add(cone(17, 28, 0x2e6b4f, 0, 78, 0, 7));
    // 雪のかぶり
    g.add(cone(9, 14, 0xeef4f8, 0, 94, 0, 7));
    return g;
  },

  rock: () => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(18, 0), mat(0x9aa7b2));
    base.position.y = 10;
    base.scale.set(1.2, 0.75, 1);
    g.add(base);
    const snow = new THREE.Mesh(new THREE.DodecahedronGeometry(12, 0), mat(0xeef4f8));
    snow.position.y = 20;
    snow.scale.set(1.15, 0.45, 0.95);
    g.add(snow);
    return g;
  },

  crate: () => {
    const g = new THREE.Group();
    const body = box(34, 34, 34, 0xa9743f, 0, 17, 0);
    g.add(body);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: 0x6e4521 })
    );
    edges.position.copy(body.position);
    g.add(edges);
    // 縁の板
    g.add(box(36, 5, 36, 0x8a5a2b, 0, 32, 0));
    g.add(box(36, 5, 36, 0x8a5a2b, 0, 3, 0));
    return g;
  },

  counter: () => {
    // 売りカウンター(長辺は X 方向 200。render 側で南北向きに回転して置く)
    // テーブル共通形状: footprint 200×50、天板上面 y=42(34+8)
    const g = new THREE.Group();
    woodTable(g);
    // レジ(売り場感。両端 ±60 は山のアンカーなので中央 |x|<28 に収める)
    g.add(box(24, 12, 16, 0x55606c, 0, 48, 0));
    const screen = box(18, 10, 2, 0x2c3a47, 0, 60, -6);
    screen.rotation.x = -0.25;
    g.add(screen);
    for (let i = 0; i < 3; i++) {
      g.add(box(4, 2, 4, 0xe8e0d0, -6 + i * 6, 55, 4));
    }
    return g;
  },

  tray: () => {
    // 置き場トレイ(テーブル上の山アンカーの目印)。上面はローカル y=2。
    // render 側が y=40 に置いて上面=42(天板と面一)にする契約
    const g = new THREE.Group();
    g.add(box(34, 2, 26, 0x4a3526, 0, 1, 0));
    // 縁
    g.add(box(34, 4, 2, 0x3a2a1e, 0, 2, -12));
    g.add(box(34, 4, 2, 0x3a2a1e, 0, 2, 12));
    g.add(box(2, 4, 26, 0x3a2a1e, -16, 2, 0));
    g.add(box(2, 4, 26, 0x3a2a1e, 16, 2, 0));
    return g;
  },

  cutboard: () => {
    // スライス台 Lv1-2(テーブル + 天板中央のまな板と包丁。両端は肉山の置き場なので空ける)
    const g = new THREE.Group();
    woodTable(g);
    // まな板
    g.add(box(34, 4, 24, 0xd8c49a, -6, 44, 0));
    // 包丁(刃 + 柄)
    const blade = box(16, 1.6, 7, 0xc9d4dc, 13, 45, 5);
    blade.rotation.y = 0.5;
    g.add(blade);
    const handle = box(9, 3, 3, 0x4a3a2a, 23, 45.5, 10);
    handle.rotation.y = 0.5;
    g.add(handle);
    return g;
  },

  cutboard_2: () => {
    // スライス台 Lv3-4(機械カッター: フレームに吊られた大刃 + クランク)
    const g = new THREE.Group();
    woodTable(g);
    // 門型フレーム
    g.add(box(8, 42, 10, 0x55606c, -24, 62, 0));
    g.add(box(8, 42, 10, 0x55606c, 24, 62, 0));
    g.add(box(60, 8, 12, 0x444e58, 0, 86, 0));
    // 受け台と大刃
    g.add(box(34, 4, 22, 0xd8c49a, 0, 44, 0));
    g.add(box(32, 22, 3, 0xc9d4dc, 0, 62, 0));
    g.add(box(34, 4, 4, 0x4a3a2a, 0, 74, 0));
    // クランクホイール(render 側が name="spin" で加工中に回す契約。ローカル y が回転軸)
    const wheel = new THREE.Group();
    wheel.name = "spin";
    wheel.position.set(32, 62, 16);
    wheel.rotation.x = Math.PI / 2;
    wheel.add(cylinder(9, 9, 3, 0x8d9aa5, 0, 0, 0));
    wheel.add(box(4, 4, 4, 0x4a3a2a, 6, 2.5, 0)); // ハンドルのノブ(回転が見える)
    g.add(wheel);
    return g;
  },

  cutboard_3: () => {
    // スライス台 Lv5(自動ライン: ベルトコンベア + 回転丸ノコ)
    const g = new THREE.Group();
    woodTable(g);
    // ベルト(両端ローラーの間。トレイ ±65 を避けて 90 幅)
    g.add(box(90, 6, 30, 0x3a414a, 0, 46, 0));
    g.add(box(94, 2, 32, 0x2c3136, 0, 50, 0));
    const rollerL = cylinder(5, 5, 32, 0x8d9aa5, -49, 46, 0);
    rollerL.rotation.x = Math.PI / 2;
    const rollerR = cylinder(5, 5, 32, 0x8d9aa5, 49, 46, 0);
    rollerR.rotation.x = Math.PI / 2;
    g.add(rollerL, rollerR);
    // 支柱と吊りアーム
    g.add(box(6, 30, 8, 0x55606c, -14, 62, -18));
    g.add(box(6, 30, 8, 0x55606c, 14, 62, -18));
    g.add(box(34, 6, 8, 0x444e58, 0, 80, -18));
    g.add(box(4, 6, 18, 0x55606c, 0, 76, -9));
    // 回転丸ノコ(spin 契約)
    const saw = new THREE.Group();
    saw.name = "spin";
    saw.position.set(0, 60, 0);
    saw.rotation.x = Math.PI / 2;
    saw.add(cylinder(13, 13, 2, 0xc9d4dc, 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      saw.add(box(4, 2, 5, 0x9aa7b2, Math.cos(a) * 13, 0, Math.sin(a) * 13));
    }
    g.add(saw);
    return g;
  },

  grill: () => {
    // 焼き台 Lv1-2(テーブル + 天板中央の炭・焼き網・炎。両端は肉山の置き場なので空ける)
    const g = new THREE.Group();
    stoneTable(g);
    // 炭の受け皿
    g.add(box(44, 6, 32, 0x2c2c30, 0, 45, 0));
    // 焼き網(細い棒を並べる)
    for (let i = 0; i < 6; i++) {
      g.add(box(48, 1.5, 1.5, 0x3a414a, 0, 51, -15 + i * 6));
    }
    g.add(box(1.5, 1.5, 34, 0x3a414a, -22, 51.8, 0));
    g.add(box(1.5, 1.5, 34, 0x3a414a, 22, 51.8, 0));
    g.add(makeFlame(7, 18, 0, 58, 0));
    return g;
  },

  grill_2: () => {
    // 焼き台 Lv3-4(石窯: ドーム + 窯口 + 煙突)
    const g = new THREE.Group();
    stoneTable(g);
    g.add(sphere(26, 0x8d9aa5, 0, 44, -2, 1.15, 0.95, 1.0)); // ドーム
    g.add(box(20, 16, 6, 0x1e2226, 0, 47, 22));              // 窯口
    g.add(cylinder(5, 6, 22, 0x6b7680, 14, 76, -10));        // 煙突
    g.add(cylinder(7, 7, 3, 0x4d5860, 14, 88, -10));
    g.add(makeFlame(5, 12, 0, 50, 24)); // 窯口の炎
    return g;
  },

  grill_3: () => {
    // 焼き台 Lv5(大型オーブン: 光る窓 + ダイヤル + 煙突)
    const g = new THREE.Group();
    stoneTable(g);
    g.add(box(70, 38, 38, 0x55606c, 0, 61, -3));
    g.add(box(74, 5, 42, 0x444e58, 0, 84, -3));
    // 窓(オレンジ発光)とフレーム
    const win = new THREE.Mesh(
      geo("oven-window", () => new THREE.BoxGeometry(44, 14, 2)),
      new THREE.MeshLambertMaterial({ color: 0xffa23e, emissive: 0xb84e00 })
    );
    win.position.set(0, 60, 16.5);
    g.add(win);
    g.add(box(52, 3, 3, 0x2c3136, 0, 69, 16.5));
    g.add(box(52, 3, 3, 0x2c3136, 0, 51, 16.5));
    g.add(box(3, 21, 3, 0x2c3136, -25, 60, 16.5));
    g.add(box(3, 21, 3, 0x2c3136, 25, 60, 16.5));
    // ダイヤル
    g.add(box(5, 5, 2, 0xe8e0d0, -14, 76, 16.5));
    g.add(box(5, 5, 2, 0xe8e0d0, -4, 76, 16.5));
    g.add(box(5, 5, 2, 0xe8e0d0, 6, 76, 16.5));
    // 煙突と炎
    g.add(cylinder(5, 5, 26, 0x444e58, 26, 95, -12));
    g.add(makeFlame(4.5, 11, 26, 112, -12));
    return g;
  },

  igloo: () => {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0xe8f0f6)
    );
    g.add(dome);
    // 入口トンネル
    const tunnel = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 30, 8, 1, false, 0, Math.PI),
      mat(0xdde8f0)
    );
    tunnel.rotation.z = Math.PI / 2;
    tunnel.rotation.y = Math.PI / 2;
    tunnel.position.set(0, 0, 42);
    g.add(tunnel);
    return g;
  },

  iceshard: () => {
    const g = new THREE.Group();
    const ice = cachedMat("ice", () =>
      new THREE.MeshLambertMaterial({ color: 0xa8d8f0, transparent: true, opacity: 0.75 })
    );
    const shard = (r, h, x, z, tilt) => {
      const s = new THREE.Mesh(geo(`cone:${r},${h},5`, () => new THREE.ConeGeometry(r, h, 5)), ice);
      s.position.set(x, h / 2, z);
      s.rotation.set(tilt, x, -tilt * 0.6);
      return s;
    };
    g.add(shard(10, 46, 0, 0, 0.05), shard(7, 30, 12, 6, 0.25), shard(5, 22, -10, 8, -0.2), shard(6, 18, 4, -12, 0.3));
    return g;
  },

  snowpile: () => {
    const g = new THREE.Group();
    g.add(sphere(20, 0xf4f8fb, 0, 6, 0, 1.3, 0.5, 1.1));
    g.add(sphere(13, 0xffffff, 15, 5, 9, 1.1, 0.45, 1));
    g.add(sphere(9, 0xf4f8fb, -15, 4, -7, 1, 0.5, 1));
    return g;
  },

  deadtree: () => {
    const g = new THREE.Group();
    g.add(cylinder(3, 5, 60, 0x6b5036, 0, 30, 0));
    const branch = (h, x, y, z, rz, rx = 0) => {
      const b = cylinder(1.2, 2, h, 0x6b5036, x, y, z);
      b.rotation.z = rz;
      b.rotation.x = rx;
      return b;
    };
    g.add(branch(26, 9, 48, 0, -0.9));
    g.add(branch(22, -8, 38, 2, 0.95, 0.2));
    g.add(branch(16, 4, 56, -3, -0.4, -0.5));
    return g;
  },

  bones: () => {
    const g = new THREE.Group();
    const bone = 0xeae4d4;
    // 肋骨アーチ
    for (let i = 0; i < 4; i++) {
      const r = 14 - i * 1.5;
      const rib = new THREE.Mesh(geo(`rib:${r}`, () => new THREE.TorusGeometry(r, 1.8, 5, 8, Math.PI)), mat(bone));
      rib.position.set(i * 10 - 15, 2, 0);
      rib.rotation.y = Math.PI / 2;
      g.add(rib);
    }
    // 散らばった骨片
    const frag = cylinder(1.5, 1.5, 18, bone, 28, 2, 12);
    frag.rotation.z = Math.PI / 2;
    frag.rotation.y = 0.6;
    g.add(frag);
    g.add(sphere(3, bone, 36, 2, 18));
    g.add(sphere(2.5, bone, -28, 2, -10));
    return g;
  },

  tent: () => {
    const g = new THREE.Group();
    // 三角プリズム本体(rot=0 で入口が南=+Z を向く)
    const body = new THREE.Mesh(
      geo("tent-body", () => {
        const t = new THREE.CylinderGeometry(34, 34, 72, 3, 1);
        t.rotateY(Math.PI);
        t.rotateX(Math.PI / 2);
        return t;
      }),
      mat(0x7d8ea4)
    );
    body.position.y = 17;
    g.add(body);
    // 入口(暗い三角)
    const door = new THREE.Mesh(geo("tent-door", () => new THREE.CircleGeometry(15, 3, Math.PI / 2)), mat(0x39414e));
    door.position.set(0, 14, 36.6);
    g.add(door);
    // 棟に積もった雪
    g.add(box(10, 4, 74, 0xf4f8fb, 0, 50, 0));
    return g;
  },

  campfire: () => {
    const g = new THREE.Group();
    // 石の輪
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stone = new THREE.Mesh(geo("stone", () => new THREE.DodecahedronGeometry(6, 0)), mat(0x8d9aa5));
      stone.position.set(Math.cos(a) * 24, 4, Math.sin(a) * 24);
      stone.rotation.y = i * 1.7;
      g.add(stone);
    }
    // 薪
    for (let i = 0; i < 3; i++) {
      const log = cylinder(3.5, 3.5, 30, 0x7a4a22, 0, 6, 0);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 3) * Math.PI;
      g.add(log);
    }
    g.add(makeFlame(9, 26, 0, 20, 0));
    const light = new THREE.PointLight(0xffa040, 90, 250, 1);
    light.name = "firelight";
    light.position.set(0, 30, 0);
    g.add(light);
    return g;
  },

  logpile: () => {
    const g = new THREE.Group();
    const log = (x, y) => {
      const l = cylinder(5, 5, 44, 0x7a4a22, x, y, 0);
      l.rotation.x = Math.PI / 2;
      return l;
    };
    g.add(log(-11, 5), log(0, 5), log(11, 5), log(-5.5, 14), log(5.5, 14), log(0, 23));
    return g;
  },

  icewall: () => {
    // 氷壁タイル1枚(タイル状に並べるのは render 側)。負荷を抑えるため氷+雪の2メッシュ
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      geo("icewall-body", () => new THREE.BoxGeometry(110, 75, 26)),
      cachedMat("icewall", () =>
        new THREE.MeshLambertMaterial({ color: 0xa8d4e8, transparent: true, opacity: 0.82 })
      )
    );
    body.position.y = 37.5;
    g.add(body);
    // 雪の被り
    g.add(box(114, 9, 30, 0xf4f8fb, 0, 76, 0));
    return g;
  },

  money: () => {
    // 札束(カウンター上の金の山用)
    const g = new THREE.Group();
    g.add(box(18, 6, 11, 0x4caf50, 0, 3, 0));
    g.add(box(16, 1.4, 9, 0x66bb6a, 0, 6.6, 0));
    // 帯
    g.add(box(19, 6.6, 4.5, 0xf6f1e6, 0, 3, 0));
    return g;
  },

  lake: () => {
    // 凍った湖(ブロッカーなし=上を歩ける)。雪の縁 + 氷面 + ひび割れ
    const g = new THREE.Group();
    const flat = (key, r, color, y, x = 0, z = 0) => {
      const m = new THREE.Mesh(geo(key, () => new THREE.CircleGeometry(r, 18)), mat(color));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      m.userData.noShadow = true;
      g.add(m);
    };
    flat("lake-rim", 150, 0xdfe9f0, 0.5);
    flat("lake-ice", 136, 0xa9d6ec, 0.8);
    flat("lake-sheen", 70, 0xc4e6f6, 1.1, 28, -20);
    for (const [x, z, rot, len] of [[-30, 10, 0.5, 110], [25, 35, -0.8, 80], [10, -45, 1.2, 90]]) {
      const crack = box(len, 0.6, 2.5, 0xe8f4fa, x, 1.2, z);
      crack.rotation.y = rot;
      crack.userData.noShadow = true;
      g.add(crack);
    }
    return g;
  },

  customer: perInstance(() => {
    const p = CUSTOMER_PALETTES[Math.floor(Math.random() * CUSTOMER_PALETTES.length)];
    return buildHumanoid({ coat: p.coat, hood: p.hood, armed: false });
  }),

  path: () => {
    const g = new THREE.Group();
    // 踏み固められた道(rot=0 で縦長)。地面との z-fighting を避ける設定
    const m = new THREE.Mesh(
      geo("path", () => new THREE.PlaneGeometry(46, 90)),
      cachedMat("path", () => new THREE.MeshLambertMaterial({ color: 0xb08a5e, depthWrite: false }))
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 1.2;
    m.renderOrder = 1;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return g;
  },
};
