// 戦闘とフィールドアイテム: プレイヤー攻撃、クマの更新/被弾/討伐、リスポーン、
// 背中へのホーミング(carryFlights)、地面アイテムの回収。
import { CONFIG } from "../config.js";
import {
  resolveCampCollision, resolveWallsCollision, resolveBlockers,
} from "../world.js";
import { createBear, createGroundItem, updateBear, updateGroundItem, findNearestBear } from "../entities.js";
import { playSfx } from "../audio.js";
import { addText, playPickupSfx } from "./helpers.js";

export function createCombat({ state, world, quests, getStats, ui }) {
  // source = {type:"player"} | {type:"hunter", id}
  function killBear(bear, source) {
    bear.state = "dead";
    const tier = CONFIG.bear.tiers[bear.tier];
    const boss = !!tier.boss;
    // 肉は散らばらず、倒した者の背中へ弧を描いて飛んでいく
    const owner = source?.type === "hunter" ? source.id : "player";
    for (let i = 0; i < tier.meat; i++) {
      state.carryFlights.push({
        id: state.nextFlightId++, kind: "raw", value: tier.meatValue,
        x: bear.x, y: bear.y, z: 20, owner, t: 0,
      });
    }
    // 討伐の気持ちよさ: 時間停止 + 画面シェイク + 破裂エフェクト
    state.effects.push({ kind: "burst", x: bear.x, y: bear.y, color: "#ff6b5e", count: boss ? 40 : 14, age: 0, life: 0.45 });
    state.effects.push({ kind: "ring", x: bear.x, y: bear.y, age: 0, life: 0.6 });
    state.hitstop = boss ? 0.18 : 0.09;
    state.shake = boss ? 26 : 12;
    state.zoomPunch = Math.max(state.zoomPunch, boss ? 1.0 : 0.6);
    playSfx("kill");
    quests.notify("killBear", { boss });
    const spawn = { x: bear.homeX, y: bear.homeY, tier: bear.tier };
    state.respawnQueue.push({ spawn, timer: tier.respawn });
    state.bears = state.bears.filter((b) => b.id !== bear.id);
  }

  function damageBear(bear, damage, fromX, fromY, source) {
    bear.hp -= damage;
    bear.hitFlash = 0.12;
    bear.squash = 1;
    // 攻撃方向へノックバック
    const d = Math.hypot(bear.x - fromX, bear.y - fromY) || 1;
    bear.kx = ((bear.x - fromX) / d) * 260;
    bear.ky = ((bear.y - fromY) / d) * 260;
    state.hitstop = Math.max(state.hitstop, 0.04);
    state.effects.push({ kind: "burst", x: bear.x, y: bear.y, color: "#ffffff", count: 6, age: 0, life: 0.45 });
    playSfx("hit");
    addText(state, bear.x, bear.y - 30, `${damage}`, "#fff", 18);
    if (bear.hp <= 0) killBear(bear, source);
  }

  function updateCombat() {
    const s = getStats();
    const player = state.player;
    const target = findNearestBear(state.bears, player.x, player.y, CONFIG.player.attackRange);
    if (target && player.attackTimer <= 0) {
      player.attackTimer = CONFIG.player.attackInterval;
      player.swing = 0.2;
      // ターゲットへ踏み込むランジ。座標は直接動かさず updatePlayer で消費させる
      // (衝突解決後に動かすと柵や氷壁をすり抜けるため)
      const d = Math.hypot(target.x - player.x, target.y - player.y) || 1;
      const impulse = CONFIG.player.lungeImpulse * (player.moving ? 0.5 : 1);
      player.lungeX = ((target.x - player.x) / d) * impulse;
      player.lungeY = ((target.y - player.y) / d) * impulse;
      damageBear(target, s.damage, player.x, player.y, { type: "player" });
    }
  }

  // プレイヤー被弾: HP減少 + ノックバック + アイテムドロップ。HP 0 でダウン(焚き火へ強制送還)
  function hurtPlayer(bear, result) {
    const player = state.player;
    if (player.hurtCd > 0) return; // 連続ヒットの無敵時間
    player.hurtCd = CONFIG.player.hurtCooldown;
    player.hp -= result.damage;
    addText(state, player.x, player.y - 30, `-${result.damage}`, "#e25555", 22);
    state.shake = Math.max(state.shake, 10);
    playSfx("hit");
    const d = Math.hypot(player.x - bear.x, player.y - bear.y) || 1;
    player.lungeX += ((player.x - bear.x) / d) * 240;
    player.lungeY += ((player.y - bear.y) / d) * 240;
    const drops = Math.min(CONFIG.bear.tiers[result.tier].drops, player.stack.length);
    for (let i = 0; i < drops; i++) {
      const dropped = player.stack[player.stack.length - 1];
      player.stack = player.stack.slice(0, -1);
      state.meats.push(createGroundItem(player.x, player.y, dropped.kind, dropped.value));
    }
    if (player.hp > 0) return;

    // ダウン: 持ち物を一部ばらまいて焚き火へ送還(死亡なしのカジュアル仕様)
    const lost = Math.min(CONFIG.player.downDrops, player.stack.length);
    for (let i = 0; i < lost; i++) {
      const dropped = player.stack[player.stack.length - 1];
      player.stack = player.stack.slice(0, -1);
      state.meats.push(createGroundItem(player.x, player.y, dropped.kind, dropped.value));
    }
    state.effects.push({ kind: "burst", x: player.x, y: player.y, color: "#e25555", count: 20, age: 0, life: 0.6 });
    player.x = world.campfire.x + 60;
    player.y = world.campfire.y + 40;
    player.lungeX = 0;
    player.lungeY = 0;
    player.hp = Math.round(player.maxHp * CONFIG.player.downHpRatio);
    state.shake = Math.max(state.shake, 18);
    ui.showToast("💫 クマにやられた…焚き火のそばで休もう");
  }

  // ハンター被弾: HP減少 + 突き飛ばし(HP低下は entities 側の休憩遷移につながる)
  function hurtHunter(hunter, bear, result) {
    hunter.hp -= result.damage;
    addText(state, hunter.x, hunter.y - 30, `-${result.damage}`, "#ffb3a7", 16);
    const d = Math.hypot(hunter.x - bear.x, hunter.y - bear.y) || 1;
    hunter.x += ((hunter.x - bear.x) / d) * 50;
    hunter.y += ((hunter.y - bear.y) / d) * 50;
  }

  function updateBears(dt) {
    const isNight = state.time.isNight;
    // 休憩中のハンターは狙わない(焚き火=安全圏)
    const targets = [state.player, ...state.hunters.filter((h) => h.state !== "rest")];
    for (const bear of state.bears) {
      let target = state.player;
      let best = Infinity;
      for (const t of targets) {
        const d = Math.hypot(t.x - bear.x, t.y - bear.y);
        if (d < best) { best = d; target = t; }
      }
      const prevX = bear.x;
      const prevY = bear.y;
      const result = updateBear(bear, target, dt, world, isNight);
      resolveCampCollision(world.camp, prevX, prevY, bear);
      if (world.walls) resolveWallsCollision(world.walls, prevX, prevY, bear);
      resolveBlockers(world.blockers, bear);
      if (result?.type === "bearAttack") {
        if (result.target === state.player) hurtPlayer(bear, result);
        else hurtHunter(result.target, bear, result);
      }
    }
  }

  // プレイヤーの回復: 焚き火の近くで静止していると回復(被弾無敵もここで減衰)
  let regenTextT = 0;
  function updateVitals(dt) {
    const player = state.player;
    player.hurtCd = Math.max(0, player.hurtCd - dt);
    const fire = world.campfire;
    const near = Math.hypot(player.x - fire.x, player.y - fire.y) < CONFIG.campfire.range;
    if (near && state.stillTime >= 0.3 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + CONFIG.campfire.regen * dt);
      regenTextT -= dt;
      if (regenTextT <= 0) {
        regenTextT = 0.8;
        addText(state, player.x, player.y - 40, "+♥", "#7CFC8a", 16);
      }
    }
  }

  // 背中へホーミング中のアイテム。owner("player" or hunterId)の背中へ吸い付く
  function updateCarryFlights(dt) {
    for (const f of state.carryFlights) {
      f.t += dt;
      const owner = f.owner === "player"
        ? state.player
        : state.hunters.find((h) => h.id === f.owner);
      if (!owner) {
        // ハンターが居なくなっていたら、その場で地面アイテム化
        state.meats.push(createGroundItem(f.x, f.y, f.kind, f.value));
        f.done = true;
        continue;
      }
      const d = Math.hypot(owner.x - f.x, owner.y - f.y);
      if (d < 18) {
        // プレイヤーの非マネー所持が上限なら受け取れず足元に落ちる(後で拾える)
        if (owner === state.player && f.kind !== "money" &&
            owner.stack.filter((i) => i.kind !== "money").length >= getStats().carryCap) {
          state.meats.push(createGroundItem(owner.x, owner.y, f.kind, f.value));
        } else {
          owner.stack = [...owner.stack, { kind: f.kind, value: f.value }];
          if (f.kind === "money") ui.bumpMoneyHud(); // 札の着弾に合わせて HUD を弾ませる
          playPickupSfx(state);
        }
        f.done = true;
        continue;
      }
      const pull = 14;
      f.x += ((owner.x - f.x) / d) * pull * d * dt;
      f.y += ((owner.y - f.y) / d) * pull * d * dt;
      f.z += (50 - f.z) * Math.min(1, dt * 10);
    }
    state.carryFlights = state.carryFlights.filter((f) => !f.done);
  }

  // 地面アイテム: 物理更新と magnet 回収(非マネーは所持上限まで。札は常に拾える)
  function updateGroundItems(dt) {
    const player = state.player;
    const carryCap = getStats().carryCap;
    let carried = player.stack.filter((i) => i.kind !== "money").length;
    for (const item of state.meats) updateGroundItem(item, player, dt);
    for (const item of state.meats) {
      if (item.collected || item.magnet) continue;
      // 着地済みのアイテムだけ吸い寄せ開始
      if (item.z > 0 || item.vz > 1) continue;
      if (item.kind !== "money" && carried >= carryCap) continue;
      const d = Math.hypot(item.x - player.x, item.y - player.y);
      if (d < CONFIG.meat.magnetRange) {
        item.magnet = true;
        if (item.kind !== "money") carried++;
      }
    }
    let picked = false;
    for (const item of state.meats) {
      if (item.magnet && item.collected) {
        player.stack = [...player.stack, { kind: item.kind, value: item.value }];
        picked = true;
      }
    }
    if (picked) playPickupSfx(state);
    state.meats = state.meats.filter((m) => !m.collected);
  }

  function updateRespawns(dt) {
    for (const item of state.respawnQueue) item.timer -= dt;
    const ready = state.respawnQueue.filter((r) => r.timer <= 0);
    state.respawnQueue = state.respawnQueue.filter((r) => r.timer > 0);
    for (const r of ready) {
      state.bears.push(createBear(r.spawn.x, r.spawn.y, r.spawn.tier));
    }
  }

  function update(dt) {
    updateBears(dt);
    updateCombat();
    updateVitals(dt);
    updateCarryFlights(dt);
    updateGroundItems(dt);
  }

  return { update, updateRespawns, damageBear };
}
