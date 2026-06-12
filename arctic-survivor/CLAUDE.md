# Arctic Survivor(Whiteout Survival 風ミニゲーム)

Three.js r170(vendor/ に同梱)+ 素の ES Modules。ビルドなし、`index.html` を静的配信するだけで動く。
モバイルタッチ + PC(WASD/マウス)対応。

## アーキテクチャ(3層 + 共有データ)

ロジック層は `state` を更新するだけ、描画層は `state` を読むだけの一方向データフロー。
層をまたぐ受け渡しはすべて `state` のフィールド経由で行う(描画層からロジックを呼ばない)。

```
js/
├── main.js              エントリ。配線とゲームループ、DOM(HUD/トースト/設定メニュー)のみ
│
├── config.js            ゲームバランスと定数(調整はすべてここ)
├── save.js              localStorage セーブ/ロード + マイグレーション
├── input.js             ジョイスティック/キーボード入力 → getMove()
├── audio.js             WebAudio 合成効果音(外部アセットなし)
├── quests.js            クエストチェーンの進行と HUD 状態
├── world.js             マップレイアウト(拠点/氷壁/施設/巣/装飾)と衝突解決
├── entities.js          エンティティの生成と更新(プレイヤー/クマ/ハンター/客/地面アイテム)
├── models.js            ローポリ3Dモデルのカタログ(assets/models/<key>.glb で差し替え可)
│
├── game/                ロジック層(state を更新。Three.js に依存しない)
│   ├── state.js         state の構築と save への書き戻し(flushSave)
│   ├── helpers.js       共通ヘルパー: 演出 push・札束操作・札払いストリーム・ゾーン投入・SFXスロットル
│   ├── combat.js        戦闘: プレイヤー攻撃/クマ/討伐/リスポーン/ホーミング/地面アイテム
│   ├── production.js    生産: 加工ステーション(投入→加工→取出)とカウンター(販売/金回収)
│   ├── upgrades.js      進行: パッド/壁パッドへの札払い・コスト・パッド解放・拠点の段階拡張
│   └── npcs.js          NPC: ハンター(討伐→納品)と客(来店サイクル)
│
└── render/              描画層(state を読んで Three.js シーンと DOM オーバーレイを同期)
    ├── scene.js         エントリ(createScene)。renderer/カメラ/ライト/地面、ctx でサブモジュールを束ねる
    ├── decals.js        地面デカール生成ヘルパー(Canvas テクスチャ、緑発光の共通処理)
    ├── effects3d.js     burst/ring パーティクル、itemFly/carryFlights のメッシュプール
    ├── environment.js   拠点(土・柵)と拡張演出、氷壁タイル/破壊アニメ、装飾/開拓、降雪
    ├── stations3d.js    施設: カウンター/トレイ/ゾーン/チェブロン、ティア進化モデル、台上の山
    ├── actors.js        キャラ: プレイヤー/クマ/ハンター/客のプール、背中スタックチェーン、誘導矢印
    ├── pads.js          パッドのデカール + DOM ラベル + NEW! ポップ
    └── overlay.js       DOM: クエストバナー、HPバー/ボスタグ、text/coin/levelup エフェクト
```

### render/ の作法

- 各サブモジュールは `create○○(ctx)` で初期化し `{ sync(state, dt, rawDt) }` を返す。
  `ctx` = `{ scene, camera, world, overlay, camTarget, project, clock, fx }`(scene.js が組み立て)
- `project()`(ワールド→画面px)を使う DOM 系の sync はカメラ更新後に呼ぶ(scene.js が順序を保証)
- バースト演出は `ctx.fx.spawnBurst(...)` を借りる

### 層間の主な契約

- `state.campStage` / `world.camp` 寸法: game/upgrades が拡張を適用し、render/environment が寸法変化を検知して柵を再構築 + 開拓対象(`clearable`)を伐採演出で消す
- `state.quest`: main が quests.hudState() を毎フレーム書き込み、render(overlay/actors)がバナーと誘導矢印を描く
- `state.time`(昼夜): main の updateDayCycle が isNight/nightF を更新。render/scene が照明を補間、environment が火明かりを増幅、game 側は npcs(ハンター/客の休止)と combat(クマの夜間凶暴化)が読む
- `world.campfire`: 回復・休憩地点。combat(プレイヤーの回復/ダウン送還)と npcs(ハンターの休憩位置)が共有
- HP: プレイヤー/ハンターは entities が hp/maxHp を持ち combat が増減。バーはすべて render/overlay の頭上表示(HUD にゲージは置かない)
- 拠点=安全圏: combat が拠点内のプレイヤー/ハンターをクマのターゲットから除外(全員安全圏なら target=null で徘徊)。クマの柵衝突は `resolveCampCollision(..., allowGate=false)` でゲートも通さない
- ベルトコンベア: `CONFIG.conveyor.unlockLevel` 以上で game/production が自動搬送、render/stations3d がベルトを描画(搬送演出は itemFly の `flat:true`)
- 所持上限(非マネー): `CONFIG.upgrades.boots.carry(lv)`。combat(magnet/着弾)と production(取出)がゲートする
- モデルの名前契約: `"flame"`(加工中のみ表示+揺らぎ)、`"spin"`(加工中に回転)、`"weapon"`/`"axehead"`(スイング/成長)、`"firelight"`(焚き火の揺らぎ)
- セーブの永続化は必ず game/state.js の `flushSave` 経由(main の `syncSave` がリセット中ガードを持つ)

## 座標系

- ロジックは 2D (x, y)。ワールド 3200×1800、拠点基準 baseX=992 / baseY=900
- Three.js では (x, y) → (x, z)、高さが y。カメラは Orthographic + 方位角 0.55

## 開発メモ

- `window.__game` = state(デバッグ/自動テスト用フック)
- 起動時に assets/models/*.glb を HEAD で探索するため 404 が並ぶのは仕様(GLB を置けば差し替わる)
- 動作検証は Playwright + ローカル静的サーバー(一時ポートを使い、終了時に必ず止める)
- ファイルは機能/ドメイン別に分け、200〜400行を目安にする(モデルカタログ等の列挙系は例外)
