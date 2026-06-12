// localStorage へのセーブ/ロード。
import { CONFIG } from "./config.js";

// 額面を billValue 刻みの札 [{kind:"money",value}] に分割する(端数はその額の札)
export function moneyToBills(amount) {
  const bills = [];
  let rest = Math.floor(amount);
  while (rest > 0) {
    const v = Math.min(CONFIG.money.billValue, rest);
    bills.push({ kind: "money", value: v });
    rest -= v;
  }
  return bills;
}

export function loadSave() {
  try {
    localStorage.removeItem("arctic-survivor-save-v1"); // 旧フォーマットは破棄
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    const d = defaultSave();
    const merged = {
      ...d,
      ...data,
      levels: { ...d.levels, ...data.levels },
      stations: { ...d.stations, ...data.stations },
    };
    // migration: 旧フォーマットの抽象ウォレット(money)は札に変換して背中スタックへ
    const m = Math.max(0, Math.floor(Number(data.money) || 0));
    if (m > 0) merged.stack = [...merged.stack, ...moneyToBills(m)];
    merged.money = 0;
    // migration: カット台・焼き台は常設(Lv1 起点)
    merged.levels.cutboard = Math.max(1, merged.levels.cutboard ?? 0);
    merged.levels.grill = Math.max(1, merged.levels.grill ?? 0);
    merged.counter = { input: [...(data.counter?.input ?? [])] };
    // migration: counter 導入前の旧セーブはクエストチェーン(7問→8問)の index をマップ
    if (!data.counter) {
      merged.questIndex = [0, 1, 1, 2, 5, 6, 7][merged.questIndex] ?? 8;
    }
    // migration: クエストチェーン v3(8問→11問)。判定は保存値(raw)の questVersion で行う
    // (merged は defaultSave のスプレッドで最新 questVersion を持ってしまうため)
    if (data.questVersion !== 3 && data.questVersion !== 4) {
      merged.questIndex = [0, 1, 2, 3, 4, 8, 9, 10][merged.questIndex] ?? 11;
    }
    // migration: v4 はクエストの並び替えのみ(level 系は save.levels から自動達成されるので index はそのまま)
    merged.questVersion = 4;
    // migration: マップ南向き化で壊せる氷壁が東→南に移った(進行は引き継ぐ)
    merged.unlockedWalls = (merged.unlockedWalls ?? []).map((id) => (id === "east" ? "south" : id));
    return merged;
  } catch {
    return defaultSave();
  }
}

export function persistSave(save) {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(save));
  } catch {
    // プライベートブラウズ等で失敗しても無視
  }
}

function defaultSave() {
  return {
    money: 0,
    counterMoney: 0, // カウンター上の未回収金($)
    levels: { weapon: 0, cutboard: 1, grill: 1, boots: 0, hunter: 0 }, // カット台・焼き台は初期から常設
    questIndex: 0,
    questVersion: 4, // クエストチェーンの世代(migration 判定用)
    unlockedWalls: [], // 破壊済みの氷壁 id
    stack: [],         // 背中スタック [{kind,value}]
    stations: { cutboard: { input: [], output: [] }, grill: { input: [], output: [] } },
    counter: { input: [] }, // カウンターに預けた焼き肉(数値 value の配列)
  };
}
