// 生産ライン: 加工ステーション(投入→加工→取出)とカウンター(投入→自動販売→金回収)。
import { CONFIG } from "../config.js";
import { insideZone } from "../world.js";
import { playSfx } from "../audio.js";
import { addText, depositFromStack, playMoneySfx } from "./helpers.js";

export function createProduction({ state, world, save, quests }) {
  // 加工ステーション(常設): 投入(inZone)→加工(inPile の山→outPile の山)→取出(outZone)
  function updateStations(dt) {
    const player = state.player;
    for (const ws of world.stations ?? []) {
      const st = state.stations[ws.key];
      const proc = CONFIG.process[ws.key];
      const def = CONFIG.upgrades[ws.key];
      if (!st || !proc || !def) continue;
      const lv = save.levels[ws.key] ?? 1;

      // 加工: input から1個取り、倍率をかけて output へ(投入の山から加工済みの山へ飛ぶ)
      if (st.input.length > 0 && st.output.length < CONFIG.process.outputCap) {
        st.timer -= dt;
        if (st.timer <= 0) {
          st.timer = def.effect(lv);
          const v = st.input.shift();
          st.output.push(Math.round(v * proc.mult));
          state.effects.push({
            kind: "itemFly", x: ws.inPile?.x ?? ws.x, y: ws.inPile?.y ?? ws.y,
            tx: ws.outPile?.x ?? ws.x, ty: ws.outPile?.y ?? ws.y, itemKind: proc.outKind, age: 0, life: 0.35,
          });
          state.effects.push({ kind: "burst", x: ws.x, y: ws.y, color: "#ffd9a0", count: 6, age: 0, life: 0.35 });
          playSfx(ws.key === "cutboard" ? "chop" : "sizzle");
          quests.notify("processed", { key: ws.key });
        }
      }

      // 投入: inZone 内で、スタック末尾側から inKind に一致する最後の1個を投入の山へ飛ばす
      st.depositTimer = Math.max(0, st.depositTimer - dt);
      if (st.depositTimer <= 0) {
        const v = depositFromStack(state, proc.inKind, ws.inZone, ws.inPile);
        if (v !== null) {
          st.depositTimer = CONFIG.station.depositInterval;
          st.input.push(v);
        }
      }

      // 取出: outZone 内で output から1個ずつ背中へ(carryFlights 経由)。所持上限(飛行中込み)で止まる
      const carryCap = CONFIG.upgrades.boots.carry(save.levels.boots ?? 0);
      const carrying =
        player.stack.filter((i) => i.kind !== "money").length +
        state.carryFlights.filter((f) => f.owner === "player" && f.kind !== "money").length;
      st.withdrawTimer = Math.max(0, st.withdrawTimer - dt);
      if (st.withdrawTimer <= 0 && st.output.length > 0 && carrying < carryCap &&
          state.stillTime >= 0.15 && insideZone(ws.outZone, player.x, player.y)) {
        st.withdrawTimer = CONFIG.station.withdrawInterval;
        const v = st.output.pop();
        state.carryFlights.push({
          id: state.nextFlightId++, kind: proc.outKind, value: v,
          x: ws.outPile?.x ?? ws.x, y: ws.outPile?.y ?? ws.y, z: 20, owner: "player", t: 0,
        });
      }
    }
  }

  // ベルトコンベア: 台が conveyor.unlockLevel 以上なら次工程へ自動搬送する
  // (カット台 out→焼き台 in、焼き台 out→カウンターの肉山)。描画のベルトは render/stations3d
  function updateConveyors(dt) {
    const cv = CONFIG.conveyor;
    const cutboard = (world.stations ?? []).find((s) => s.key === "cutboard");
    const grill = (world.stations ?? []).find((s) => s.key === "grill");
    const belts = [
      {
        lvKey: "cutboard", st: state.stations.cutboard, kind: "slice",
        fromPile: cutboard?.outPile, toPile: grill?.inPile,
        dest: state.stations.grill.input,
      },
      {
        lvKey: "grill", st: state.stations.grill, kind: "cooked",
        fromPile: grill?.outPile, toPile: world.counter?.inPile,
        dest: state.counter.input,
      },
    ];
    for (const b of belts) {
      if ((save.levels[b.lvKey] ?? 0) < cv.unlockLevel) continue;
      b.st.beltTimer = Math.max(0, (b.st.beltTimer ?? 0) - dt);
      if (b.st.beltTimer > 0 || b.st.output.length === 0) continue;
      if (b.dest.length >= CONFIG.process.outputCap) continue;
      b.st.beltTimer = cv.interval;
      b.dest.push(b.st.output.shift());
      state.effects.push({
        kind: "itemFly", flat: true, itemKind: b.kind,
        x: b.fromPile?.x ?? 0, y: b.fromPile?.y ?? 0,
        tx: b.toPile?.x ?? 0, ty: b.toPile?.y ?? 0,
        age: 0, life: cv.flyTime,
      });
    }
  }

  // カウンター投入: inZone 内で背中の焼き肉(inKind)を1個ずつ肉の山(counter.input)へ飛ばす。
  // 札・生肉・スライスは売り場に入らない(焼き肉のみ)
  function updateCounterDeposit(dt) {
    const counter = world.counter;
    const ct = state.counter;
    ct.depositTimer = Math.max(0, ct.depositTimer - dt);
    if (ct.depositTimer > 0) return;
    const v = depositFromStack(state, CONFIG.counter.inKind, counter?.inZone, counter?.inPile);
    if (v === null) return;
    ct.depositTimer = CONFIG.station.depositInterval;
    ct.input.push(v);
  }

  // カウンター自動販売: 預けた肉が sellInterval ごとに売れて金山(counterMoney)へ積まれる
  function updateCounterSell(dt) {
    const ct = state.counter;
    const counter = world.counter;
    if (ct.input.length === 0) return;
    ct.timer -= dt;
    if (ct.timer > 0) return;
    ct.timer = CONFIG.counter.sellInterval;
    const value = ct.input.shift();
    save.counterMoney += value;
    state.effects.push({
      kind: "itemFly", x: counter?.inPile?.x ?? counter?.x ?? 0, y: counter?.inPile?.y ?? counter?.y ?? 0,
      tx: counter?.outPile?.x ?? counter?.x ?? 0, ty: counter?.outPile?.y ?? counter?.y ?? 0,
      itemKind: "money", age: 0, life: 0.35,
    });
    const spot = counter?.outPile;
    if (spot) addText(state, spot.x, spot.y - 20, `+$${value}`, "#7CFC8a", 14);
    playSfx("sell");
    quests.notify("counterSell");
    // 待機中の最古の客が買って帰る(居なくても売却は成立)
    const waiting = state.customers.filter((c) => c.state === "wait");
    if (waiting.length > 0) {
      const oldest = waiting.reduce((a, b) => (a.timer < b.timer ? a : b));
      oldest.carrying = true;
      oldest.state = "leave";
    }
  }

  // 金回収: outZone に入ると counterMoney が金山(outPile)から札になって背中へ飛ぶ
  function updateCounterMoney(dt) {
    const player = state.player;
    const counter = world.counter;
    state.collectTimer = Math.max(0, state.collectTimer - dt);
    if (save.counterMoney <= 0 || state.collectTimer > 0) return;
    if (state.stillTime < 0.15 || !insideZone(counter?.outZone, player.x, player.y)) return;

    state.collectTimer = CONFIG.money.collectInterval;
    const bill = Math.min(CONFIG.money.billValue, save.counterMoney);
    save.counterMoney -= bill;
    state.carryFlights.push({
      id: state.nextFlightId++, kind: "money", value: bill,
      x: counter.outPile?.x ?? counter.x, y: counter.outPile?.y ?? counter.y, z: 30, owner: "player", t: 0,
    });
    playMoneySfx(state);
  }

  function update(dt) {
    updateStations(dt);
    updateConveyors(dt);
    updateCounterDeposit(dt);
    updateCounterSell(dt);
    updateCounterMoney(dt);
  }

  return { update };
}
