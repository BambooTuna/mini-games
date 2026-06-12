// ゲーム状態の構築とセーブへの書き戻し。state が常に正で、save へは flushSave で同期する。
import { CONFIG } from "../config.js";
import { createPlayer, createBear } from "../entities.js";
import { persistSave } from "../save.js";

export function createState(world, save) {
  const state = {
    world,
    save,
    player: createPlayer(world.spawn.x, world.spawn.y),
    bears: world.bearSpawns.map((s) => createBear(s.x, s.y, s.tier, s.respawn)),
    meats: [],          // 地面アイテム(被弾ドロップのみ)
    hunters: [],
    customers: [],      // 客レーンの客NPC
    carryFlights: [],   // 背中へホーミング中のアイテム {id,kind,value,x,y,z,owner,t}
    nextFlightId: 1,
    // 昼夜サイクル。isNight が確定値、nightF は 0(昼)→1(夜)へなめらかに追従(render が照明に使う)
    time: { t: 0, isNight: false, nightF: 0 },
    effects: [],
    respawnQueue: [],   // {spawn, timer}
    // 加工ステーション(save から復元。state が常に正)
    stations: {
      cutboard: {
        input: [...(save.stations?.cutboard?.input ?? [])],
        output: [...(save.stations?.cutboard?.output ?? [])],
        timer: 0, depositTimer: 0, withdrawTimer: 0, beltTimer: 0,
      },
      grill: {
        input: [...(save.stations?.grill?.input ?? [])],
        output: [...(save.stations?.grill?.output ?? [])],
        timer: 0, depositTimer: 0, withdrawTimer: 0, beltTimer: 0,
      },
    },
    // カウンター(預けた焼き肉を sellInterval ごとに自動販売する)
    counter: { input: [...(save.counter?.input ?? [])], timer: 0, depositTimer: 0 },
    padPaid: Object.fromEntries(Object.keys(CONFIG.upgrades).map((k) => [k, 0])),
    padCosts: {},
    padLock: {},         // {[key]: true} レベルアップ直後。パッドから離れるまで次の支払いを止める
    wallPaid: {},        // {[wallId]: 支払い済み額}(render が進捗描画に使う)
    unlockedPads: [],    // 解放済みパッド key(毎フレーム save.levels から導出)
    campStage: 0,        // 拠点の拡張ステージ(render が変化検知して柵を再構築する契約)
    stillTime: 0,        // 静止継続時間(秒)。投入/受取/支払いは静止中のみ発動
    saveTimer: 0,
    hitstop: 0,       // ヒットストップ(時間が一瞬止まる演出)残り秒
    shake: 0,         // 画面シェイク強度
    zoomPunch: 0,     // キル時のズームパンチ(render が camera.zoom に使う)
    displayMoney: 0,  // HUD のロール表示用
    payTimer: 0,         // パッド/氷壁への札払いの間隔(共有して同フレーム二重払いを防ぐ)
    collectTimer: 0,     // カウンター金回収の札切り出し間隔
    pickupSfxTimer: 0,   // アイテム回収音のスロットル
    moneySfxTimer: 0,    // 金回収音のスロットル
    quest: null,         // render が描画するクエスト HUD 状態
    score: 0,            // ラン内スコア(プレイヤーの討伐で加算。ダウンでリセット、セーブしない)
    playerDown: false,   // ダウン中(スコア表示を閉じるまで true。入力とクマのターゲットを止める)
  };
  state.player.stack = [...save.stack];
  return state;
}

// state(player.stack / stations / counter)を save に書き戻してから永続化する。
// 永続化は必ずここを通す(呼び出し側がリセット中ガードを持つ)
export function flushSave(state, save) {
  // 背中へ飛行中の札も繰り入れて保存(リロードで金が消えないように)
  const flyingBills = state.carryFlights
    .filter((f) => f.kind === "money")
    .map((f) => ({ kind: "money", value: f.value }));
  save.stack = [...state.player.stack, ...flyingBills];
  save.stations = {
    cutboard: { input: [...state.stations.cutboard.input], output: [...state.stations.cutboard.output] },
    grill: { input: [...state.stations.grill.input], output: [...state.stations.grill.output] },
  };
  save.counter = { input: [...state.counter.input] };
  persistSave(save);
}
