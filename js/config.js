// ゲームバランスと定数。調整はすべてここで行う。

export const CONFIG = {
  world: {
    width: 3200,
    height: 1800,
  },

  player: {
    radius: 18,
    baseSpeed: 255,
    attackRange: 75,
    attackInterval: 0.28, // 秒
    baseDamage: 10,
    lungeImpulse: 260, // 攻撃時にターゲットへ踏み込む初速(updatePlayer 内で減衰消費)
    maxHp: 100,
    hurtCooldown: 0.6,   // 被弾後の無敵時間(多頭に囲まれた即死を防ぐ)
    downHpRatio: 0.6,    // ダウン後の復帰HP割合
    downDrops: 5,        // ダウン時にばらまくアイテム数(上限)
  },

  // 焚き火: 近くで静止すると回復(ハンターの休憩地点も兼ねる)
  campfire: { range: 150, regen: 14, hunterRegen: 10 },

  // 昼夜サイクル(秒)。夜はクマが凶暴化し、ハンターと客は休む
  day: { dayLength: 140, nightLength: 55 },

  bear: {
    radius: 26,
    speed: 105,
    aggroRange: 260,
    attackRange: 50,
    attackInterval: 0.9,
    windup: 0.35, // 攻撃前の溜め時間(秒)。溜め中は移動しない
    night: { aggroMult: 1.5, speedMult: 1.15 }, // 夜間の凶暴化
    // ティアごとの強さ。damage=与ダメ、drops=攻撃で落とさせる数、meat=討伐ドロップ数、respawn=再湧き秒
    tiers: [
      { hp: 30, meatValue: 10, scale: 1.0, damage: 6, drops: 1, meat: 2, respawn: 6 },
      { hp: 90, meatValue: 22, scale: 1.25, damage: 12, drops: 1, meat: 3, respawn: 10 },
      { hp: 240, meatValue: 50, scale: 1.55, damage: 20, drops: 2, meat: 4, respawn: 16 },
      { hp: 700, meatValue: 130, scale: 2.1, boss: true, name: "巨大クマ", damage: 35, drops: 3, meat: 8, respawn: 40 },
    ],
  },

  meat: {
    radius: 10,
    magnetRange: 110, // 地面ドロップ品が自動回収される距離
  },

  // 加工の変換規則と倍率(A/C 共通の唯一の定義)
  process: {
    cutboard: { inKind: "raw", outKind: "slice", mult: 1.8 },
    grill: { inKind: "slice", outKind: "cooked", mult: 1.67 },
    outputCap: 30,
  },

  // ステーション操作(投入/取出)の間隔。距離判定は各設備のゾーン矩形(world)で行う
  station: { depositInterval: 0.1, withdrawInterval: 0.08 },

  // カウンター: 焼き肉(inKind)を預けると sellInterval ごとに自動販売される
  counter: { inKind: "cooked", sellInterval: 0.5 },

  // 金(札束)。札1枚 = billValue $。回収/支払いは札単位のストリーム
  money: { billValue: 20, collectInterval: 0.06, payInterval: 0.12 },

  // ベルトコンベア: 台が unlockLevel 以上になると次工程へ自動搬送(カット台→焼き台→カウンター)
  conveyor: { unlockLevel: 3, interval: 0.7, flyTime: 0.8 },

  // アップグレード定義: cost(レベルごとに係数で上昇)。
  // 収支目安: 焼き肉1個 ≒ 生肉価値×3。tier0 討伐 ≒ $60、tier1 ≒ $200、tier2 ≒ $600
  upgrades: {
    weapon: {
      name: "オノ強化",
      icon: "⚔️",
      baseCost: 60,
      costGrowth: 1.6,
      maxLevel: 10,
      effect: (lv) => 10 + lv * 8, // ダメージ
    },
    cutboard: {
      name: "スライス台",
      icon: "🔪",
      baseCost: 100,
      costGrowth: 1.7,
      maxLevel: 5,
      effect: (lv) => Math.max(0.3, 0.95 - 0.16 * (lv - 1)), // 加工間隔秒
    },
    grill: {
      name: "焼き台",
      icon: "🔥",
      baseCost: 140,
      costGrowth: 1.7,
      maxLevel: 5,
      effect: (lv) => Math.max(0.3, 0.95 - 0.16 * (lv - 1)), // 加工間隔秒
    },
    boots: {
      name: "ブーツ強化",
      icon: "👢",
      baseCost: 70,
      costGrowth: 1.6,
      maxLevel: 8,
      effect: (lv) => 255 + lv * 16, // 移動速度
      carry: (lv) => 14 + lv * 3,    // 背中に積める非マネーアイテム数
    },
    hunter: {
      name: "ハンター雇用",
      icon: "🏠",
      baseCost: 350,
      costGrowth: 2.4,
      maxLevel: 3,
      effect: (lv) => lv, // 雇用人数
    },
  },

  hunter: {
    radius: 16,
    speed: 130,
    damage: 8,
    attackInterval: 0.7,
    capacity: 6,
    maxHp: 60,
    restBelow: 0.35, // HPがこの割合を切ると焚き火で休憩
  },

  customer: {
    speed: 95,       // 客NPCの歩行速度
    waitMin: 2.5,    // カウンター前での待機時間(秒)
    waitMax: 5.5,
    rejoinMin: 3,    // 退店後に再来店するまでの時間(秒)
    rejoinMax: 7,
  },

  saveKey: "arctic-survivor-save-v2",
};
