// 効果音: assets/sfx/<name>_<n>.m4a があればファイル再生(同名複数からランダム)、
// 無い名前は WebAudio 合成にフォールバック。
const MASTER_VOLUME = 0.25;

// ファイル化済みの効果音(name -> バリエーション数)。
// 出典: Kenney Impact Sounds / Casino Audio (CC0)、sizzle は Pixabay (frying steak)
const SFX_FILE_COUNTS = { hit: 5, kill: 5, chop: 5, shatter: 5, pickup: 5, sell: 3, money: 5, pay: 4, sizzle: 3 };
// 素材ごとの音量差を均すゲイン(volumedetect の実測に基づく。sell/pickup は連続再生されるので控えめ)
const SFX_FILE_GAINS = { hit: 0.75, kill: 0.9, chop: 1.2, shatter: 1.4, pickup: 0.5, sell: 1.0, money: 0.7, pay: 1.3, sizzle: 0.6 };

// アンビエントループ(kind -> 素材と減衰)。radius はワールド単位(プレイヤー身長=50)で聞こえる距離
const AMBIENT_DEFS = {
  fire: { url: "assets/sfx/ambient_fire.m4a", gain: 1.2, radius: 380 },
  sizzle: { url: "assets/sfx/ambient_sizzle.m4a", gain: 0.9, radius: 320 },
};

// BGM(常時ループ。設定で切替・OFF 可能。すべて CC0)。id "off" は無音
const BGM_TRACKS = {
  snow: { url: "assets/sfx/bgm_snow.m4a", gain: 0.45 },    // 雪のテーマ(穏やかなメロディ。やや主張強め)
  calm: { url: "assets/sfx/bgm_calm.m4a", gain: 0.45 },    // 雪のテーマ(スロー版・より静か)
  ambient: { url: "assets/sfx/bgm_ambient.m4a", gain: 0.8 }, // ローファイのアンビエント(既定)
};
const BGM_PREF_KEY = "arctic-survivor-bgm";
const DEFAULT_BGM = "ambient";

let ctx = null;
let master = null;
let noiseBuffer = null;
const sfxBuffers = {}; // name -> AudioBuffer[]
const ambientBuffers = {}; // kind -> AudioBuffer
const ambientNodes = new Map(); // id -> {src, gain}
const bgmBuffers = {}; // id -> AudioBuffer
let sfxFilesRequested = false;

// ---- BGM ----
let bgmGain = null;   // BGM 専用のゲイン(master の手前)
let bgmSource = null; // 現在鳴っているループ source
let bgmTrack = null;  // 現在の id("off" or BGM_TRACKS のキー)

export function getBgmTrack() {
  try {
    return localStorage.getItem(BGM_PREF_KEY) ?? DEFAULT_BGM;
  } catch {
    return DEFAULT_BGM;
  }
}

// トラックを切り替える(UI から呼ぶ)。"off" で停止。設定は localStorage に保存
export function setBgmTrack(id) {
  try { localStorage.setItem(BGM_PREF_KEY, id); } catch {}
  startBgm(id);
}

function startBgm(id) {
  if (!ctx || ctx.state !== "running" || !bgmGain) return;
  if (bgmSource) {
    try { bgmSource.stop(); } catch {}
    bgmSource = null;
  }
  bgmTrack = id;
  const def = BGM_TRACKS[id];
  const buf = def && bgmBuffers[id];
  if (!def || !buf) return; // "off" や未ロードなら無音のまま
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = 0.05;             // AAC のプライミングぶんを避けて継ぎ目のプチを抑える
  src.loopEnd = buf.duration - 0.05;
  bgmGain.gain.value = def.gain;
  src.connect(bgmGain);
  src.start();
  bgmSource = src;
}

function loadSfxFiles() {
  if (sfxFilesRequested || !ctx) return;
  sfxFilesRequested = true;
  for (const [name, count] of Object.entries(SFX_FILE_COUNTS)) {
    for (let i = 0; i < count; i++) {
      fetch(`assets/sfx/${name}_${i}.m4a`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((buf) => ctx.decodeAudioData(buf))
        .then((decoded) => {
          (sfxBuffers[name] ??= []).push(decoded);
        })
        .catch(() => {}); // 読めない環境では合成音のまま
    }
  }
  for (const [kind, def] of Object.entries(AMBIENT_DEFS)) {
    fetch(def.url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { ambientBuffers[kind] = decoded; })
      .catch(() => {}); // 無ければアンビエントなしで動く
  }
  // BGM: 設定中のトラックを先に読み、デコードできたら再生開始
  const want = getBgmTrack();
  for (const [id, def] of Object.entries(BGM_TRACKS)) {
    fetch(def.url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        bgmBuffers[id] = decoded;
        if (id === want && !bgmSource) startBgm(id); // 選択中トラックが揃ったら鳴らす
      })
      .catch(() => {}); // 無ければ BGM なしで動く
  }
}

// アンビエントの距離減衰更新(毎フレーム呼ばれる)。
// sources: [{id, kind, x, y, on?}](位置は固定前提。on=false で消音し、ノードは作ったら使い回す)
export function updateAmbients(sources, listenerX, listenerY) {
  if (!ctx || ctx.state !== "running") return;
  for (const s of sources) {
    const def = AMBIENT_DEFS[s.kind];
    const buf = ambientBuffers[s.kind];
    if (!def || !buf) continue;
    let node = ambientNodes.get(s.id);
    if (!node) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // AAC のエンコーダ付加サンプルで継ぎ目が鳴らないよう端を避けてループ
      src.loopStart = 0.06;
      src.loopEnd = buf.duration - 0.06;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(master);
      src.start(0, Math.random() * buf.duration); // 複数源が同位相にならないようずらす
      node = { src, gain };
      ambientNodes.set(s.id, node);
    }
    const d = Math.hypot(s.x - listenerX, s.y - listenerY);
    const falloff = Math.max(0, 1 - d / def.radius);
    const target = (s.on === false ? 0 : 1) * falloff * falloff * def.gain;
    node.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  }
}

function ensureContext() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(ctx.destination);
  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0;
  bgmGain.connect(master);
}

// iOS のマナーモード(消音スイッチ)中は WebAudio が無音になるため、
// 無音の <audio> をループ再生して再生カテゴリへ切り替える(成功するまで操作のたびに再試行)
let silentKeepalive = null;

function startSilentKeepalive() {
  if (silentKeepalive) return;
  const a = document.createElement("audio");
  a.setAttribute("playsinline", "");
  a.loop = true;
  a.src = "assets/sfx/silence.m4a";
  silentKeepalive = a;
  a.play().catch(() => { silentKeepalive = null; });
}

// モバイル自動再生対策: 初回の操作で AudioContext を作成・再開する。
// iOS Safari は pointerdown を音声解放のジェスチャとして扱わないことがあるため
// touchend / click でも解放する
export function initAudio() {
  const unlock = () => {
    ensureContext();
    if (ctx && ctx.state !== "running") ctx.resume();
    loadSfxFiles();
    startSilentKeepalive();
    // resume が初回 unlock 後に running になった場合に備え、ロード済みなら BGM を起こす
    const want = getBgmTrack();
    if (ctx && ctx.state === "running" && !bgmSource && bgmBuffers[want]) startBgm(want);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("touchend", unlock);
  window.addEventListener("click", unlock);
  window.addEventListener("keydown", unlock);
  // バックグラウンド復帰で interrupted のまま止まる対策
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state !== "running") ctx.resume();
  });
}

function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.25);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function tone({ type = "sine", freq, freqEnd = 0, delay = 0, duration, gain }) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd > 0) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function noiseBurst({ cutoff, delay = 0, duration, gain }) {
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

const SFX = {
  // 打撃: 短いノイズ + 低音 thud
  hit() {
    noiseBurst({ cutoff: 1400, duration: 0.06, gain: 0.3 });
    tone({ type: "sine", freq: 130, freqEnd: 65, duration: 0.09, gain: 0.5 });
  },
  // 討伐: 深い thump
  kill() {
    noiseBurst({ cutoff: 500, duration: 0.18, gain: 0.4 });
    tone({ type: "sine", freq: 95, freqEnd: 35, duration: 0.3, gain: 0.8 });
  },
  // 肉回収: ポップな blip(ピッチ少し乱数)
  pickup() {
    const base = 520 * (0.9 + Math.random() * 0.25);
    tone({ type: "triangle", freq: base, freqEnd: base * 1.8, duration: 0.08, gain: 0.3 });
  },
  // 売却: 軽いチャリン(連続再生されるので控えめに)
  sell() {
    tone({ type: "sine", freq: 1320, duration: 0.07, gain: 0.12 });
    tone({ type: "sine", freq: 1980, delay: 0.02, duration: 0.06, gain: 0.08 });
  },
  // 支払い: 紙幣が滑り出る短いノイズ
  pay() {
    noiseBurst({ cutoff: 3200, duration: 0.08, gain: 0.15 });
  },
  // レベルアップ: 上昇アルペジオ
  levelup() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      tone({ type: "triangle", freq, delay: i * 0.08, duration: 0.16, gain: 0.35 });
    });
  },
  // 金回収: 強めのチャリン(売却の sell より華やか)
  money() {
    const base = 1568 * (0.95 + Math.random() * 0.1);
    tone({ type: "sine", freq: base, duration: 0.1, gain: 0.3 });
    tone({ type: "sine", freq: base * 1.5, delay: 0.03, duration: 0.12, gain: 0.2 });
    tone({ type: "triangle", freq: base * 2, delay: 0.05, duration: 0.09, gain: 0.1 });
  },
  // 氷壁の砕け: 高域ノイズのクラッシュ + 落ちる低音
  shatter() {
    noiseBurst({ cutoff: 6000, duration: 0.3, gain: 0.5 });
    noiseBurst({ cutoff: 2400, delay: 0.06, duration: 0.25, gain: 0.3 });
    tone({ type: "triangle", freq: 1900, freqEnd: 320, duration: 0.28, gain: 0.25 });
    tone({ type: "sine", freq: 200, freqEnd: 55, duration: 0.4, gain: 0.55 });
  },
  // スライス台の加工: 短いコッ(まな板を叩く音)
  chop() {
    noiseBurst({ cutoff: 2200, duration: 0.05, gain: 0.25 });
    tone({ type: "square", freq: 220, freqEnd: 110, duration: 0.06, gain: 0.3 });
  },
  // 焼き台の加工: ジュッ(短いノイズ)
  sizzle() {
    noiseBurst({ cutoff: 5200, duration: 0.22, gain: 0.18 });
    noiseBurst({ cutoff: 2600, delay: 0.05, duration: 0.12, gain: 0.1 });
  },
  // クエスト達成: 短いファンファーレ
  quest() {
    tone({ type: "square", freq: 523, duration: 0.12, gain: 0.18 });
    tone({ type: "square", freq: 659, delay: 0.12, duration: 0.12, gain: 0.18 });
    tone({ type: "square", freq: 784, delay: 0.24, duration: 0.1, gain: 0.18 });
    tone({ type: "square", freq: 1047, delay: 0.34, duration: 0.3, gain: 0.22 });
  },
};

export function playSfx(name) {
  if (!ctx || ctx.state !== "running") return;
  const buffers = sfxBuffers[name];
  if (buffers?.length) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    src.playbackRate.value = 0.95 + Math.random() * 0.1; // 連打の機械っぽさを散らす
    const g = ctx.createGain();
    g.gain.value = SFX_FILE_GAINS[name] ?? 1;
    src.connect(g);
    g.connect(master);
    src.start();
    return;
  }
  SFX[name]?.();
}
