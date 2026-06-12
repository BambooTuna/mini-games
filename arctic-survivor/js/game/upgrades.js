// 進行と課金: アップグレードコスト、パッドの解放可視ルール、拠点の段階拡張、
// 強化パッド/壁パッド(エリア解放)への札払い。
import { CONFIG } from "../config.js";
import { insideCamp, CAMP_STAGES } from "../world.js";
import { playSfx } from "../audio.js";
import { stackMoney, streamBill } from "./helpers.js";

// 施設パッドの可視ルール: そのパッドを目標とするクエストに到達済み(現在 or 過去)、
// または既にレベル実績があれば可視(旧セーブのパッドが消えないように)
const PAD_QUEST = { weapon: 4, cutboard: 5, grill: 6, boots: 7, hunter: 9 };
const PAD_DONE = { weapon: 1, cutboard: 2, grill: 2, boots: 1, hunter: 1 }; // この Lv 以上なら実績ありとみなす

export function createUpgrades({ state, world, save, ui, syncSave, syncHunters }) {
  function upgradeCost(key) {
    const def = CONFIG.upgrades[key];
    return Math.round(def.baseCost * Math.pow(def.costGrowth, save.levels[key] ?? 0));
  }

  function refreshPadCosts() {
    for (const key of Object.keys(CONFIG.upgrades)) {
      state.padCosts[key] = upgradeCost(key);
    }
  }

  function stats() {
    return {
      damage: CONFIG.upgrades.weapon.effect(save.levels.weapon),
      speed: CONFIG.upgrades.boots.effect(save.levels.boots),
      carryCap: CONFIG.upgrades.boots.carry(save.levels.boots),
    };
  }

  function computeUnlockedPads() {
    return Object.keys(PAD_QUEST).filter(
      (key) => save.questIndex >= PAD_QUEST[key] || (save.levels[key] ?? 0) >= PAD_DONE[key],
    );
  }

  // 拠点の拡張ステージ: オノ Lv1 で南へ、ブーツ Lv1 で東へ、ハンター Lv1 でさらに南へ広がる
  function campStageIndex() {
    if ((save.levels.hunter ?? 0) >= 1) return 3;
    if ((save.levels.boots ?? 0) >= 1) return 2;
    if ((save.levels.weapon ?? 0) >= 1) return 1;
    return 0;
  }

  // 拠点内に入った開拓対象(拡張予定地の木など)のブロッカーを取り除く(見た目は render 側が消す契約)
  function clearCampBlockers() {
    world.blockers = world.blockers.filter((b) => !(b.clearable && insideCamp(world.camp, b.x, b.y)));
  }

  // 起動時のステージ適用。createScene は world.camp から柵と地面を作るため、その前に呼ぶ
  function applyCampStage() {
    state.campStage = campStageIndex();
    Object.assign(world.camp, CAMP_STAGES[state.campStage]);
    clearCampBlockers();
  }

  function updatePads(dt) {
    const player = state.player;
    // 範囲が重なるパッドに同時課金しないよう、最寄りの1つにだけ支払う
    let pad = null;
    let best = Infinity;
    for (const p of world.pads) {
      const def = CONFIG.upgrades[p.key];
      if (!def) continue;
      if (!state.unlockedPads.includes(p.key)) continue; // 未解放(不可視)パッドに金が吸われない
      if ((save.levels[p.key] ?? 0) >= def.maxLevel) continue;
      const d = Math.hypot(player.x - p.x, player.y - p.y);
      if (d <= p.radius && d < best) {
        best = d;
        pad = p;
      }
    }
    if (!pad) return;

    const def = CONFIG.upgrades[pad.key];
    const cost = state.padCosts[pad.key];
    // 立っている間、背中の札が1枚ずつ流れ込む(端数は釣り銭として戻す)
    const pay = streamBill(state, cost - state.padPaid[pad.key], pad);
    if (pay <= 0) return;
    state.padPaid[pad.key] += pay;

    if (state.padPaid[pad.key] >= cost) {
      state.padPaid[pad.key] = 0;
      save.levels[pad.key] = (save.levels[pad.key] ?? 0) + 1;
      refreshPadCosts();
      syncHunters();
      // ステージが上がるレベルアップなら拠点を拡張(render 側が寸法変化を検知して柵を再構築)
      const stage = campStageIndex();
      if (stage > state.campStage) {
        state.campStage = stage;
        Object.assign(world.camp, CAMP_STAGES[stage]);
        clearCampBlockers();
        ui.showToast("🏕️ 拠点が広がった！");
        state.shake = Math.max(state.shake, 12);
        playSfx("levelup");
      }
      state.effects.push({ kind: "burst", x: pad.x, y: pad.y, color: "#ffd84d", count: 24, age: 0, life: 0.6 });
      state.effects.push({ kind: "levelup", x: pad.x, y: pad.y, text: `${def.name} Lv.${save.levels[pad.key]}!`, age: 0, life: 1.1 });
      playSfx("levelup");
      ui.showToast(`${def.icon} ${def.name} が Lv.${save.levels[pad.key]} になった！`);
      // 加工台が一定レベルに達するとベルトコンベアが付く(搬送は game/production、描画は render/stations3d)
      if ((pad.key === "cutboard" || pad.key === "grill") &&
          save.levels[pad.key] === CONFIG.conveyor.unlockLevel) {
        ui.showToast("🔁 ベルトコンベア解放！加工品が自動で次の工程へ流れる");
      }
    }
  }

  // 氷壁パッド: 上に立つと金が流れ込み、満額で壁が砕けてエリア解放
  function updateWalls(dt) {
    const player = state.player;
    for (const wall of world.walls ?? []) {
      if (wall.broken || !wall.pad) continue;
      const d = Math.hypot(player.x - wall.pad.x, player.y - wall.pad.y);
      if (d > wall.pad.radius) continue;

      const paid = state.wallPaid[wall.id] ?? 0;
      const pay = streamBill(state, wall.pad.cost - paid, wall.pad);
      if (pay <= 0) continue;
      state.wallPaid = { ...state.wallPaid, [wall.id]: paid + pay };

      if (state.wallPaid[wall.id] >= wall.pad.cost) {
        wall.broken = true;
        save.unlockedWalls = [...save.unlockedWalls, wall.id];
        syncSave();
        playSfx("shatter");
        state.effects.push({ kind: "burst", x: wall.pad.x, y: wall.pad.y, color: "#bfe6ff", count: 30, age: 0, life: 0.7 });
        state.shake = Math.max(state.shake, 20);
        ui.showToast("🧊 氷壁を破壊！新しいエリアが解放された！");
      }
    }
  }

  function update(dt) {
    state.payTimer = Math.max(0, state.payTimer - dt); // パッド/壁で共有(同フレーム二重払い防止)
    updatePads(dt);
    updateWalls(dt);
  }

  return { update, refreshPadCosts, computeUnlockedPads, applyCampStage, stats };
}
