// 動的エンティティの描画: プレイヤー(武器の見た目成長)・クマ(溜め/被弾演出)・
// ハンター・客のメッシュプール、背中スタックの遅延追従チェーン、地面アイテム、クエスト誘導矢印。
import * as THREE from "three";
import { CONFIG } from "../config.js";
import { buildModel } from "../models.js";
import { itemModelKey, STACK_H } from "./effects3d.js";

export function createActors(ctx) {
  const { scene, clock } = ctx;

  // 人型(主人公/ハンター/客)の見た目スケール。当たり判定やHIT範囲は据え置き
  const HUMAN_SCALE = 1.5;

  const playerModel = buildModel("player");
  playerModel.scale.setScalar(HUMAN_SCALE);
  scene.add(playerModel);

  // トルネード斬りの回転状態(攻撃1回につき1回転のペース)
  const SPIN_SPEED = (Math.PI * 2) / CONFIG.player.attackInterval;
  let spinAngle = 0; // 累積回転角。0 = 非回転
  let spinHold = 0;  // 回転を維持する残り時間(攻撃が続く限り更新される)
  let lastWeaponLv = -1; // 武器の見た目成長の変化検知
  let lastBootsLv = -1;  // バックパック(boots)の見た目ティアの変化検知

  // ---- 背中スタック(遅延追従チェーン。下から上へ波打つ) ----
  // 各段がすぐ下の段の頭上へ spring 追従する。slot は kind 別メッシュを抱えて切り替える。
  function setSlotKind(slot, kind) {
    if (slot.cur === kind) return;
    if (slot.cur !== null && slot.meshes[slot.cur]) slot.meshes[slot.cur].visible = false;
    let m = slot.meshes[kind];
    if (m === undefined) {
      try {
        m = buildModel(itemModelKey(kind));
        slot.group.add(m);
      } catch {
        m = null;
      }
      slot.meshes[kind] = m;
    }
    if (m) m.visible = true;
    slot.cur = kind;
  }

  function createStackChain(cap) {
    const slots = [];     // {group, meshes:{kind:mesh|null}, cur, x, y, z}
    let lastCount = null; // 初回フレームは記録のみ(バウンスさせない)
    let bounceT = 0;      // 積み増し時のタワー全体バウンス
    let popT = 0;         // 新トップのスケールポップ

    return {
      update(stack, anchor, dt, rawDt) {
        const count = Math.min(stack.length, cap);
        if (lastCount !== null && count > lastCount) {
          bounceT = 0.25;
          popT = 0.25;
        }
        lastCount = count;
        if (bounceT > 0) bounceT = Math.max(0, bounceT - rawDt);
        if (popT > 0) popT = Math.max(0, popT - rawDt);
        const lift = 1 + 0.3 * (bounceT / 0.25); // 段間隔を一瞬広げて波で戻す

        while (slots.length < count) {
          const group = new THREE.Group();
          group.visible = false;
          scene.add(group);
          slots.push({
            group, meshes: {}, cur: null,
            x: anchor.x, y: anchor.y + slots.length * 8, z: anchor.z,
          });
        }

        // 追従ターゲット: 1つ下の段(最下段はプレイヤーの背中)
        let tx = anchor.x;
        let ty = anchor.y;
        let tz = anchor.z;
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (i >= count) {
            if (s.group.visible) s.group.visible = false;
            continue;
          }
          const kind = stack[i]?.kind ?? "raw";
          setSlotKind(s, kind);

          // spring 追従(k≈18)。加減速の遅れが下から上へ伝播して波打つ
          const fxz = 1 - Math.exp(-18 * dt);
          const fy = 1 - Math.exp(-30 * dt); // 高さはやや硬めに
          s.x += (tx - s.x) * fxz;
          s.z += (tz - s.z) * fxz;
          s.y += (ty - s.y) * fy;
          // 行き過ぎ防止(ちぎれて見えない範囲にクランプ)
          const dx = s.x - tx;
          const dz = s.z - tz;
          const d = Math.hypot(dx, dz);
          if (d > 9) {
            s.x = tx + (dx / d) * 9;
            s.z = tz + (dz / d) * 9;
          }
          if (s.y - ty > 6) s.y = ty + 6;
          else if (ty - s.y > 6) s.y = ty - 6;

          s.group.position.set(s.x, s.y, s.z);
          // 遅れの方向へしなる(lean)
          s.group.rotation.set((tz - s.z) * 0.05, i * 0.7, (s.x - tx) * 0.05);
          let sc = 0.95 - (i / Math.max(1, cap - 1)) * 0.2; // 上ほど僅かに細く
          if (i === count - 1 && popT > 0) sc *= 1 + 0.6 * (popT / 0.25);
          s.group.scale.setScalar(sc);
          if (!s.group.visible) s.group.visible = true;

          tx = s.x;
          tz = s.z;
          ty = s.y + (STACK_H[itemModelKey(kind)] ?? 8) * lift;
        }
      },
      dispose() {
        for (const s of slots) scene.remove(s.group);
        slots.length = 0;
      },
    };
  }

  const playerChain = createStackChain(40);
  const hunterChains = new Map(); // hunterId -> chain(表示上限8)

  // 背中アンカー(背中側へ -13、肩の高さ 26 + bob。HUMAN_SCALE に追従)
  function backAnchor(e) {
    const angle = headings.get(e.id)?.angle ?? 0;
    const bob = e.moving ? Math.abs(Math.sin(e.bobPhase)) * 6 : 0;
    return {
      x: e.x - Math.sin(angle) * 13 * HUMAN_SCALE,
      y: 26 * HUMAN_SCALE + bob,
      z: e.y - Math.cos(angle) * 13 * HUMAN_SCALE,
    };
  }

  // ---- メッシュプール ----
  const pools = { bear: new Map(), hunter: new Map(), meat: new Map(), customer: new Map() };
  const headings = new Map(); // id -> {x, y, angle}
  const badModelKeys = new Set(); // 未実装モデルキー(customer 等が来る前でも落ちない)

  function acquire(map, id, key) {
    let m = map.get(id);
    if (!m) {
      if (badModelKeys.has(key)) return null;
      try { m = buildModel(key); } catch { badModelKeys.add(key); return null; }
      m.userData.materials = [];
      m.traverse((o) => { if (o.isMesh && o.material?.emissive) m.userData.materials.push(o.material); });
      map.set(id, m);
      scene.add(m);
    }
    m.userData.alive = true;
    return m;
  }

  function sweep(map) {
    for (const [id, m] of map) {
      if (!m.userData.alive) {
        scene.remove(m);
        map.delete(id);
        headings.delete(id);
      }
      m.userData.alive = false;
    }
  }

  // 移動方向にゆっくり旋回させる
  function turn(model, id, x, y, dt) {
    let h = headings.get(id);
    if (!h) { h = { x, y, angle: 0 }; headings.set(id, h); }
    const dx = x - h.x;
    const dy = y - h.y;
    if (Math.hypot(dx, dy) > 0.5) {
      const target = Math.atan2(dx, dy);
      let diff = target - h.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      h.angle += diff * Math.min(1, dt * 12);
    }
    h.x = x;
    h.y = y;
    model.rotation.y = h.angle;
  }

  function poseHumanoid(model, e, dt) {
    const bob = e.moving ? Math.abs(Math.sin(e.bobPhase)) * 6 : 0;
    model.position.set(e.x, bob, e.y);
    turn(model, e.id, e.x, e.y, dt);
    model.rotation.x = e.moving ? Math.sin(e.bobPhase) * 0.06 : 0;
    const weapon = model.getObjectByName("weapon");
    if (weapon) {
      weapon.rotation.x = e.swing > 0 ? -Math.sin(e.swing * 31) * 1.4 : 0;
    }
  }

  // ---- クエスト誘導矢印(プレイヤー頭上の琥珀色コーン) ----
  const arrowGroup = new THREE.Group();
  const arrowMesh = new THREE.Mesh(
    new THREE.ConeGeometry(14, 32, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb300 })
  );
  arrowMesh.rotation.x = Math.PI - 0.55; // 下向き + 目標方向へ前傾
  arrowGroup.add(arrowMesh);
  arrowGroup.visible = false;
  scene.add(arrowGroup);

  function sync(state, dt, rawDt) {
    const player = state.player;

    poseHumanoid(playerModel, player, dt);

    // 主人公の攻撃はトルネード斬り(見た目のみ): 攻撃が続く間オノを水平に構えて回転し続け、
    // やめたら一周の切れ目まで回りきって止まる(回転は heading への加算なので turn() と干渉しない)
    if (player.swing > 0) spinHold = CONFIG.player.attackInterval + 0.1; // 次の攻撃まで途切れない保持時間
    if (spinHold > 0) {
      spinHold -= dt;
      spinAngle += SPIN_SPEED * dt;
    } else if (spinAngle > 0) {
      const stopAt = Math.ceil(spinAngle / (Math.PI * 2)) * Math.PI * 2;
      spinAngle = Math.min(stopAt, spinAngle + SPIN_SPEED * dt);
      if (spinAngle >= stopAt) spinAngle = 0;
    }
    if (spinAngle > 0) {
      playerModel.rotation.y += spinAngle;
      const weapon = playerModel.getObjectByName("weapon");
      if (weapon) weapon.rotation.x = -1.5;
    }

    // 武器の見た目成長(レベル変化時のみ適用)
    const weaponLv = state.save.levels?.weapon ?? 0;
    if (weaponLv !== lastWeaponLv) {
      lastWeaponLv = weaponLv;
      const weapon = playerModel.getObjectByName("weapon");
      if (weapon) weapon.scale.setScalar(1 + weaponLv * 0.08);
      const axehead = playerModel.getObjectByName("axehead");
      if (axehead?.material?.color) {
        if (weaponLv >= 6) axehead.material.color.set(0xf3c94e);
        else if (weaponLv >= 3) axehead.material.color.set(0x9ab8d8);
      }
    }

    // バックパックの見た目進化(Lv0 非表示 / Lv1-3 雑嚢 / Lv4-6 中型 / Lv7+ 大型フレーム)
    const bootsLv = state.save.levels?.boots ?? 0;
    if (bootsLv !== lastBootsLv) {
      lastBootsLv = bootsLv;
      const backpack = playerModel.getObjectByName("backpack");
      if (backpack) {
        backpack.visible = bootsLv >= 1;
        const tier = bootsLv >= 7 ? 3 : bootsLv >= 4 ? 2 : 1;
        for (let i = 1; i <= 3; i++) {
          const part = backpack.getObjectByName(`pack_${i}`);
          if (part) part.visible = i === tier;
        }
      }
    }

    // 背中スタック(遅延追従チェーン。表示上限40)
    playerChain.update(player.stack ?? [], backAnchor(player), dt, rawDt);

    // クエスト誘導矢印(targetPos がある時だけ表示)
    const targetPos = state.quest?.targetPos;
    if (targetPos) {
      arrowGroup.visible = true;
      arrowGroup.position.set(player.x, 125 + Math.sin(clock.elapsed * 4) * 6, player.y);
      arrowGroup.rotation.y = Math.atan2(targetPos.x - player.x, targetPos.y - player.y);
    } else {
      arrowGroup.visible = false;
    }

    // クマ(溜め中は潰れ + 赤発光、被弾でフラッシュ)
    for (const bear of state.bears) {
      const m = acquire(pools.bear, bear.id, `bear_t${bear.tier + 1}`);
      if (!m) continue;
      const t = CONFIG.bear.tiers[bear.tier];
      const bob = bear.moving ? Math.abs(Math.sin(bear.bobPhase)) * 4 : 0;
      m.position.set(bear.x, bob, bear.y);
      turn(m, bear.id, bear.x, bear.y, dt);
      // 溜め(windup)中は潰れ+赤発光を既存項に合成する(別代入を後ろに足すと上書きで消える)
      const wind = (bear.windup ?? 0) > 0
        ? Math.min(1, Math.max(0, 1 - bear.windup / (CONFIG.bear.windup ?? 0.35)))
        : 0;
      const sq = Math.min(1, bear.squash) * 0.22 + wind * 0.18;
      m.scale.set(t.scale * (1 + sq), t.scale * (1 - sq), t.scale * (1 + sq));
      const flash = Math.min(1, bear.hitFlash * 8);
      for (const material of m.userData.materials) {
        material.emissive.setRGB(Math.max(flash, wind * 0.8), flash, flash);
      }
    }
    sweep(pools.bear);

    // ハンター(背中スタック付き。表示上限8)
    for (const hunter of state.hunters) {
      const m = acquire(pools.hunter, hunter.id, "hunter");
      if (!m) continue;
      m.scale.setScalar(HUMAN_SCALE);
      poseHumanoid(m, hunter, dt);
      let chain = hunterChains.get(hunter.id);
      if (!chain) {
        chain = createStackChain(8);
        hunterChains.set(hunter.id, chain);
      }
      chain.update(hunter.stack ?? [], backAnchor(hunter), dt, rawDt);
    }
    sweep(pools.hunter);
    for (const [id, chain] of hunterChains) {
      if (!pools.hunter.has(id)) {
        chain.dispose();
        hunterChains.delete(id);
      }
    }

    // 地面アイテム(被弾ドロップ等。kind 別メッシュ)
    for (const meat of state.meats ?? []) {
      if (meat.collected) continue;
      const m = acquire(pools.meat, meat.id, itemModelKey(meat.kind ?? "raw"));
      if (!m) continue;
      m.position.set(meat.x, meat.z, meat.y);
      m.rotation.y = meat.rot;
    }
    sweep(pools.meat);

    // 客(poseHumanoid 流用。carrying なら頭上に肉)。gone(再来店待ち)は非表示
    for (const cust of state.customers ?? []) {
      const m = acquire(pools.customer, cust.id, "customer");
      if (!m) continue;
      const custVisible = cust.state !== "gone";
      if (m.visible !== custVisible) m.visible = custVisible;
      if (!custVisible) continue;
      m.scale.setScalar(HUMAN_SCALE);
      poseHumanoid(m, cust, dt);
      if (m.userData.carry === undefined) {
        try {
          const carry = buildModel("meat");
          carry.scale.setScalar(0.8 / HUMAN_SCALE); // 親のスケールを相殺(肉の見た目サイズを揃える)
          carry.position.set(0, 50, 3);
          carry.visible = false;
          m.add(carry);
          m.userData.carry = carry;
        } catch {
          m.userData.carry = null;
        }
      }
      if (m.userData.carry) m.userData.carry.visible = cust.carrying === true;
    }
    sweep(pools.customer);
  }

  return { sync };
}
