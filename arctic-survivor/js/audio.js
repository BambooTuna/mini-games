// 効果音: assets/sfx/<name>_<n>.m4a があればファイル再生(同名複数からランダム)、
// 無い名前は WebAudio 合成にフォールバック。
const MASTER_VOLUME = 0.25;

// ファイル化済みの効果音(name -> バリエーション数)。出典: Kenney Impact Sounds / Casino Audio (CC0)
const SFX_FILE_COUNTS = { hit: 5, kill: 5, chop: 5, shatter: 5, pickup: 5, sell: 3, money: 6 };
// 素材ごとの音量差を均すゲイン(volumedetect の実測に基づく。sell/pickup は連続再生されるので控えめ)
const SFX_FILE_GAINS = { hit: 0.75, kill: 0.9, chop: 1.2, shatter: 1.4, pickup: 0.5, sell: 1.0, money: 1.6 };

let ctx = null;
let master = null;
let noiseBuffer = null;
const sfxBuffers = {}; // name -> AudioBuffer[]
let sfxFilesRequested = false;

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
}

function ensureContext() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(ctx.destination);
}

// モバイル自動再生対策: 初回の操作で AudioContext を作成・再開する
export function initAudio() {
  const unlock = () => {
    ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume();
    loadSfxFiles();
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
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
