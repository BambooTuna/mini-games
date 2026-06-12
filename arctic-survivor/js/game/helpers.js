// ロジック層の共通ヘルパー: 演出 push、札束操作、スロットル付き効果音、
// 札払いストリーム、ゾーン投入(ステーション/カウンター共通)。
import { CONFIG } from "./../config.js";
import { insideZone } from "../world.js";
import { playSfx } from "../audio.js";

// ---- 演出 ----

export function addText(state, x, y, text, color, size = 18) {
  state.effects.push({ kind: "text", x, y, text, color, size, age: 0, life: 0.9 });
}

export function addBillFly(state, x, y) {
  state.effects.push({
    kind: "coin", x, y,
    tx: x + (Math.random() - 0.5) * 100,
    ty: y - 60 - Math.random() * 60,
    age: 0, life: 0.55,
  });
}

// スロットル付き効果音(連続発火する回収音などを間引く)。timerKey は state 上の残り秒
export function playThrottledSfx(state, timerKey, name, interval) {
  if (state[timerKey] > 0) return;
  state[timerKey] = interval;
  playSfx(name);
}

export const playPickupSfx = (state) => playThrottledSfx(state, "pickupSfxTimer", "pickup", 0.05);
export const playMoneySfx = (state) => playThrottledSfx(state, "moneySfxTimer", "money", 0.06);

// ---- 金(札束) ----

// 背中スタック内の札(kind:"money")の合計額
export function stackMoney(stack) {
  return stack.reduce((sum, item) => (item.kind === "money" ? sum + item.value : sum), 0);
}

// スタック末尾側から最後の札を取り除いて返す(無ければ null)
export function takeBill(owner) {
  const idx = owner.stack.map((m) => m.kind).lastIndexOf("money");
  if (idx < 0) return null;
  const bill = owner.stack[idx];
  owner.stack = [...owner.stack.slice(0, idx), ...owner.stack.slice(idx + 1)];
  return bill;
}

// 1tick あたりの処理個数: 残量 count を interval 刻みで1個ずつ流すと flow.maxSeconds を
// 超える場合だけ個数を増やす(投入/取出/支払い共通。少量なら常に1)
export function flowBatch(count, interval) {
  return Math.max(1, Math.ceil((count * interval) / CONFIG.flow.maxSeconds));
}

// 札払いストリーム(パッド/壁パッド共通): 静止中に背中の札を target へ流し込む。
// 残額が大きいほど1tickの枚数が増え、おおむね flow.maxSeconds で払い終わる。
// payTimer は全支払い箇所で共有(同フレーム二重払い防止)。支払えなければ 0 を返す
export function streamBill(state, remaining, target) {
  const player = state.player;
  if (remaining <= 0 || state.payTimer > 0 || state.stillTime < 0.15 || stackMoney(player.stack) <= 0) {
    return 0;
  }
  state.payTimer = CONFIG.money.payInterval;
  const k = flowBatch(Math.ceil(remaining / CONFIG.money.billValue), CONFIG.money.payInterval);
  let pay = 0;
  for (let i = 0; i < k && pay < remaining && stackMoney(player.stack) > 0; i++) {
    const bill = takeBill(player);
    const p = Math.min(bill.value, remaining - pay);
    const change = bill.value - p;
    if (change > 0) player.stack = [...player.stack, { kind: "money", value: change }];
    pay += p;
  }
  // 💵 がプレイヤーから target へ物理的に流れる演出(tick につき1発)
  state.effects.push({ kind: "coin", x: player.x, y: player.y, tx: target.x, ty: target.y, age: 0, life: 0.55 });
  playSfx("pay");
  return pay;
}

// ゾーン投入(ステーション/カウンター共通): inZone 内で静止中、スタック末尾側から
// inKind に一致する最後の1個を pile へ飛ばし、その value を返す(投入できなければ null)
export function depositFromStack(state, inKind, zone, pile) {
  const player = state.player;
  if (state.stillTime < 0.15 || !insideZone(zone, player.x, player.y)) return null;
  const idx = player.stack.map((m) => m.kind).lastIndexOf(inKind);
  if (idx < 0) return null;
  const item = player.stack[idx];
  player.stack = [...player.stack.slice(0, idx), ...player.stack.slice(idx + 1)];
  state.effects.push({
    kind: "itemFly", x: player.x, y: player.y,
    tx: pile?.x ?? player.x, ty: pile?.y ?? player.y, itemKind: item.kind, age: 0, life: 0.35,
  });
  playPickupSfx(state);
  return item.value;
}
