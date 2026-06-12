// NPC: ハンター(討伐→生肉をカット台へ納品)と客(来店→待機→購入→退店のサイクル)。
import { CONFIG } from "../config.js";
import {
  resolveCampCollision, resolveWallsCollision, resolveBlockers, resolveRectBlockers,
} from "../world.js";
import { createHunter, createCustomer, createGroundItem, updateHunter, updateCustomer } from "../entities.js";
import { addText, playPickupSfx } from "./helpers.js";

export function createNpcs({ state, world, save, damageBear }) {
  // 雇用レベルに合わせてハンター数を揃える
  function syncHunters() {
    const want = CONFIG.upgrades.hunter.effect(save.levels.hunter);
    while (state.hunters.length < want) {
      state.hunters.push(createHunter(world.spawn.x + 40, world.spawn.y + 40));
    }
  }

  // カット台の満杯ヒステリシス: 満杯で休憩へ、6割を切るまで復帰しない(出戻りのバタつき防止)
  let cutboardJam = false;

  function updateHunters(dt) {
    const events = [];
    const cutboard = (world.stations ?? []).find((s) => s.key === "cutboard");
    const depositSpot = cutboard?.inZone ?? world.spawn;
    const inputLen = state.stations.cutboard.input.length;
    if (inputLen >= CONFIG.process.outputCap) cutboardJam = true;
    else if (inputLen <= CONFIG.process.outputCap * 0.6) cutboardJam = false;
    const wantRest = state.time.isNight || cutboardJam;

    for (let i = 0; i < state.hunters.length; i++) {
      const hunter = state.hunters[i];
      // 焚き火の周りに人数分の休憩位置を散らす
      const a = 0.8 + i * 2.1;
      const restSpot = {
        x: world.campfire.x + Math.cos(a) * 70,
        y: world.campfire.y + Math.sin(a) * 70,
      };
      const prevX = hunter.x;
      const prevY = hunter.y;
      updateHunter(hunter, {
        bears: state.bears, meats: state.meats, depositSpot, world, restSpot, wantRest,
      }, dt, events);
      resolveCampCollision(world.camp, prevX, prevY, hunter);
      if (world.walls) resolveWallsCollision(world.walls, prevX, prevY, hunter);
      resolveBlockers(world.blockers, hunter);
      resolveRectBlockers(world.rectBlockers, hunter);
    }
    for (const ev of events) {
      if (ev.type === "hunterHit") {
        const bear = state.bears.find((b) => b.id === ev.bearId);
        if (bear) damageBear(bear, ev.damage, ev.x, ev.y, { type: "hunter", id: ev.hunterId });
      } else if (ev.type === "hunterZzz") {
        addText(state, ev.x, ev.y - 30, "💤", "#bcd6ff", 18);
      } else if (ev.type === "hunterDeposit") {
        // ハンターは生肉をカット台へ納品。山が満杯なら受け取らず地面に落とす(無限備蓄防止)
        const st = state.stations.cutboard;
        if (st.input.length >= CONFIG.process.outputCap) {
          state.meats.push(createGroundItem(ev.x, ev.y, ev.item.kind, ev.item.value));
          continue;
        }
        st.input.push(ev.item.value);
        state.effects.push({
          kind: "itemFly", x: ev.x, y: ev.y,
          tx: cutboard?.inPile?.x ?? ev.x, ty: cutboard?.inPile?.y ?? ev.y,
          itemKind: "raw", age: 0, life: 0.35,
        });
        playPickupSfx(state);
      }
    }
    state.meats = state.meats.filter((m) => !m.collected);
  }

  // 客NPC: 昼は常時3人を回す(arrive/wait/leave/gone のサイクル)。夜は帰って朝まで来ない
  function updateCustomers(dt) {
    const isNight = state.time.isNight;
    while (!isNight && state.customers.length < 3) {
      state.customers.push(createCustomer(world, state.customers));
    }
    for (const customer of state.customers) {
      updateCustomer(customer, world, dt, isNight);
      resolveBlockers(world.blockers, customer);
      resolveRectBlockers(world.rectBlockers, customer);
    }
  }

  function update(dt) {
    updateHunters(dt);
    updateCustomers(dt);
  }

  return { update, syncHunters };
}
