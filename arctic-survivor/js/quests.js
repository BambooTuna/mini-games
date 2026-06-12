// クエストチェーン: 常に次の目標を提示して誘導する。進行は save.questIndex で永続化。
import { CONFIG } from "./config.js";
import { findNearestBear } from "./entities.js";

export const QUESTS = [
  { type: "kill", text: "クマを3匹倒そう", target: 3, reward: 60 },
  { type: "process", key: "cutboard", text: "生肉をスライスしよう", target: 3, reward: 80 },
  { type: "process", key: "grill", text: "焼き肉を作ろう", target: 3, reward: 120 },
  { type: "sell", text: "肉を5個売ろう", target: 5, reward: 200 },
  { type: "level", key: "weapon", text: "オノを強化しよう", target: 1, reward: 150 },
  { type: "level", key: "cutboard", text: "スライス台を改造しよう", target: 2, reward: 150 },
  { type: "level", key: "grill", text: "焼き台を改造しよう", target: 2, reward: 200 },
  { type: "level", key: "boots", text: "ブーツを強化しよう", target: 1, reward: 200 },
  { type: "unlockWall", text: "東の氷壁を破壊しよう", target: 1, reward: 400 },
  { type: "level", key: "hunter", text: "ハンターを雇おう", target: 1, reward: 500 },
  { type: "killBoss", text: "巨大クマを討伐しよう", target: 1, reward: 1000 },
];

export function createQuestTracker(save) {
  let count = 0; // kill/sell 系の揮発カウント(レベル系は save.levels から導出)

  const current = () => QUESTS[save.questIndex] ?? null;

  function progressOf(quest) {
    if (quest.type === "level") {
      return Math.min(save.levels[quest.key] ?? 0, quest.target);
    }
    if (quest.type === "unlockWall") {
      return Math.min((save.unlockedWalls ?? []).length, quest.target);
    }
    return Math.min(count, quest.target);
  }

  // ゲームイベントを現在のクエストに反映する
  function notify(event, payload) {
    const quest = current();
    if (!quest) return;
    if (quest.type === "kill" && event === "killBear") count += 1;
    else if (quest.type === "killBoss" && event === "killBear" && payload?.boss) count += 1;
    else if (quest.type === "process" && event === "processed" && payload?.key === quest.key) count += 1;
    else if (quest.type === "sell" && event === "counterSell") count += 1;
  }

  // 達成判定。達成していれば次のクエストへ進め、達成したクエスト定義を返す
  function poll() {
    const quest = current();
    if (!quest || progressOf(quest) < quest.target) return null;
    save.questIndex += 1;
    count = 0;
    return quest;
  }

  function targetPosOf(quest, world, bears, player) {
    if (quest.type === "kill" || quest.type === "killBoss") {
      const pool = quest.type === "killBoss"
        ? bears.filter((b) => CONFIG.bear.tiers[b.tier]?.boss)
        : bears;
      const bear = findNearestBear(pool, player.x, player.y, Infinity);
      return bear ? { x: bear.x, y: bear.y } : null;
    }
    if (quest.type === "process") {
      const zone = (world.stations ?? []).find((s) => s.key === quest.key)?.inZone;
      return zone ? { x: zone.x, y: zone.y } : null;
    }
    if (quest.type === "sell") {
      const zone = world.counter?.inZone;
      return zone ? { x: zone.x, y: zone.y } : null;
    }
    if (quest.type === "unlockWall") {
      const wall = (world.walls ?? []).find((w) => w.pad && !w.broken);
      return wall ? { x: wall.pad.x, y: wall.pad.y } : null;
    }
    if (quest.type === "level") {
      // クエスト到達=パッド可視なので、現在クエストのパッドを直接指す
      const pad = world.pads.find((p) => p.key === quest.key);
      return pad ? { x: pad.x, y: pad.y } : null;
    }
    return null;
  }

  // render 描画用の HUD 状態(全クエスト完了時は null)
  function hudState(world, bears, player) {
    const quest = current();
    if (!quest) return null;
    const progress = progressOf(quest);
    return {
      text: quest.text,
      progress,
      target: quest.target,
      targetPos: targetPosOf(quest, world, bears, player),
      done: progress >= quest.target,
    };
  }

  return { notify, poll, hudState };
}
