// エンティティの生成と更新ロジック。
// 描画は render/、状態の置き換えは main.js のゲームループで行う。
import { CONFIG } from "./config.js";
import { routeViaGate } from "./world.js";

let nextId = 1;

export function createPlayer(x, y) {
  return {
    id: nextId++,
    type: "player",
    x, y,
    facing: 1,     // 1=右向き, -1=左向き
    moving: false,
    bobPhase: 0,   // 走りのバウンス位相
    lean: 0,       // 背中スタックの傾き(移動方向と逆にしなる)
    attackTimer: 0,
    swing: 0,      // 攻撃モーション残り時間
    lungeX: 0,     // 攻撃ランジの減衰インパルス(updateCombat がセット、ここで消費)
    lungeY: 0,
    hp: CONFIG.player.maxHp,
    maxHp: CONFIG.player.maxHp,
    hurtCd: 0,     // 被弾後の無敵時間の残り秒
    stack: [],     // 背中に積んだアイテム [{kind,value}]
  };
}

export function createBear(x, y, tier) {
  const t = CONFIG.bear.tiers[tier];
  return {
    id: nextId++,
    type: "bear",
    tier,
    x, y,
    homeX: x, homeY: y,
    facing: 1,
    bobPhase: 0,
    moving: false,
    kx: 0, ky: 0, // ノックバック速度
    hp: t.hp,
    maxHp: t.hp,
    state: "idle", // idle | wander | chase | dead
    wanderX: x, wanderY: y,
    wanderTimer: 0,
    attackTimer: 0,
    windup: 0,    // 攻撃前の溜め残り時間(render 側が溜めアニメに使う)
    hitFlash: 0,
    squash: 0, // 被弾時のつぶれ演出
  };
}

// 地面アイテム(被弾ドロップ): 放物線で散り、magnet 回収で背中スタックへ戻る
export function createGroundItem(x, y, kind, value) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 30 + Math.random() * 60;
  return {
    id: nextId++,
    type: "meat",
    kind,
    x, y,
    z: 24,                              // 高さ(疑似3D)
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    vz: 160 + Math.random() * 120,      // 上向き初速
    spin: (Math.random() - 0.5) * 10,
    rot: 0,
    value,
    magnet: false,                      // プレイヤーに吸い寄せ中
    collected: false,
  };
}

// 客NPC: 西の客レーンの出入口(doorX)から来て、カウンター前の spot で待つ
export function createCustomer(world, customers) {
  const lane = world.customerLane;
  const spots = lane?.spots ?? [];
  const used = new Set(customers.map((c) => c.spot));
  let spot = spots.findIndex((_, i) => !used.has(i));
  if (spot < 0) spot = 0;
  return {
    id: nextId++,
    type: "customer",
    x: lane?.doorX ?? 0,
    y: lane?.y ?? 0,
    facing: 1,
    moving: false,
    bobPhase: 0,
    carrying: false,  // 肉を持って帰り中(売却着弾でのみ true)
    state: "arrive",  // arrive | wait | leave | gone
    timer: 0,
    spot,             // customerLane.spots の index
  };
}

export function createHunter(x, y) {
  return {
    id: nextId++,
    type: "hunter",
    x, y,
    facing: 1,
    moving: false,
    bobPhase: 0,
    state: "hunt", // hunt | deliver | rest
    attackTimer: 0,
    swing: 0,
    hp: CONFIG.hunter.maxHp,
    maxHp: CONFIG.hunter.maxHp,
    zzzT: 0,       // 休憩中の💤演出タイマー
    stack: [],     // 背中に積んだアイテム [{kind,value}](raw のみ)
  };
}

// ---- 更新 ----

export function updatePlayer(player, move, dt, stats, world) {
  const speed = stats.speed;
  player.moving = move.x !== 0 || move.y !== 0;
  if (player.moving) {
    player.x += move.x * speed * dt;
    player.y += move.y * speed * dt;
    if (Math.abs(move.x) > 0.1) player.facing = move.x > 0 ? 1 : -1;
    player.bobPhase += dt * speed * 0.09;
    // 移動方向と逆にスタックがしなる
    player.lean += (move.x * -14 - player.lean) * Math.min(1, dt * 8);
  } else {
    player.lean += (0 - player.lean) * Math.min(1, dt * 8);
  }
  // 攻撃ランジ(減衰インパルス)。直接座標を動かさず、ここで消費して柵の衝突解決に乗せる
  if (Math.abs(player.lungeX) > 1 || Math.abs(player.lungeY) > 1) {
    player.x += player.lungeX * dt;
    player.y += player.lungeY * dt;
    player.lungeX *= Math.pow(0.001, dt);
    player.lungeY *= Math.pow(0.001, dt);
  }
  player.x = clamp(player.x, 30, world.width - 30);
  player.y = clamp(player.y, 30, world.height - 30);
  player.attackTimer = Math.max(0, player.attackTimer - dt);
  player.swing = Math.max(0, player.swing - dt);
}

// target はプレイヤーまたはハンター(呼び出し側が最寄りを選ぶ)。夜間は索敵と足が強化される
export function updateBear(bear, target, dt, world, isNight) {
  const cfg = CONFIG.bear;
  const aggroRange = cfg.aggroRange * (isNight ? cfg.night.aggroMult : 1);
  const speed = cfg.speed * (isNight ? cfg.night.speedMult : 1);
  bear.hitFlash = Math.max(0, bear.hitFlash - dt);
  bear.squash = Math.max(0, bear.squash - dt * 4);
  bear.attackTimer = Math.max(0, bear.attackTimer - dt);
  bear.moving = false;

  // ノックバック(減衰)
  if (Math.abs(bear.kx) > 1 || Math.abs(bear.ky) > 1) {
    bear.x += bear.kx * dt;
    bear.y += bear.ky * dt;
    bear.kx *= Math.pow(0.001, dt);
    bear.ky *= Math.pow(0.001, dt);
  }

  // 溜め→一撃: 溜め中は chase/wander の移動も状態遷移も一切行わない
  if (bear.windup > 0) {
    bear.windup -= dt;
    if (bear.windup > 0) return null;
    bear.windup = 0;
    // 溜め切った瞬間: 射程の1.5倍以内なら一撃、逃げ切られていたら不発
    const dist = Math.hypot(target.x - bear.x, target.y - bear.y);
    if (dist <= cfg.attackRange * 1.5) {
      return { type: "bearAttack", damage: CONFIG.bear.tiers[bear.tier].damage, tier: bear.tier, target };
    }
    return null;
  }

  if (bear.state === "dead") return null;

  const distToTarget = Math.hypot(target.x - bear.x, target.y - bear.y);

  if (distToTarget < aggroRange) {
    bear.state = "chase";
  } else if (bear.state === "chase" && distToTarget > aggroRange * 1.8) {
    bear.state = "idle";
  }

  if (bear.state === "chase") {
    if (distToTarget > cfg.attackRange) {
      // 柵をまたぐ場合はゲート経由で追いかける
      const goal = routeViaGate(world.camp, bear.x, bear.y, target.x, target.y);
      const d = Math.hypot(goal.x - bear.x, goal.y - bear.y) || 1;
      const nx = (goal.x - bear.x) / d;
      bear.x += nx * speed * dt;
      bear.y += ((goal.y - bear.y) / d) * speed * dt;
      bear.facing = nx > 0 ? 1 : -1;
      bear.moving = true;
      bear.bobPhase += dt * speed * 0.09;
    } else if (bear.attackTimer <= 0) {
      // 攻撃範囲内: 溜めを開始(一撃は windup 消化後の独立ブロックで発火)
      bear.attackTimer = cfg.attackInterval;
      bear.windup = cfg.windup;
    }
  } else {
    // うろうろ
    bear.wanderTimer -= dt;
    if (bear.wanderTimer <= 0) {
      bear.wanderTimer = 2 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 100;
      bear.wanderX = bear.homeX + Math.cos(a) * r;
      bear.wanderY = bear.homeY + Math.sin(a) * r;
    }
    const d = Math.hypot(bear.wanderX - bear.x, bear.wanderY - bear.y);
    if (d > 6) {
      const nx = (bear.wanderX - bear.x) / d;
      bear.x += nx * cfg.speed * 0.4 * dt;
      bear.y += ((bear.wanderY - bear.y) / d) * cfg.speed * 0.4 * dt;
      bear.facing = nx > 0 ? 1 : -1;
      bear.moving = true;
      bear.bobPhase += dt * cfg.speed * 0.04;
    }
  }
  return null;
}

// 地面アイテム: 放物線で飛び散り、地面でバウンドして落ち着く。magnet 中はプレイヤーへ吸引。
export function updateGroundItem(item, player, dt) {
  if (item.magnet) {
    const d = Math.hypot(player.x - item.x, player.y - item.y);
    if (d < 16) {
      item.collected = true;
      return;
    }
    const pull = 14;
    item.x += ((player.x - item.x) / d) * pull * d * dt;
    item.y += ((player.y - item.y) / d) * pull * d * dt;
    // 背中の高さへ弧を描いて飛び込む
    item.z += (45 - item.z) * Math.min(1, dt * 10);
    return;
  }
  if (item.z > 0 || Math.abs(item.vz) > 1) {
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.z += item.vz * dt;
    item.vz -= 600 * dt;
    item.rot += item.spin * dt;
    if (item.z <= 0) {
      item.z = 0;
      // 閾値は1フレーム分の重力(最大30)を考慮して高めに。低FPSで永久バウンドしないように
      item.vz = Math.abs(item.vz) > 100 ? Math.abs(item.vz) * 0.45 : 0;
      item.vx *= 0.6;
      item.vy *= 0.6;
      item.spin *= 0.5;
    }
  }
}

// 客NPC: 出入口 → カウンター前 spot で待機 → 帰る → しばらくして再来店。
// 移動は moveToward のみ(レーン内に閉じるので柵・壁の衝突解決は使わない)。
export function updateCustomer(customer, world, dt, isNight) {
  const cfg = CONFIG.customer;
  const lane = world.customerLane;
  if (!lane) return;
  const spot = lane.spots?.[customer.spot] ?? { x: lane.doorX, y: lane.y };
  customer.moving = false;

  // 夜は店じまい: 待機中の客は帰り、再来店は朝まで止まる
  if (isNight && (customer.state === "arrive" || customer.state === "wait")) {
    customer.state = "leave";
  }

  if (customer.state === "arrive") {
    const d = Math.hypot(spot.x - customer.x, spot.y - customer.y);
    if (d < 10) {
      customer.state = "wait";
      customer.timer = cfg.waitMin + Math.random() * (cfg.waitMax - cfg.waitMin);
    } else {
      moveToward(customer, spot.x, spot.y, cfg.speed, dt);
    }
  } else if (customer.state === "wait") {
    customer.facing = 1; // カウンター(東)を向いて待つ
    customer.timer -= dt;
    // 時間切れは買えずに帰る(carrying は売却着弾でのみ true になる)
    if (customer.timer <= 0) customer.state = "leave";
  } else if (customer.state === "leave") {
    const d = Math.hypot(lane.doorX - customer.x, lane.y - customer.y);
    if (d < 20) {
      customer.state = "gone";
      customer.timer = cfg.rejoinMin + Math.random() * (cfg.rejoinMax - cfg.rejoinMin);
    } else {
      moveToward(customer, lane.doorX, lane.y, cfg.speed, dt);
    }
  } else {
    // gone: 出入口の外で見えないまま待機して再来店(夜間は朝まで来ない)
    if (!isNight) customer.timer -= dt;
    if (customer.timer <= 0) {
      customer.carrying = false;
      customer.state = "arrive";
      customer.x = lane.doorX;
      customer.y = lane.y;
    }
  }
}

// 一番近い生きているクマを返す
export function findNearestBear(bears, x, y, maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (const bear of bears) {
    if (bear.state === "dead") continue;
    const d = Math.hypot(bear.x - x, bear.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = bear;
    }
  }
  return best;
}

// env = { bears, meats, depositSpot, world, restSpot, wantRest }
// wantRest(夜間 or 納品先が満杯)か HP 低下で焚き火へ向かい、火の近くで回復する
export function updateHunter(hunter, env, dt, events) {
  const cfg = CONFIG.hunter;
  const { bears, meats, depositSpot, world, restSpot, wantRest } = env;
  hunter.attackTimer = Math.max(0, hunter.attackTimer - dt);
  hunter.swing = Math.max(0, hunter.swing - dt);
  hunter.moving = false;

  // 休憩へ: 外的要因(夜/満杯)または体力低下。荷物は持ったまま休む
  if (hunter.state !== "rest" && (wantRest || hunter.hp <= hunter.maxHp * cfg.restBelow)) {
    hunter.state = "rest";
  }

  if (hunter.state === "rest") {
    const d = Math.hypot(restSpot.x - hunter.x, restSpot.y - hunter.y);
    if (d > 30) {
      const goal = routeViaGate(world.camp, hunter.x, hunter.y, restSpot.x, restSpot.y);
      moveToward(hunter, goal.x, goal.y, cfg.speed, dt);
    } else {
      // 焚き火の近くで回復 + 💤
      hunter.hp = Math.min(hunter.maxHp, hunter.hp + CONFIG.campfire.hunterRegen * dt);
      hunter.zzzT -= dt;
      if (hunter.zzzT <= 0) {
        hunter.zzzT = 2.2;
        events.push({ type: "hunterZzz", x: hunter.x, y: hunter.y });
      }
      // 回復しきって休憩理由が消えたら復帰
      if (!wantRest && hunter.hp >= hunter.maxHp) {
        hunter.state = hunter.stack.length >= cfg.capacity ? "deliver" : "hunt";
      }
    }
    return;
  }

  // 持ちきれたらカット台へ納品
  if (hunter.stack.length >= cfg.capacity) hunter.state = "deliver";

  if (hunter.state === "deliver") {
    const d = Math.hypot(depositSpot.x - hunter.x, depositSpot.y - hunter.y);
    if (d < 60) {
      // 1個 = 納品1件分のイベントにして、main.js でカット台投入 + itemFly 化する
      for (const item of hunter.stack) {
        events.push({ type: "hunterDeposit", item, x: hunter.x, y: hunter.y });
      }
      hunter.stack = [];
      hunter.state = "hunt";
    } else {
      // 柵をまたぐ場合はゲート経由で向かう
      const goal = routeViaGate(world.camp, hunter.x, hunter.y, depositSpot.x, depositSpot.y);
      moveToward(hunter, goal.x, goal.y, cfg.speed, dt);
    }
    return;
  }

  // 落ちている生肉が近くにあれば拾いに行く(加工品や札を生肉として再投入させない)
  const nearItem = meats.find(
    (m) => !m.collected && !m.magnet && m.kind === "raw" && Math.hypot(m.x - hunter.x, m.y - hunter.y) < 250
  );
  if (nearItem) {
    const d = Math.hypot(nearItem.x - hunter.x, nearItem.y - hunter.y);
    if (d < 20) {
      nearItem.collected = true;
      hunter.stack = [...hunter.stack, { kind: nearItem.kind, value: nearItem.value }];
    } else {
      const goal = routeViaGate(world.camp, hunter.x, hunter.y, nearItem.x, nearItem.y);
      moveToward(hunter, goal.x, goal.y, cfg.speed, dt);
    }
    return;
  }

  // クマを探して攻撃
  const bear = findNearestBear(bears, hunter.x, hunter.y, Infinity);
  if (!bear) return;
  const d = Math.hypot(bear.x - hunter.x, bear.y - hunter.y);
  if (d > 55) {
    const goal = routeViaGate(world.camp, hunter.x, hunter.y, bear.x, bear.y);
    moveToward(hunter, goal.x, goal.y, cfg.speed, dt);
  } else if (hunter.attackTimer <= 0) {
    hunter.attackTimer = cfg.attackInterval;
    hunter.swing = 0.2;
    events.push({
      type: "hunterHit",
      bearId: bear.id,
      hunterId: hunter.id,
      damage: cfg.damage,
      x: hunter.x,
      y: hunter.y,
    });
  }
}

function moveToward(e, tx, ty, speed, dt) {
  const d = Math.hypot(tx - e.x, ty - e.y);
  if (d < 1) return;
  const nx = (tx - e.x) / d;
  e.x += nx * speed * dt;
  e.y += ((ty - e.y) / d) * speed * dt;
  e.facing = nx > 0 ? 1 : -1;
  e.moving = true;
  e.bobPhase += dt * speed * 0.09;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
