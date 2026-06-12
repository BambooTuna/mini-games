// NPC: ハンター(討伐→生肉をカット台へ納品)と客(来店→待機→購入→退店のサイクル)。
import { CONFIG } from "../config.js";
import {
  resolveCampCollision, resolveWallsCollision, resolveBlockers, resolveRectBlockers,
} from "../world.js";
import { createHunter, createCustomer, createGroundItem, updateHunter, updateCustomer } from "../entities.js";
import { addText, playPickupSfx } from "./helpers.js";

export function createNpcs({ state, world, save, damageBear, nav, getStats }) {
  // ハンターのステータスは主人公スペック比(強化に連動。同スペックだとインフレするため割引)
  function hunterStats() {
    const s = getStats();
    const r = CONFIG.hunter.ratio;
    return {
      damage: Math.round(s.damage * r.damage),
      speed: s.speed * r.speed,
      capacity: Math.round(s.carryCap * r.capacity),
    };
  }
  // 雇用レベルに合わせてハンター数を揃える
  function syncHunters() {
    const want = CONFIG.upgrades.hunter.effect(save.levels.hunter);
    while (state.hunters.length < want) {
      state.hunters.push(createHunter(world.spawn.x + 40, world.spawn.y + 40));
    }
  }

  // カット台の満杯ヒステリシス: 満杯で休憩へ、6割を切るまで復帰しない(出戻りのバタつき防止)
  let cutboardJam = false;

  // 焚き火(940,860)からの休憩位置オフセット(最大3人)
  const REST_OFFSETS = [{ x: -65, y: 42 }, { x: 58, y: 58 }, { x: -8, y: 78 }];

  function updateHunters(dt) {
    const events = [];
    const cutboard = (world.stations ?? []).find((s) => s.key === "cutboard");
    const depositSpot = cutboard?.inZone ?? world.spawn;
    const inputLen = state.stations.cutboard.input.length;
    if (inputLen >= CONFIG.process.outputCap) cutboardJam = true;
    else if (inputLen <= CONFIG.process.outputCap * 0.6) cutboardJam = false;
    const wantRest = state.time.isNight || cutboardJam;

    // 東の氷壁が開くまでは壁の先のクマを狙わせない(壁際で立ち往生しない)
    const eastWall = (world.walls ?? []).find((w) => w.id === "east");
    const huntableX = eastWall && !eastWall.broken ? eastWall.segments[0].x1 : Infinity;
    const huntable = state.bears.filter((b) => b.x < huntableX);
    const stats = hunterStats();

    for (let i = 0; i < state.hunters.length; i++) {
      const hunter = state.hunters[i];
      // 焚き火の周りの休憩位置(焼き台の投入ゾーンやパッドに被らない手置きオフセット)
      const off = REST_OFFSETS[i % REST_OFFSETS.length];
      const restSpot = { x: world.campfire.x + off.x, y: world.campfire.y + off.y };
      const prevX = hunter.x;
      const prevY = hunter.y;
      updateHunter(hunter, {
        bears: huntable, meats: state.meats, depositSpot, world, restSpot, wantRest, nav, stats,
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
