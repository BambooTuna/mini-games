// エンティティの生成と更新ロジック。
// 描画は render/、状態の置き換えは main.js のゲームループで行う。
import { CONFIG } from "./config.js";

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

export function createBear(x, y, tier, respawn = null) {
  const t = CONFIG.bear.tiers[tier];
  return {
    id: nextId++,
    type: "bear",
    tier,
    respawn, // 討伐後の再湧き秒(null は再湧きなし=倒したら終わり)
    x, y,
    homeX: x, homeY: y,
    facing: 1,
    bobPhase: 0,
    moving: false,
    kx: 0, ky: 0, // ノックバック速度
    hp: t.hp,
    maxHp: t.hp,
    state: "idle", // idle | alert | chase | dead
    wanderX: x, wanderY: y,
    wanderTimer: 0,
    attackTimer: 0,
    windup: 0,    // 攻撃前の溜め残り時間(render 側が溜めアニメに使う)
    attackKind: "swipe", // 溜め後に出す攻撃: swipe | charge | slam
    alertT: 0,     // 気づき動作の残り時間
    aimX: 0, aimY: 1, // 突進の狙い方向(溜め中に更新し、発動時に固定)
    charge: null,  // 突進中 {dx,dy,t}
    chargeCd: 0,
    slamCd: 0,
    recoverT: 0,   // 突進を外した後などの隙
    strafeDir: Math.random() < 0.5 ? 1 : -1, // 回り込みの旋回方向
    strafeT: 0,
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

// 客NPC: 西の集落の家から客レーンの出入口(doorX)を通って、カウンター前の spot で待つ
export function createCustomer(world, customers) {
  const lane = world.customerLane;
  const spots = lane?.spots ?? [];
  const used = new Set(customers.map((c) => c.spot));
  let spot = spots.findIndex((_, i) => !used.has(i));
  if (spot < 0) spot = 0;
  const houses = world.village?.houses ?? [];
  const home = houses.length
    ? houses[spot % houses.length].front
    : { x: (lane?.doorX ?? 0) - 40, y: lane?.y ?? 0 };
  return {
    id: nextId++,
    type: "customer",
    x: home.x,
    y: home.y,
    home,             // 家の戸口前(スポーン/帰宅点)
    wp: 0,            // 経路(家→通り→出入口→spot)の現在区間
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
    kx: 0, ky: 0, // 被弾ノックバック速度(combat がセット、updateHunter で減衰消費)
    hp: CONFIG.hunter.maxHp,
    maxHp: CONFIG.hunter.maxHp,
    zzzT: 0,       // 休憩中の💤演出タイマー
    stack: [],     // 背中に積んだアイテム [{kind,value}](raw のみ)
    targetId: null, // 狙っているクマの id(全員が最寄りに集中しないよう保持する)
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

// target はプレイヤーまたはハンター(呼び出し側が最寄りを選ぶ)。拠点内は安全圏なので
// 呼び出し側が null を渡し、その間クマは徘徊に戻る。夜間は索敵と足が強化される。
// 状態機械: idle(徘徊) → alert(気づき❗) → chase。chase 中は距離と
// クールダウンに応じて swipe(溜め→一撃)/charge(突進)/slam(ボスの範囲攻撃)を使い分け、
// 攻撃クールダウン中はターゲットの周りを回り込む。
export function updateBear(bear, target, dt, world, isNight, nav) {
  const cfg = CONFIG.bear;
  const tierCfg = cfg.tiers[bear.tier];
  const aggroRange = cfg.aggroRange * (isNight ? cfg.night.aggroMult : 1);
  const speed = cfg.speed * (isNight ? cfg.night.speedMult : 1);
  bear.hitFlash = Math.max(0, bear.hitFlash - dt);
  bear.squash = Math.max(0, bear.squash - dt * 4);
  bear.attackTimer = Math.max(0, bear.attackTimer - dt);
  bear.chargeCd = Math.max(0, bear.chargeCd - dt);
  bear.slamCd = Math.max(0, bear.slamCd - dt);
  bear.moving = false;

  // ノックバック(減衰)
  if (Math.abs(bear.kx) > 1 || Math.abs(bear.ky) > 1) {
    bear.x += bear.kx * dt;
    bear.y += bear.ky * dt;
    bear.kx *= Math.pow(0.001, dt);
    bear.ky *= Math.pow(0.001, dt);
  }

  if (bear.state === "dead") return null;

  // 突進を外した後の隙(無防備に立ち止まる)
  if (bear.recoverT > 0) {
    bear.recoverT -= dt;
    return null;
  }

  // 突進中: 溜めで固定した方向へ直進。接触で一撃、外したら隙を晒す
  if (bear.charge) {
    const c = bear.charge;
    c.t -= dt;
    const sp = speed * cfg.charge.speedMult;
    bear.x += c.dx * sp * dt;
    bear.y += c.dy * sp * dt;
    bear.facing = c.dx > 0 ? 1 : -1;
    bear.moving = true;
    bear.bobPhase += dt * sp * 0.09;
    if (target && Math.hypot(target.x - bear.x, target.y - bear.y) < cfg.attackRange) {
      bear.charge = null;
      bear.recoverT = cfg.charge.hitRecover;
      return {
        type: "bearAttack",
        damage: Math.round(tierCfg.damage * cfg.charge.damageMult),
        tier: bear.tier,
        target,
      };
    }
    if (c.t <= 0) {
      bear.charge = null;
      bear.recoverT = cfg.charge.stun;
    }
    return null;
  }

  // 溜め(windup): 溜め中は移動しない。溜め切ったら attackKind の攻撃を出す
  if (bear.windup > 0) {
    bear.windup -= dt;
    if (target) {
      // 突進・一撃とも溜め中はターゲットへ狙いを更新し続ける(発動時に固定)
      const d = Math.hypot(target.x - bear.x, target.y - bear.y) || 1;
      bear.aimX = (target.x - bear.x) / d;
      bear.aimY = (target.y - bear.y) / d;
      bear.facing = target.x > bear.x ? 1 : -1;
    }
    if (bear.windup > 0) return null;
    bear.windup = 0;
    if (bear.attackKind === "charge") {
      bear.charge = { dx: bear.aimX, dy: bear.aimY, t: cfg.charge.duration };
      return null;
    }
    if (bear.attackKind === "slam") {
      return {
        type: "bearSlam",
        x: bear.x, y: bear.y,
        radius: cfg.slam.radius,
        damage: Math.round(tierCfg.damage * cfg.slam.damageMult),
        tier: bear.tier,
      };
    }
    // swipe: 射程の1.5倍以内なら一撃、逃げ切られていた(拠点に入った)ら不発
    if (!target) return null;
    const dist = Math.hypot(target.x - bear.x, target.y - bear.y);
    if (dist <= cfg.attackRange * 1.5) {
      return { type: "bearAttack", damage: tierCfg.damage, tier: bear.tier, target };
    }
    return null;
  }

  // target なし(全員が拠点内/休憩中)は distance=∞ 扱いで chase が解けて徘徊に戻る
  const distToTarget = target ? Math.hypot(target.x - bear.x, target.y - bear.y) : Infinity;

  // 索敵: いきなり襲わず、気づき動作(❗)を挟む。呼び出し側が群れに伝播させる
  if (distToTarget < aggroRange && bear.state !== "chase" && bear.state !== "alert") {
    bear.state = "alert";
    bear.alertT = cfg.alert.time;
    bear.facing = target.x > bear.x ? 1 : -1;
    return { type: "bearAlert" };
  }
  if ((bear.state === "chase" || bear.state === "alert") && distToTarget > aggroRange * 1.8) {
    bear.state = "idle";
  }

  if (bear.state === "alert") {
    bear.alertT -= dt;
    if (target) bear.facing = target.x > bear.x ? 1 : -1;
    if (bear.alertT <= 0) bear.state = "chase";
    return null;
  }

  if (bear.state === "chase" && target) {
    // ボスの叩きつけ: 近距離で範囲攻撃
    if (tierCfg.boss && bear.slamCd <= 0 && distToTarget < cfg.slam.range) {
      bear.slamCd = cfg.slam.cooldown;
      bear.windup = cfg.slam.windup;
      bear.attackKind = "slam";
      return null;
    }
    // 中距離からの突進(tier1以上)
    if (
      bear.tier >= cfg.charge.minTier && bear.chargeCd <= 0 &&
      distToTarget > cfg.charge.minDist && distToTarget < cfg.charge.maxDist
    ) {
      bear.chargeCd = cfg.charge.cooldown;
      bear.windup = cfg.charge.windup;
      bear.attackKind = "charge";
      return null;
    }
    // 攻撃範囲内でクールダウンが明けたら一撃の溜めへ
    if (distToTarget <= cfg.attackRange && bear.attackTimer <= 0) {
      bear.attackTimer = cfg.attackInterval;
      bear.windup = cfg.windup;
      bear.attackKind = "swipe";
      return null;
    }
    // クールダウン中は正面に突っ立たず、間合いを保って回り込む
    if (distToTarget <= cfg.attackRange * 2.5 && bear.attackTimer > 0.15) {
      bear.strafeT -= dt;
      if (bear.strafeT <= 0) {
        bear.strafeT = 1.5 + Math.random() * 2;
        if (Math.random() < 0.35) bear.strafeDir *= -1;
      }
      const ringD = cfg.attackRange * 1.4;
      const ang = Math.atan2(bear.y - target.y, bear.x - target.x) + bear.strafeDir;
      const gx = target.x + Math.cos(ang) * ringD;
      const gy = target.y + Math.sin(ang) * ringD;
      const d = Math.hypot(gx - bear.x, gy - bear.y) || 1;
      bear.x += ((gx - bear.x) / d) * speed * cfg.strafe.speedMult * dt;
      bear.y += ((gy - bear.y) / d) * speed * cfg.strafe.speedMult * dt;
      bear.facing = target.x > bear.x ? 1 : -1;
      bear.moving = true;
      bear.bobPhase += dt * speed * 0.07;
      return null;
    }
    // 追跡: 柵・氷壁・木を迂回して近づく(拠点へは入れないグリッドを使う)
    const goal = nav.next(bear, target.x, target.y, dt, "bear");
    const d = Math.hypot(goal.x - bear.x, goal.y - bear.y) || 1;
    const nx = (goal.x - bear.x) / d;
    bear.x += nx * speed * dt;
    bear.y += ((goal.y - bear.y) / d) * speed * dt;
    bear.facing = nx > 0 ? 1 : -1;
    bear.moving = true;
    bear.bobPhase += dt * speed * 0.09;
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

// 客NPC: 家 → 集落の通り → 出入口 → カウンター前 spot で待機 → 来た道を帰る → 再来店。
// 移動は moveToward のみ(集落とレーン内に閉じるので柵・壁の衝突解決は使わない)。
export function updateCustomer(customer, world, dt, isNight) {
  const cfg = CONFIG.customer;
  const lane = world.customerLane;
  if (!lane) return;
  const spot = lane.spots?.[customer.spot] ?? { x: lane.doorX, y: lane.y };
  const home = customer.home;
  // 往路の経由点(復路は逆順)。家の前→通り(y=lane.y)→レーン出入口→カウンター前
  const route = [{ x: home.x, y: lane.y }, { x: lane.doorX, y: lane.y }, spot];
  customer.moving = false;

  // 夜は店じまい: 待機中の客は帰り、再来店は朝まで止まる
  if (isNight && (customer.state === "arrive" || customer.state === "wait")) {
    customer.state = "leave";
    // まだレーンに入っていなければ出入口へ戻らず通りから直帰する
    customer.wp = customer.x < lane.doorX - 20 ? 1 : 0;
  }

  if (customer.state === "arrive") {
    const target = route[customer.wp];
    if (Math.hypot(target.x - customer.x, target.y - customer.y) < 10) {
      customer.wp += 1;
      if (customer.wp >= route.length) {
        customer.state = "wait";
        customer.timer = cfg.waitMin + Math.random() * (cfg.waitMax - cfg.waitMin);
      }
    } else {
      moveToward(customer, target.x, target.y, cfg.speed, dt);
    }
  } else if (customer.state === "wait") {
    customer.facing = 1; // カウンター(東)を向いて待つ
    customer.timer -= dt;
    // 時間切れは買えずに帰る(carrying は売却着弾でのみ true になる)
    if (customer.timer <= 0) {
      customer.state = "leave";
      customer.wp = 0;
    }
  } else if (customer.state === "leave") {
    const back = [{ x: lane.doorX, y: lane.y }, { x: home.x, y: lane.y }, home];
    const target = back[Math.min(customer.wp, back.length - 1)];
    if (Math.hypot(target.x - customer.x, target.y - customer.y) < 14) {
      customer.wp += 1;
      if (customer.wp >= back.length) {
        customer.state = "gone";
        customer.timer = cfg.rejoinMin + Math.random() * (cfg.rejoinMax - cfg.rejoinMin);
      }
    } else {
      moveToward(customer, target.x, target.y, cfg.speed, dt);
    }
  } else {
    // gone: 家の中(非表示)で待機して再来店(夜間は朝まで来ない)
    if (!isNight) customer.timer -= dt;
    if (customer.timer <= 0) {
      customer.carrying = false;
      customer.state = "arrive";
      customer.wp = 0;
      customer.x = home.x;
      customer.y = home.y;
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

// env = { bears, meats, depositSpot, world, restSpot, wantRest, nav, stats }
// stats = 主人公スペック比の {damage, speed, capacity}(npcs 側が毎フレーム導出)
// wantRest(夜間 or 納品先が満杯)か HP 低下で焚き火へ向かい、火の近くで回復する。
// 移動はすべて nav 経由(柵はゲートから、木やイグルーは迂回して向かう)
export function updateHunter(hunter, env, dt, events) {
  const cfg = CONFIG.hunter;
  const { bears, meats, depositSpot, world, restSpot, wantRest, nav, stats } = env;
  hunter.attackTimer = Math.max(0, hunter.attackTimer - dt);
  hunter.swing = Math.max(0, hunter.swing - dt);
  hunter.moving = false;
  // 被弾ノックバックの減衰消費(クマと同じ流儀。座標を直接飛ばすとワープして見える)
  if (Math.abs(hunter.kx) > 1 || Math.abs(hunter.ky) > 1) {
    hunter.x += hunter.kx * dt;
    hunter.y += hunter.ky * dt;
    hunter.kx *= Math.pow(0.001, dt);
    hunter.ky *= Math.pow(0.001, dt);
  }

  // 休憩へ: 外的要因(夜/満杯)または体力低下。荷物は持ったまま休む
  if (hunter.state !== "rest" && (wantRest || hunter.hp <= hunter.maxHp * cfg.restBelow)) {
    hunter.state = "rest";
  }

  if (hunter.state === "rest") {
    const d = Math.hypot(restSpot.x - hunter.x, restSpot.y - hunter.y);
    if (d > 30) {
      const goal = nav.next(hunter, restSpot.x, restSpot.y, dt, "hunter");
      moveToward(hunter, goal.x, goal.y, stats.speed, dt);
    } else {
      // 休憩に入ったら背負っている肉は先に下ろす(満タン未満でも納品。回復後は手ぶらで狩りへ)
      if (hunter.stack.length > 0) {
        for (const item of hunter.stack) {
          events.push({ type: "hunterDeposit", item, x: hunter.x, y: hunter.y });
        }
        hunter.stack = [];
      }
      // 焚き火の近くで回復 + 💤
      hunter.hp = Math.min(hunter.maxHp, hunter.hp + CONFIG.campfire.hunterRegen * dt);
      hunter.zzzT -= dt;
      if (hunter.zzzT <= 0) {
        hunter.zzzT = 2.2;
        events.push({ type: "hunterZzz", x: hunter.x, y: hunter.y });
      }
      // 回復しきって休憩理由が消えたら復帰
      if (!wantRest && hunter.hp >= hunter.maxHp) {
        hunter.state = "hunt";
      }
    }
    return;
  }

  // 持ちきれたらカット台へ納品
  if (hunter.stack.length >= stats.capacity) hunter.state = "deliver";

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
      const goal = nav.next(hunter, depositSpot.x, depositSpot.y, dt, "hunter");
      moveToward(hunter, goal.x, goal.y, stats.speed, dt);
    }
    return;
  }

  // 落ちている生肉が近くにあれば拾いに行く(加工品や札を生肉として再投入させない)。
  // 木などの押し出し円の奥に落ちた肉は届かないので対象外にする(永久に往復しない)
  const nearItem = meats.find(
    (m) =>
      !m.collected && !m.magnet && m.kind === "raw" &&
      Math.hypot(m.x - hunter.x, m.y - hunter.y) < 250 &&
      !world.blockers.some((b) => Math.hypot(m.x - b.x, m.y - b.y) < b.r - 6)
  );
  if (nearItem) {
    const d = Math.hypot(nearItem.x - hunter.x, nearItem.y - hunter.y);
    if (d < 20) {
      nearItem.collected = true;
      hunter.stack = [...hunter.stack, { kind: nearItem.kind, value: nearItem.value }];
    } else {
      const goal = nav.next(hunter, nearItem.x, nearItem.y, dt, "hunter");
      moveToward(hunter, goal.x, goal.y, stats.speed, dt);
    }
    return;
  }

  // クマを探して攻撃。全員が最寄りの1頭に集中しないよう、ターゲットを保持し、
  // 選び直すときは近い数頭からランダムに選ぶ(リーシュを超えたら解除して再選択)
  let bear = hunter.targetId != null ? bears.find((b) => b.id === hunter.targetId) : null;
  if (bear && Math.hypot(bear.x - hunter.x, bear.y - hunter.y) > cfg.targetLeash) bear = null;
  if (!bear) {
    const near = bears
      .map((b) => ({ b, d: Math.hypot(b.x - hunter.x, b.y - hunter.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, cfg.targetChoices);
    if (near.length === 0) {
      hunter.targetId = null;
      return;
    }
    bear = near[Math.floor(Math.random() * near.length)].b;
    hunter.targetId = bear.id;
  }
  const d = Math.hypot(bear.x - hunter.x, bear.y - hunter.y);
  if (d > 55) {
    const goal = nav.next(hunter, bear.x, bear.y, dt, "hunter");
    moveToward(hunter, goal.x, goal.y, stats.speed, dt);
  } else if (hunter.attackTimer <= 0) {
    hunter.attackTimer = cfg.attackInterval;
    hunter.swing = 0.2;
    events.push({
      type: "hunterHit",
      bearId: bear.id,
      hunterId: hunter.id,
      damage: stats.damage,
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
