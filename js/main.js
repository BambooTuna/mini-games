// エントリポイント: 状態と各システム(game/)・描画(render/)を配線し、ゲームループを回す。
// DOM(HUD・トースト・設定メニュー)もここで持つ。
import { CONFIG } from "./config.js";
import { createInput } from "./input.js";
import {
  createWorld, resolveCampCollision, resolveWallsCollision, resolveBlockers, resolveRectBlockers,
} from "./world.js";
import { loadSave, moneyToBills } from "./save.js";
import { updatePlayer } from "./entities.js";
import { createScene, CAMERA_AZIMUTH } from "./render/scene.js";
import { initAudio, playSfx } from "./audio.js";
import { createQuestTracker } from "./quests.js";
import { createState, flushSave } from "./game/state.js";
import { addText, addBillFly, stackMoney } from "./game/helpers.js";
import { createCombat } from "./game/combat.js";
import { createProduction } from "./game/production.js";
import { createNpcs } from "./game/npcs.js";
import { createUpgrades } from "./game/upgrades.js";

const canvas = document.getElementById("game");
const container = document.getElementById("game-container");
const moneyEl = document.getElementById("money-value");
const moneyCounterEl = document.getElementById("money-counter");
const meatEl = document.getElementById("meat-value");
const hpFillEl = document.getElementById("hp-fill");
const dayIconEl = document.getElementById("day-icon");
const toastEl = document.getElementById("toast");
const moveHintEl = document.getElementById("move-hint");

const world = createWorld();
const save = loadSave();
const state = createState(world, save);

// セーブ済みの壁解放をワールドへ反映(createScene より前に行う)
for (const wall of world.walls ?? []) {
  if (save.unlockedWalls.includes(wall.id)) wall.broken = true;
}

const quests = createQuestTracker(save);
initAudio();

// ---- DOM ユーティリティ(トースト / HUD バンプ) ----

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1800);
}

function bumpMoneyHud() {
  moneyCounterEl.classList.remove("bump");
  void moneyCounterEl.offsetWidth;
  moneyCounterEl.classList.add("bump");
}

const ui = { showToast, bumpMoneyHud };

// 進捗初期化の確定後 true。リロード完了前に自動セーブが走ってもセーブが復活しないようにする
let resetting = false;
const syncSave = () => {
  if (!resetting) flushSave(state, save);
};

// ---- システムの組み立て ----

const combat = createCombat({ state, world, quests, getStats: () => upgrades.stats(), ui });
const production = createProduction({ state, world, save, quests });
const npcs = createNpcs({ state, world, save, damageBear: combat.damageBear });
const upgrades = createUpgrades({ state, world, save, ui, syncSave, syncHunters: npcs.syncHunters });

upgrades.refreshPadCosts();
npcs.syncHunters();
state.unlockedPads = upgrades.computeUnlockedPads();
// 起動時の拠点ステージ適用(createScene は world.camp から柵と地面を作るため、その前に行う)
upgrades.applyCampStage();

const input = createInput(container);
let hintVisible = true;

// ---- 設定メニュー(進捗初期化) ----

const settingsButton = document.getElementById("settings-button");
const settingsMenu = document.getElementById("settings-menu");
const settingsMain = document.getElementById("settings-main");
const settingsConfirm = document.getElementById("settings-confirm");

// input.js は container の touchstart/touchend/mousedown を奪う(touchend は preventDefault で
// click 合成まで消す)ので、メニュー操作は3種とも伝播を止める(こちらで preventDefault はしない)
for (const el of [settingsButton, settingsMenu]) {
  el.addEventListener("touchstart", (e) => e.stopPropagation());
  el.addEventListener("touchend", (e) => e.stopPropagation());
  el.addEventListener("mousedown", (e) => e.stopPropagation());
}

function openSettingsMenu() {
  settingsMenu.classList.remove("menu-hidden");
  settingsMain.classList.remove("menu-hidden");
  settingsConfirm.classList.add("menu-hidden");
}
settingsButton.addEventListener("click", openSettingsMenu);
document.getElementById("settings-close").addEventListener("click", () => {
  settingsMenu.classList.add("menu-hidden");
});
document.getElementById("reset-open").addEventListener("click", () => {
  settingsMain.classList.add("menu-hidden");
  settingsConfirm.classList.remove("menu-hidden");
});
document.getElementById("reset-cancel").addEventListener("click", openSettingsMenu);
document.getElementById("reset-confirm").addEventListener("click", () => {
  // この順を厳守: セーブ停止 → 削除 → リロード(rAF ループの自動セーブで復活させない)
  resetting = true;
  localStorage.removeItem(CONFIG.saveKey);
  location.reload();
});

// カメラが回転しているので、ジョイスティックの上=画面の奥 になるよう入力を回す
const cosA = Math.cos(CAMERA_AZIMUTH);
const sinA = Math.sin(CAMERA_AZIMUTH);
function cameraRelativeMove() {
  const m = input.getMove();
  return {
    x: m.x * cosA + m.y * sinA,
    y: -m.x * sinA + m.y * cosA,
  };
}

// ---- クエスト ----

// 直接加算(クエスト報酬): 札に分割して背中スタックへ直接積む
function gainMoney(amount, x, y) {
  state.player.stack = [...state.player.stack, ...moneyToBills(amount)];
  addText(state, x, y - 40, `+$${amount}`, "#7CFC8a", 22);
  addBillFly(state, x, y);
  bumpMoneyHud();
}

function updateQuests() {
  const done = quests.poll();
  if (done) {
    gainMoney(done.reward, state.player.x, state.player.y);
    state.effects.push({ kind: "burst", x: state.player.x, y: state.player.y, color: "#ffd84d", count: 24, age: 0, life: 0.6 });
    state.effects.push({ kind: "levelup", x: state.player.x, y: state.player.y, text: "クエスト達成!", age: 0, life: 1.1 });
    playSfx("quest");
    showToast(`🎉 クエスト達成！「${done.text}」 報酬 $${done.reward}`);
    syncSave();
  }
  // render がバナー・誘導矢印を描画する契約
  state.quest = quests.hudState(world, state.bears, state.player);
}

// ---- 昼夜サイクル ----

function updateDayCycle(dt) {
  const time = state.time;
  const cycle = CONFIG.day.dayLength + CONFIG.day.nightLength;
  time.t += dt;
  const wasNight = time.isNight;
  time.isNight = time.t % cycle >= CONFIG.day.dayLength;
  if (time.isNight !== wasNight) {
    showToast(time.isNight ? "🌙 夜になった…クマが凶暴化している！" : "☀️ 朝になった！客とハンターが動き出す");
  }
  // 照明用のなめらかな追従値(render が読む)
  const target = time.isNight ? 1 : 0;
  time.nightF += (target - time.nightF) * Math.min(1, dt * 0.5);
}

// ---- HUD ----

function updateEffects(dt) {
  for (const fx of state.effects) fx.age += dt;
  state.effects = state.effects.filter((fx) => fx.age < fx.life);
}

function updateHud(dt, stats) {
  // 金額は背中の札の合計。ロールしながら追いつく
  const money = stackMoney(state.player.stack);
  const diff = money - state.displayMoney;
  if (Math.abs(diff) < 1) {
    state.displayMoney = money;
  } else {
    state.displayMoney += diff * Math.min(1, dt * 10);
  }
  moneyEl.textContent = `${Math.round(state.displayMoney)}`;
  const carried = state.player.stack.filter((i) => i.kind !== "money").length;
  meatEl.textContent = `${carried}/${stats.carryCap}`;

  // HPバー(残量で色が変わる)
  const hpRatio = Math.max(0, state.player.hp / state.player.maxHp);
  hpFillEl.style.width = `${hpRatio * 100}%`;
  hpFillEl.style.background = hpRatio > 0.5 ? "#7CFC8a" : hpRatio > 0.25 ? "#ffd84d" : "#e25555";

  const dayIcon = state.time.isNight ? "🌙" : "☀️";
  if (dayIconEl.textContent !== dayIcon) dayIconEl.textContent = dayIcon;
}

// ---- メインループ ----

const scene = await createScene(canvas, world);

let lastTime = 0;
function loop(time) {
  const rawDt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  // ヒットストップ中は時間をほぼ止める
  state.hitstop = Math.max(0, state.hitstop - rawDt);
  const dt = state.hitstop > 0 ? rawDt * 0.1 : rawDt;
  state.shake = Math.max(0, state.shake - rawDt * 45);
  state.zoomPunch = Math.max(0, state.zoomPunch - rawDt * 2.5);

  const move = cameraRelativeMove();
  if (hintVisible && (move.x !== 0 || move.y !== 0)) {
    hintVisible = false;
    moveHintEl.classList.add("hidden");
  }

  const stats = upgrades.stats();
  const prevX = state.player.x;
  const prevY = state.player.y;
  updatePlayer(state.player, move, dt, stats, world);
  // 静止判定: ランジ/ノックバックの滑走中と実効入力がある間は移動中扱い(微小入力は静止)
  const sliding = Math.hypot(state.player.lungeX, state.player.lungeY) > 40;
  const pushing = Math.hypot(move.x, move.y) * stats.speed > 20;
  state.stillTime = (pushing || sliding) ? 0 : state.stillTime + dt;
  resolveCampCollision(world.camp, prevX, prevY, state.player);
  if (world.walls) resolveWallsCollision(world.walls, prevX, prevY, state.player);
  resolveBlockers(world.blockers, state.player);
  resolveRectBlockers(world.rectBlockers, state.player);

  state.unlockedPads = upgrades.computeUnlockedPads();

  updateDayCycle(dt);      // 昼夜(クマの凶暴化・ハンター/客の休止に効く)
  combat.update(dt);       // クマ・戦闘・回復・ホーミング・地面アイテム
  production.update(dt);   // 加工ステーション・コンベア・カウンター
  upgrades.update(dt);     // パッド/壁パッドへの札払い・拠点拡張
  npcs.update(dt);         // ハンター・客
  combat.updateRespawns(dt);
  updateQuests();
  updateEffects(rawDt);
  updateHud(rawDt, stats);
  state.pickupSfxTimer = Math.max(0, state.pickupSfxTimer - rawDt);
  state.moneySfxTimer = Math.max(0, state.moneySfxTimer - rawDt);

  state.saveTimer += rawDt;
  if (state.saveTimer > 3) {
    state.saveTimer = 0;
    syncSave();
  }

  scene.sync(state, dt, rawDt);
  requestAnimationFrame(loop);
}

window.__game = state; // デバッグ/自動テスト用フック

showToast("クマを倒して肉を集め、💵で施設を強化しよう！");
requestAnimationFrame(loop);
