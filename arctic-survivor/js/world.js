// マップレイアウト: 拠点(柵+ゲート)、カウンター、客レーン、氷壁ゾーン、加工ステーション、建設パッド、クマの巣、装飾と衝突ブロッカー。
import { CONFIG } from "./config.js";

// 装飾・プロップ種別ごとの衝突半径(scale を掛けて使う)。bones と path は通行可能なので含めない
const BLOCKER_RADIUS = {
  tree: 20, rock: 18, iceshard: 16, deadtree: 14, snowpile: 12,
  campfire: 30, tent: 45, logpile: 35, mountain: 110,
};

// 拠点の段階拡張。西辺(カウンター)と北辺(テーブル)は固定で、南→東の順に広がる。
// main.js がセーブのレベルからステージを決めて world.camp に Object.assign で適用する
export const CAMP_STAGES = [
  { x1: 672, y1: 660, x2: 1312, y2: 1040 }, // stage0: 初期(640×380)
  { x1: 672, y1: 660, x2: 1312, y2: 1140 }, // stage1: 南へ+100(オノ Lv1)
  { x1: 672, y1: 660, x2: 1422, y2: 1140 }, // stage2: 東へ+110(ブーツ Lv1)
  { x1: 672, y1: 660, x2: 1422, y2: 1240 }, // stage3: さらに南へ+100(ハンター Lv1)
];

export function createWorld() {
  const { width, height } = CONFIG.world;
  const baseX = width * 0.31;
  const baseY = height / 2;

  // 柵で囲まれた拠点。南側中央がゲート。
  // 生成は CAMP_STAGES 最終ステージ(最大領域)で行い、main がステージで上書きする。
  // 装飾の除外・bearSpawns フィルタは最大領域基準になり、将来の拡張エリア内にプロップや湧きが入らない
  // (拡張予定地に意図して置く clear:true の開拓対象だけが例外)
  const camp = {
    ...CAMP_STAGES[CAMP_STAGES.length - 1],
    gate: { x: baseX, halfW: 90 }, // 南辺(y2)の開口部。全ステージで x=992, halfW 90 固定
  };

  // 序盤エリア(zone0)を囲む氷壁。東壁だけ壁パッドに支払うと破壊できる。
  // 南壁は stage3 拠点(y2=1240)からゲート前の広場を 380 確保する位置。
  // 東壁は stage2 東柵(x=1422)から幅 270 の通路を確保する位置(ハンターが東へ抜けられる幅)
  const zone = { x1: baseX - 620, y1: baseY - 520, x2: baseX + 700, y2: baseY + 720 };

  // カウンター(西柵 x=672 に埋め込み、縦長 25×100)。台上北側 inPile に焼き肉、南側 outPile に金が積まれる。
  // ゾーンは台の東(拠点内)に中心+75 で置く。焼き台out→カウンターin(北)→金回収out(南)→ゲート と
  // 北から南へ一方通行で流れる並び。w72×h60 はキャラ(直径36)のちょうど2倍で、
  // in/out ゾーン間の y 隙間30 と grill outZone(下端 y=821)との y 隙間19 を確保する
  const counter = {
    key: "counter",
    x: camp.x1, // 672
    y: baseY, // 900
    hw: 25,
    hh: 100,
    inPile: { x: camp.x1, y: baseY - 30 }, // (672, 870)
    outPile: { x: camp.x1, y: baseY + 60 }, // (672, 960)
    inZone: { x: camp.x1 + 75, y: baseY - 30, w: 72, h: 60 }, // (747, 870)
    outZone: { x: camp.x1 + 75, y: baseY + 60, w: 72, h: 60 }, // (747, 960)
  };

  // 客レーン(敵エリアと分離)。西氷壁の出入口(doorX)から来てカウンター西側の spots で待つ。
  // spots はカウンターの山(±60)の正面とその中間で、レーンフェンス(y=770/1030)から十分内側
  const customerLane = {
    y: baseY,
    doorX: zone.x1 + 46,
    spots: [
      { x: camp.x1 - 71, y: baseY - 40 }, // (601, 860)
      { x: camp.x1 - 71, y: baseY + 40 }, // (601, 940)
      { x: camp.x1 - 112, y: baseY }, // (560, 900)
    ],
  };

  const walls = [
    {
      id: "north",
      segments: [{ x1: zone.x1, y1: zone.y1, x2: zone.x2, y2: zone.y1 }],
      pad: null, permanent: true, broken: false,
    },
    {
      id: "west",
      segments: [{ x1: zone.x1, y1: zone.y1, x2: zone.x1, y2: zone.y2 }],
      pad: null, permanent: true, broken: false,
    },
    {
      id: "south",
      segments: [{ x1: zone.x1, y1: zone.y2, x2: zone.x2, y2: zone.y2 }],
      pad: null, permanent: true, broken: false,
    },
    {
      id: "east",
      segments: [{ x1: zone.x2, y1: zone.y1, x2: zone.x2, y2: zone.y2 }],
      pad: { x: zone.x2 - 80, y: baseY, radius: 60, cost: 400 }, // 壁の80西(1612, 900)
      permanent: false, broken: false,
    },
    // 客レーンのフェンス(壊せない・padなし)。描画は既存 icewall 流用
    {
      id: "laneN",
      segments: [{ x1: zone.x1, y1: baseY - 130, x2: camp.x1, y2: baseY - 130 }],
      pad: null, permanent: true, broken: false,
    },
    {
      id: "laneS",
      segments: [{ x1: zone.x1, y1: baseY + 130, x2: camp.x1, y2: baseY + 130 }],
      pad: null, permanent: true, broken: false,
    },
  ];

  // クマの巣(巣ごとに複数頭が湧く)。tier0 は zone0 内、tier1+ は東壁の先。
  // respawn(秒)を持つ巣だけ討伐後に再湧きする。無印の強敵は倒したら終わり
  // (リポップが速いとベース前の狩りだけで完結してしまうため、持続湧きは遠い巣に限る)。
  // 旧・西の巣は客レーンと干渉するため廃止。
  const nests = [
    // tier0(序盤の狩場): ゲート(992, 拠点y2)前の広場を避けて北と南の隅に。ゆっくり再湧き
    { x: baseX, y: baseY - 445, tier: 0, perNest: 2, respawn: 30 },
    { x: baseX - 360, y: baseY + 550, tier: 0, perNest: 2, respawn: 30 }, // (632, 1450) 南西の隅
    // 南東の隅。hunter パッド(1355,1060)まで425 > aggro(260)、東氷壁(x=1692)から十分内側
    { x: baseX + 573, y: baseY + 530, tier: 0, perNest: 2, respawn: 30 }, // (1565, 1430)
    // 中盤の強敵(東壁の先)。倒したら再湧きしない
    { x: baseX + 980, y: baseY - 330, tier: 1, perNest: 2 },
    { x: baseX + 1020, y: baseY + 60, tier: 1, perNest: 3 },
    { x: baseX + 990, y: baseY + 380, tier: 1, perNest: 3 },
    { x: baseX + 1380, y: baseY - 380, tier: 2, perNest: 2 },
    { x: baseX + 1430, y: baseY + 20, tier: 2, perNest: 2 },
    { x: baseX + 1390, y: baseY + 420, tier: 2, perNest: 2 },
    // 最奥の遠い巣だけ湧き続ける(狩り尽くした後の持続的な狩場)
    { x: baseX + 1688, y: baseY - 480, tier: 1, perNest: 2, respawn: 30 }, // (2680, 420)
    { x: baseX + 1668, y: baseY + 500, tier: 1, perNest: 2, respawn: 30 }, // (2660, 1400)
    { x: baseX + 1888, y: baseY - 200, tier: 2, perNest: 2, respawn: 45 }, // (2880, 700)
    // ボスはクエスト対象なので、倒しても時間をおいて戻ってくる
    { x: baseX + 1800, y: baseY, tier: 3, perNest: 1, respawn: 90 },
  ];

  // 加工ステーション(拠点北側、常設)。横置きテーブル(hw100×hh25)で台上東に inPile・西に outPile、
  // 台前(南)に投入/受取の矩形ゾーン(72×62=キャラ直径36 のちょうど2倍、中心は山の真南 +75)を持つ統一形状。
  // in/out ゾーン間の x 隙間は 130-72=58
  const hStation = (key, x, y) => ({
    key,
    x,
    y,
    hw: 100,
    hh: 25,
    inPile: { x: x + 65, y },
    outPile: { x: x - 65, y },
    inZone: { x: x + 65, y: y + 75, w: 72, h: 62 },
    outZone: { x: x - 65, y: y + 75, w: 72, h: 62 },
  });
  // y=715 は北柵(y=660)からテーブル北面まで30 空ける位置。
  // 動線(東→西→南の一方通行ライン): ゲート→ カット台 in(1215,790)→out(1085,790)
  //       → 焼き台 in(925,790)→out(795,790)→ カウンター in(747,870)→ 金回収 out(747,960)→ ゲートへ帰還
  const stations = [
    hStation("cutboard", baseX + 158, baseY - 185), // (1150, 715)
    hStation("grill", baseX - 132, baseY - 185), // (860, 715)
  ];

  // プロップは拠点(stage2 最大領域)の外へ(中央プラザとゲート→加工台→カウンターの動線を空ける)。
  // 木箱の山は stage2 東柵の外、イグルーは北柵の外。render 側がトップレベル参照で描画する
  // ブロッカー西端(1490-50-14=1426)が stage2 東柵(x=1422)の内側へ届かない位置。
  // 壁パッド(1612,900)・東氷壁(x=1692)のどちらにも十分な余白がある
  const crates = [
    { x: baseX + 498, y: baseY - 200 }, // (1490, 700)
    { x: baseX + 532, y: baseY - 176 }, // (1524, 724)
    { x: baseX + 502, y: baseY - 150 }, // (1494, 750)
    { x: baseX + 534, y: baseY - 126 }, // (1526, 774)
  ];
  // ブロッカー(r60+押し出し14)が北柵(y=660)の内側へ届かない距離(575+74=649<660)
  const igloo = { x: baseX - 172, y: baseY - 325 }; // (820, 575)

  // 透明ブロッカー(円の押し出し衝突)。decorations ぶんは makeDecorations が同時に積む。
  // テーブル(counter/stations)は矩形ブロッカー(rectBlockers)で塞ぐので円は積まない
  const blockers = [];
  blockers.push({ x: igloo.x, y: igloo.y, r: 60 });
  for (const c of crates) blockers.push({ x: c.x, y: c.y, r: 50 });

  // テーブル=矩形の見えない壁。resolveRectBlockers が r+14 相当のマージンで押し出す
  const rectBlockers = [counter, ...stations].map((t) => ({
    x: t.x, y: t.y, hw: t.hw, hh: t.hh,
  }));

  return {
    width,
    height,
    camp,
    walls,
    spawn: { x: baseX, y: baseY + 100 },

    counter,
    customerLane,
    stations,

    // 焚き火(回復・休憩地点)。decorations の campfire と同座標(makeDecorations 側が参照)
    campfire: { x: baseX - 52, y: baseY - 40 },

    // アップグレードパッド(上に立つと金が流れ込む。r55、5つとも強化専用)。壁パッドはここに混ぜない。
    // 配置はゾーン/焚き火/他パッドと視覚的に重ならないこと(検査は両軸の半幅和: パッド半幅≈radius)
    pads: [
      // stage0 から表示。stage0 東柵(x=1312)まで72
      { key: "weapon", x: baseX + 248, y: baseY + 60, radius: 55 }, // (1240, 960)
      // stage1。カット台(1150,715)の正面南西(outZone 下端 y=821 から円上端 y=865 で間隔44)
      { key: "cutboard", x: baseX + 98, y: baseY + 20, radius: 55 }, // (1090, 920)
      // stage1。焼き台の南、焚き火(940,860)の南西。カウンター in/out ゾーン(x≤783)と
      // boots パッド(770,1075)のどちらにも重ならない位置
      { key: "grill", x: baseX - 102, y: baseY + 140, radius: 55 }, // (890, 1040)
      // stage1 南拡張内。counter outZone 下端(y=990)まで中心から85
      { key: "boots", x: baseX - 222, y: baseY + 175, radius: 55 }, // (770, 1075)
      // stage2 東拡張内。東柵(x=1422)まで67
      { key: "hunter", x: baseX + 363, y: baseY + 160, radius: 55 }, // (1355, 1060)
    ],

    crates,
    igloo,
    blockers,
    rectBlockers,

    // クマの湧きポイント(拠点から離れるほど強いティア)
    bearSpawns: nestSpawns(nests).filter(
      (s) =>
        s.x > 80 && s.x < width - 80 && s.y > 80 && s.y < height - 80 &&
        !insideCamp(camp, s.x, s.y, 60)
    ),

    decorations: makeDecorations(
      width, height, camp, { x: baseX, y: baseY }, nests, zone, walls,
      customerLane, counter, blockers
    ),
  };
}

export function insideCamp(camp, x, y, margin = 0) {
  return (
    x > camp.x1 - margin && x < camp.x2 + margin &&
    y > camp.y1 - margin && y < camp.y2 + margin
  );
}

// 柵の衝突解決: 移動前後で柵をまたいだら、ゲート開口部以外は押し戻す。
// allowGate=false でゲートも塞ぐ(クマ用。拠点=安全圏に入らせない)
export function resolveCampCollision(camp, prevX, prevY, e, allowGate = true) {
  const inGateSpan = (x) => allowGate && Math.abs(x - camp.gate.x) < camp.gate.halfW;
  const wasInsideX = prevX > camp.x1 && prevX < camp.x2;
  const wasInsideY = prevY > camp.y1 && prevY < camp.y2;

  // 南辺(ゲートあり)
  if (wasInsideX && crossed(prevY, e.y, camp.y2) && !inGateSpan(e.x)) {
    e.y = prevY > camp.y2 ? camp.y2 + 8 : camp.y2 - 8;
  }
  // 北辺
  if (wasInsideX && crossed(prevY, e.y, camp.y1)) {
    e.y = prevY > camp.y1 ? camp.y1 + 8 : camp.y1 - 8;
  }
  // 東西辺
  if (wasInsideY && crossed(prevX, e.x, camp.x1)) {
    e.x = prevX > camp.x1 ? camp.x1 + 8 : camp.x1 - 8;
  }
  if (wasInsideY && crossed(prevX, e.x, camp.x2)) {
    e.x = prevX > camp.x2 ? camp.x2 + 8 : camp.x2 - 8;
  }
}

// 氷壁の衝突解決: broken でない壁の線分をまたいだら押し戻す(開口なし)。
// スパン判定は半径マージン(±20)込みにして、端をかすめるすり抜けを防ぐ。
export function resolveWallsCollision(walls, prevX, prevY, e) {
  for (const wall of walls) {
    if (wall.broken) continue;
    for (const s of wall.segments) {
      if (s.y1 === s.y2) {
        // 水平線分
        const minX = Math.min(s.x1, s.x2);
        const maxX = Math.max(s.x1, s.x2);
        if (prevX > minX - 20 && prevX < maxX + 20 && crossed(prevY, e.y, s.y1)) {
          e.y = prevY > s.y1 ? s.y1 + 8 : s.y1 - 8;
        }
      } else {
        // 垂直線分
        const minY = Math.min(s.y1, s.y2);
        const maxY = Math.max(s.y1, s.y2);
        if (prevY > minY - 20 && prevY < maxY + 20 && crossed(prevX, e.x, s.x1)) {
          e.x = prevX > s.x1 ? s.x1 + 8 : s.x1 - 8;
        }
      }
    }
  }
}

// 透明円ブロッカーの押し出し解決: 中心からの距離が r+14 未満なら半径方向へ押し出す。
export function resolveBlockers(blockers, e) {
  for (const b of blockers) {
    const min = b.r + 14;
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (dx > min || dx < -min || dy > min || dy < -min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 0.001) {
      e.x = b.x + min; // 中心に重なった場合は東へ逃がす
      continue;
    }
    e.x = b.x + (dx / d) * min;
    e.y = b.y + (dy / d) * min;
  }
}

// 矩形ゾーン(中心 x,y と幅 w・高さ h)の内側判定
export function insideZone(zone, x, y) {
  return !!zone && Math.abs(x - zone.x) < zone.w / 2 && Math.abs(y - zone.y) < zone.h / 2;
}

// 矩形ブロッカー(テーブル)の押し出し解決: 半幅+マージン14 の AABB に入ったら貫通の浅い軸へ押す。
export function resolveRectBlockers(rects, e) {
  for (const b of rects) {
    const minX = b.hw + 14;
    const minY = b.hh + 14;
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
    const penX = minX - Math.abs(dx);
    const penY = minY - Math.abs(dy);
    if (penX < penY) {
      e.x = b.x + (dx >= 0 ? minX : -minX);
    } else {
      e.y = b.y + (dy >= 0 ? minY : -minY);
    }
  }
}

function crossed(prev, now, line) {
  return (prev - line) * (now - line) < 0;
}

// 巣ごとに perNest 頭ぶんの湧き位置を巣の周囲に散らす
function nestSpawns(nests) {
  return nests.flatMap((n) =>
    Array.from({ length: n.perNest }, (_, i) => {
      if (n.perNest === 1) return { x: n.x, y: n.y, tier: n.tier, respawn: n.respawn ?? null };
      const a = (i / n.perNest) * Math.PI * 2 + n.x * 0.013;
      return { x: n.x + Math.cos(a) * 42, y: n.y + Math.sin(a) * 42, tier: n.tier, respawn: n.respawn ?? null };
    })
  );
}

// 点と軸平行線分の距離
function distToSegment(x, y, s) {
  if (s.y1 === s.y2) {
    const cx = Math.max(Math.min(s.x1, s.x2), Math.min(Math.max(s.x1, s.x2), x));
    return Math.hypot(x - cx, y - s.y1);
  }
  const cy = Math.max(Math.min(s.y1, s.y2), Math.min(Math.max(s.y1, s.y2), y));
  return Math.hypot(x - s.x1, y - cy);
}

function makeDecorations(width, height, camp, base, nests, zone, walls, lane, counter, blockers) {
  const decos = [];
  // 決定的な疑似乱数で装飾を散らす(リロードしても同じ配置)
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  // 装飾と衝突ブロッカーを同じ場所で同時に積む(座標の二重管理をしない)。
  // clear:true は拡張予定地の開拓対象: 拠点に入ったら game/upgrades がブロッカーを除去し render 側が見た目を消す
  const pushDeco = (deco) => {
    decos.push(deco);
    const r = BLOCKER_RADIUS[deco.kind];
    if (!r) return;
    const b = { x: deco.x, y: deco.y, r: Math.round(r * (deco.scale ?? 1)) };
    if (deco.clear) b.clearable = true;
    blockers.push(b);
  };

  // 凍った湖(ブロッカーなし=氷の上は歩ける)。西2つは到達不能エリアの景観、東2つは解放後エリア
  const lakes = [
    { x: 200, y: 520, scale: 1.0 },
    { x: 230, y: 1280, scale: 0.75 },
    { x: 2250, y: 1560, scale: 1.15 },
    { x: 2620, y: 230, scale: 0.9 },
  ];
  for (const l of lakes) decos.push({ kind: "lake", ...l });
  const offLake = (x, y) => lakes.every((l) => Math.hypot(x - l.x, y - l.y) > 150 * l.scale + 30);

  // 外周の山脈(マップ縁の空白を埋める景観 + 到達域の壁)。木などより先に置き、
  // 後続の装飾は nearMountain で山の中に埋まらないようにする
  const mountains = [];
  const ridge = (x1, y1, x2, y2, n) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x1 + (x2 - x1) * t + (rand() - 0.5) * 80;
      const y = y1 + (y2 - y1) * t + (rand() - 0.5) * 60;
      if (!offLake(x, y)) continue;
      const scale = 0.7 + rand() * 0.6;
      mountains.push({ x, y, r: 150 * scale });
      pushDeco({ kind: "mountain", x, y, scale });
    }
  };
  ridge(120, 80, 3080, 80, 13);      // 北縁
  // 南縁: zone0 の南氷壁(y=1620)へ山がめり込まないよう東エリアにだけ置く
  // (壁の南西側は西の森林帯が埋める)
  ridge(1760, 1720, 3080, 1720, 9);
  ridge(80, 260, 80, 1540, 6);       // 西縁(到達不能帯)
  ridge(3120, 260, 3120, 1540, 6);   // 東縁
  const nearMountain = (x, y) => mountains.some((m) => Math.hypot(x - m.x, y - m.y) < m.r);

  const wallPad = walls.find((w) => w.pad)?.pad;
  const nearWallLine = (x, y) =>
    walls.some((w) => w.segments.some((s) => distToSegment(x, y, s) < 55));
  // 客レーンの矩形(マージン40)とカウンター周辺(半径160)には装飾を置かない
  const inLane = (x, y) =>
    x > zone.x1 - 40 && x < camp.x1 + 40 && y > lane.y - 170 && y < lane.y + 170;
  const blocked = (x, y) =>
    insideCamp(camp, x, y, 120) ||
    nearWallLine(x, y) ||
    inLane(x, y) ||
    !offLake(x, y) ||
    nearMountain(x, y) ||
    Math.hypot(x - counter.x, y - counter.y) < 160 ||
    (wallPad && Math.hypot(x - wallPad.x, y - wallPad.y) < 75) ||
    nests.some((n) => Math.hypot(x - n.x, y - n.y) < 90);
  const inBounds = (x, y) => x > 60 && x < width - 60 && y > 60 && y < height - 60;

  const kinds = ["rock", "iceshard", "snowpile", "deadtree", "tree", "rock", "snowpile", "iceshard"];

  // 木の群生(まとめて植えて密度感を出す)
  for (let i = 0; i < 40; i++) {
    const cx = 110 + rand() * (width - 220);
    const cy = 110 + rand() * (height - 220);
    if (blocked(cx, cy)) continue;
    for (let j = 0; j < 5; j++) {
      const x = cx + (rand() - 0.5) * 160;
      const y = cy + (rand() - 0.5) * 160;
      if (!inBounds(x, y) || blocked(x, y)) continue;
      pushDeco({ kind: "tree", x, y, scale: 0.7 + rand() * 0.6 });
    }
  }

  // 単体の装飾をワールド全体に散らす
  for (let i = 0; i < 280; i++) {
    const x = 60 + rand() * (width - 120);
    const y = 60 + rand() * (height - 120);
    const kind = kinds[Math.floor(rand() * kinds.length)];
    if (blocked(x, y)) continue;
    pushDeco({ kind, x, y, scale: 0.7 + rand() * 0.6 });
  }

  // zone0 の壁の外側すぐは少し密に(解放後の景色)。壁沿いには密植しない
  for (let i = 0; i < 44; i++) {
    const side = Math.floor(rand() * 4);
    const t = rand();
    const off = 110 + rand() * 190;
    const x = side < 2 ? zone.x1 + t * (zone.x2 - zone.x1) : side === 2 ? zone.x1 - off : zone.x2 + off;
    const y = side >= 2 ? zone.y1 + t * (zone.y2 - zone.y1) : side === 0 ? zone.y1 - off : zone.y2 + off;
    if (!inBounds(x, y) || blocked(x, y)) continue;
    pushDeco({ kind: kinds[Math.floor(rand() * kinds.length)], x, y, scale: 0.7 + rand() * 0.6 });
  }

  // 外周の森林帯(可動域の外と解放後エリアの縁を森で埋める)
  const bands = [
    { x1: 60, y1: 60, x2: 350, y2: 1740, n: 120 },    // 西の到達不能帯
    { x1: 372, y1: 60, x2: 1692, y2: 330, n: 70 },    // zone0 北壁の外
    { x1: 372, y1: 1660, x2: 1692, y2: 1760, n: 60 }, // zone0 南壁(y=1620)の外
    { x1: 1692, y1: 60, x2: 3140, y2: 320, n: 80 },   // 東エリア北縁
    { x1: 1692, y1: 1480, x2: 3140, y2: 1740, n: 80 },// 東エリア南縁
    { x1: 2960, y1: 320, x2: 3140, y2: 1480, n: 50 }, // 最東端
  ];
  for (const b of bands) {
    for (let i = 0; i < b.n; i++) {
      const x = b.x1 + rand() * (b.x2 - b.x1);
      const y = b.y1 + rand() * (b.y2 - b.y1);
      if (!inBounds(x, y) || blocked(x, y)) continue;
      const kind = rand() < 0.78 ? "tree" : rand() < 0.5 ? "deadtree" : "rock";
      pushDeco({ kind, x, y, scale: 0.75 + rand() * 0.7 });
    }
  }

  // 拡張予定地の開拓対象(拠点が広がると伐採されて消える)。ゲート前の通路(x 992±90)と
  // パッド(boots/hunter)は避けて手置きする
  const clearDecos = [
    // stage1 南拡張(y 1040-1140)
    { kind: "tree", x: 742, y: 1102, scale: 0.85 },
    { kind: "tree", x: 866, y: 1088, scale: 1.0 },
    { kind: "snowpile", x: 1126, y: 1100, scale: 0.9 },
    { kind: "tree", x: 1196, y: 1092, scale: 0.8 },
    { kind: "tree", x: 1272, y: 1078, scale: 1.05 },
    // stage2 東拡張(x 1312-1422)
    { kind: "tree", x: 1368, y: 724, scale: 0.95 },
    { kind: "rock", x: 1360, y: 866, scale: 0.85 },
    { kind: "tree", x: 1382, y: 978, scale: 0.8 },
    // stage3 南拡張(y 1140-1240)
    { kind: "tree", x: 758, y: 1196, scale: 1.0 },
    { kind: "tree", x: 870, y: 1208, scale: 0.85 },
    { kind: "rock", x: 1126, y: 1198, scale: 0.9 },
    { kind: "tree", x: 1232, y: 1186, scale: 0.95 },
    { kind: "tree", x: 1388, y: 1212, scale: 0.8 },
  ];
  for (const d of clearDecos) pushDeco({ ...d, clear: true });

  // クマの巣の近くに骨を散らす(bones はブロッカーなし)
  for (const n of nests) {
    const count = 1 + (Math.abs(Math.floor(n.x + n.y)) % 2);
    for (let i = 0; i < count; i++) {
      const x = n.x + (i === 0 ? 60 : -55);
      const y = n.y + (i === 0 ? -50 : 42);
      if (!inBounds(x, y) || nearWallLine(x, y)) continue;
      decos.push({ kind: "bones", x, y, scale: 0.9 + i * 0.25 });
    }
  }

  // 客レーンの出入口の門柱(氷のかけら2つで「門」を示唆)
  pushDeco({ kind: "iceshard", x: lane.doorX, y: base.y - 100, scale: 1.15 });
  pushDeco({ kind: "iceshard", x: lane.doorX, y: base.y + 100, scale: 1.15 });

  // 拠点周りのプロップ(tent/path は rot で向きを指定: rot=0 が南向き/縦長)。
  // テントは北柵(y=660)の外(ブロッカー r45+14 が柵内に届かない: 585+59=644 / 598+59=657 < 660)、
  // 薪は stage2 東柵(x=1422)の外(1490-35-14=1441 > 1422)、壁パッドへの動線脇。
  // campfire のみ拠点内 (940,860): 最寄りの grill パッド(890,1040)とも y 距離180 で重ならない
  pushDeco({ kind: "campfire", x: base.x - 52, y: base.y - 40, scale: 1 });
  pushDeco({ kind: "tent", x: base.x - 52, y: base.y - 315, scale: 1, rot: 0.2 });
  pushDeco({ kind: "tent", x: base.x + 18, y: base.y - 302, scale: 1, rot: -0.15 });
  pushDeco({ kind: "logpile", x: base.x + 498, y: base.y + 60, scale: 1, rot: 0.3 });
  // ゲートから拠点中心へ続く道と、ゲートの南へ続く獣道(path はブロッカーなし)。
  // 南側の2枚は stage3 まで拡張すると拠点内の道になる
  decos.push({ kind: "path", x: base.x, y: base.y + 40, scale: 1, rot: 0 });
  decos.push({ kind: "path", x: base.x, y: base.y + 110, scale: 1, rot: 0 });
  decos.push({ kind: "path", x: base.x, y: base.y + 180, scale: 1, rot: 0 });
  decos.push({ kind: "path", x: base.x, y: base.y + 250, scale: 1, rot: 0 });
  decos.push({ kind: "path", x: base.x, y: base.y + 320, scale: 1, rot: 0 });

  return decos;
}
