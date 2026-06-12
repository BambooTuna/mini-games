# 3Dモデル差し替えガイド

`assets/models/<key>.glb` を置くだけで GLTFLoader が読み込み、コード製モデルより優先されます
（ファイルが無いキーは自動でコード製モデルにフォールバック。コード変更不要）。
読み込み時に `js/models.js` の `GLB_SPECS` で目安サイズへ自動正規化（スケール・足元原点合わせ）されるため、
元モデルの大きさは気にしなくてよい。新キーを足す場合は GLB_SPECS に目安サイズを追記する。

## 適用済みの外部アセット（すべて CC0、クレジット不要・商用可）

| キー | 出典 |
| --- | --- |
| `player`(Knight) / `hunter`(Barbarian) / `customer`(Rogue_Hooded) | [KayKit Character Pack: Adventurers](https://kaylousberg.itch.io/kaykit-adventurers)（同梱武器は handslot 非表示、Idle ポーズ静的適用、コード製オノ装着） |
| `tree` / `rock` / `snowpile` | [Kenney Holiday Kit](https://kenney.nl/assets/holiday-kit) |
| `crate` / `tent` / `campfire` | [Kenney Survival Kit](https://kenney.nl/assets/survival-kit)（campfire は炎・光をコードで追加） |

- Kenney 製 glb はテクスチャ外部参照のため `assets/models/Textures/colormap_{survival,holiday}.png` が必要
  （両キットが同名 `Textures/colormap.png` を参照していて衝突するため、glb 内の URI をキット別に書き換え済み）
- 元パック一式は `assets_src/` に保管（他のモデルへの差し替え候補あり）。`_preview.html` で各モデルを並べて確認できる
- KayKit キャラはアニメーションクリップ75種を同梱。歩行・攻撃モーションの再生は未実装（AnimationMixer 対応が必要）

## キー一覧

| キー | 内容 | 目安サイズ |
| --- | --- | --- |
| `player` | 主人公（青いコートの人間、右手にオノ） | 身長 ≈ 50 |
| `hunter` | 雇える狩人（緑コートの人間、player の色違い） | 身長 ≈ 50 |
| `bear_t1` | ホッキョクグマ（弱・白） | 体長 ≈ 70 |
| `bear_t2` | ホッキョクグマ（中・グレー、怒り顔） | 体長 ≈ 70 |
| `bear_t3` | ホッキョクグマ（強・濃グレー、赤目） | 体長 ≈ 70 |
| `bear_t4` | ボスグマ（濃色、赤目、傷、牙。スケールは config 側で拡大） | 体長 ≈ 70 |
| `meat` | 生肉（骨付き肉。kind=raw のアイテム） | 幅 ≈ 20 |
| `meat_slice` | スライス肉（薄いピンクの板。kind=slice のアイテム） | 幅 ≈ 14 / 高さ ≈ 3 |
| `meat_cooked` | 焼き肉（茶ブロック＋焼き目2トーン。kind=cooked のアイテム） | 幅 ≈ 14 / 高さ ≈ 7 |
| `tree` | 雪をかぶった針葉樹（装飾） | 高さ ≈ 100 |
| `rock` | 雪をかぶった岩（装飾） | 幅 ≈ 40 |
| `crate` | 木箱（装飾） | 一辺 ≈ 36 |
| `counter` | 売りカウンター（木の台＋ポール＋赤白ストライプの小庇。西柵に埋め込み） | 長辺 ≈ 220 / 奥行 ≈ 44 / 高さ ≈ 40 |
| `cutboard` | スライス台（木の台＋まな板＋包丁） | 幅 ≈ 62 |
| `grill` | 焼き台（石の土台＋炭＋焼き網＋炎。炎メッシュ名 `flame` を維持すること） | 幅 ≈ 56 |
| `igloo` | イグルー（装飾） | 直径 ≈ 90 |
| `iceshard` | 氷塊（半透明水色の尖ったクラスタ、装飾） | 高さ ≈ 46 |
| `snowpile` | 雪山（つぶれた球の重なり、装飾） | 幅 ≈ 50 |
| `deadtree` | 枯れ木（幹＋裸の枝、装飾） | 高さ ≈ 60 |
| `bones` | 骨（肋骨アーチ＋骨片。クマの巣の装飾） | 幅 ≈ 70 |
| `tent` | テント（三角プリズム、入口は +Z 向き） | 高さ ≈ 51 |
| `campfire` | 焚き火（石の輪＋薪＋炎。炎メッシュ名 `flame`、ライト名 `firelight` を維持すること） | 直径 ≈ 55 |
| `logpile` | 薪の山（円柱の積み重ね、装飾） | 幅 ≈ 44 |
| `path` | 踏み固められた道（平面。影を落とさない設定） | 約 46×90 |
| `icewall` | 氷壁タイル（半透明の氷＋雪の被り。zone0 を囲む壁にタイル状に並ぶ） | 幅 ≈ 110 / 高さ ≈ 75 / 厚み ≈ 26 |
| `money` | 札束（緑の束＋帯。カウンター上の金の山用） | 幅 ≈ 18 |
| `customer` | 村人（コート色は茶/赤/紫などからランダム、武器なし） | 身長 ≈ 50 |

## スケール・座標の約束

- 1 ユニット = 旧 2D 版の 1px 相当（人間の身長 ≈ 50 ユニット、クマ体長 ≈ 70 ユニットが基準）
- 足元が原点（y = 0）、前方は +Z
- 当たり判定は `js/config.js` の radius 基準なので、見た目を大きく変える場合はそちらも調整してください

## .glb の入手・作成手段の例

- **Blender** でモデリングして glTF Binary (.glb) でエクスポート
- **3D生成AI**（Meshy、Tripo など）でテキスト/画像から生成して .glb ダウンロード
- **Sketchfab** などの CC0 / 商用可ライセンスの無料アセットをダウンロード

## 効果音

`assets/sfx/<name>_<n>.m4a` があればファイル再生（同名複数からランダム）、無い名前は WebAudio 合成に
フォールバックする（`js/audio.js`）。適用済み: hit / kill / chop / shatter / pickup / sell / money
（出典: [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) と
[Kenney Casino Audio](https://kenney.nl/assets/casino-audio)、CC0。ogg から m4a へ変換済み — Safari が
Ogg Vorbis をデコードできないため）。levelup / quest / sizzle は合成音のまま。
差し替え・追加は同じ命名でファイルを置き、`js/audio.js` の `SFX_FILE_COUNTS` を合わせるだけ。

## 旧 2D アセットについて

`assets/svg/` と `assets/img/` は旧 Canvas 2D 版の名残で現在は未使用ですが、
将来 UI やテクスチャに流用できるためそのまま残しています。
