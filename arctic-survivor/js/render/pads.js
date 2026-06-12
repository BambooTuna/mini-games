// パッドの描画: 強化パッドと壁パッド(エリア解放)の地面デカール(光り/バウンス)、
// DOM ラベル(名前/コスト/進捗)、解放の瞬間の NEW! ポップ。
import { CONFIG } from "../config.js";
import { addDecal, glowDecal, makePadDecalTexture } from "./decals.js";

export function createPads(ctx) {
  const { scene, world, overlay, clock, project } = ctx;

  const padTexture = makePadDecalTexture();

  // ---- 強化パッド ----
  const padDecals = {};
  for (const pad of world.pads) {
    padDecals[pad.key] = addDecal(scene, padTexture, pad.x, pad.y, pad.radius * 2.4);
  }
  const prevPadLevels = {};
  const padBounce = {};
  const prevPadUnlocked = {}; // NEW! ポップ用(undefined の初回は記録のみ)

  // ---- 壁パッド(エリア解放) ----
  const wallPadDecals = []; // {wall, pad, decal}
  for (const wall of world.walls ?? []) {
    if (!wall.pad) continue;
    const decal = addDecal(scene, padTexture, wall.pad.x, wall.pad.y, wall.pad.radius * 2.4);
    decal.visible = wall.broken !== true;
    wallPadDecals.push({ wall, pad: wall.pad, decal });
  }

  // ---- DOM ラベル(HTML 差分更新 + project で追従。強化/壁パッド共通ヘルパー) ----
  function makeLabel() {
    const el = document.createElement("div");
    el.className = "pad-label";
    overlay.appendChild(el);
    return { el, lastHtml: "", hidden: false };
  }

  function setLabelHidden(entry, hidden) {
    if (entry.hidden === hidden) return;
    entry.el.style.display = hidden ? "none" : "";
    entry.hidden = hidden;
  }

  function setLabel(entry, html, x, y) {
    if (entry.lastHtml !== html) {
      entry.el.innerHTML = html;
      entry.lastHtml = html;
    }
    const p = project(x, 4, y);
    entry.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
  }

  const padLabels = {};
  for (const pad of world.pads) padLabels[pad.key] = makeLabel();
  const wallPadLabels = wallPadDecals.map((entry) => ({ entry, label: makeLabel() }));

  // ---- NEW! ポップ(パッド解放の瞬間に出す DOM。要素は遅延生成して使い回す) ----
  const NEWPOP_MAX = 4;
  const newPops = []; // {el, x, y, age, active}

  function spawnNewPop(x, y) {
    let p = newPops.find((q) => !q.active);
    if (!p) {
      if (newPops.length >= NEWPOP_MAX) {
        p = newPops[0]; // 全部使用中なら最古を奪う
      } else {
        const el = document.createElement("div");
        el.className = "fx fx-newpop";
        el.textContent = "NEW!";
        el.style.display = "none";
        overlay.appendChild(el);
        p = { el, x: 0, y: 0, age: 0, active: false };
        newPops.push(p);
      }
    }
    p.x = x;
    p.y = y;
    p.age = 0;
    p.active = true;
    p.el.style.display = "block";
  }

  // 3D デカール(光り/バウンス/解放検知)。カメラ更新前に呼ぶ
  function sync(state, dt, rawDt) {
    const player = state.player;
    const levels = state.save.levels ?? {};

    // 強化パッド: 乗ると緑に光り脈動、レベルアップでバウンス。
    // unlockedPads が無ければ全表示。解放の瞬間(初回フレームを除く)に NEW! ポップ
    for (const pad of world.pads) {
      const unlocked = !state.unlockedPads || state.unlockedPads.includes(pad.key);
      const decal = padDecals[pad.key];
      const prevU = prevPadUnlocked[pad.key];
      if (prevU !== undefined && prevU === false && unlocked) {
        spawnNewPop(pad.x, pad.y);
        padBounce[pad.key] = 0.35; // デカールもバウンス
      }
      prevPadUnlocked[pad.key] = unlocked;
      if (!unlocked) {
        if (decal.visible) decal.visible = false;
        continue;
      }
      if (!decal.visible) decal.visible = true;
      const active = Math.hypot(player.x - pad.x, player.y - pad.y) < pad.radius;
      const lv = levels[pad.key];
      if (prevPadLevels[pad.key] !== undefined && lv !== undefined && lv > prevPadLevels[pad.key]) {
        padBounce[pad.key] = 0.35;
      }
      prevPadLevels[pad.key] = lv;
      let s = glowDecal(decal, active, clock.elapsed);
      const b = padBounce[pad.key] ?? 0;
      if (b > 0) {
        padBounce[pad.key] = Math.max(0, b - rawDt);
        s *= 1 + (b / 0.35) * 0.5; // 1.5 → 1.0
      }
      decal.scale.set(s, s, 1);
    }

    // 壁パッド(broken で非表示、乗ると緑に脈動)
    for (const wp of wallPadDecals) {
      if (wp.wall.broken === true) {
        if (wp.decal.visible) wp.decal.visible = false;
        continue;
      }
      if (!wp.decal.visible) wp.decal.visible = true;
      const active = Math.hypot(player.x - wp.pad.x, player.y - wp.pad.y) < wp.pad.radius;
      const ws = glowDecal(wp.decal, active, clock.elapsed);
      wp.decal.scale.set(ws, ws, 1);
    }
  }

  // DOM ラベルと NEW! ポップ。project を使うのでカメラ更新後に呼ぶ
  function syncOverlay(state, rawDt) {
    // 強化パッドのラベル(未定義 or 未解放の pad は非表示)
    for (const pad of world.pads) {
      const def = CONFIG.upgrades[pad.key];
      const entry = padLabels[pad.key];
      const unlocked = !state.unlockedPads || state.unlockedPads.includes(pad.key);
      if (!def || !unlocked) {
        setLabelHidden(entry, true);
        continue;
      }
      setLabelHidden(entry, false);
      const level = state.save.levels[pad.key] ?? 0;
      const maxed = level >= def.maxLevel;
      const cost = state.padCosts[pad.key];
      const paid = state.padPaid[pad.key];
      const pct = maxed ? 0 : Math.round((paid / cost) * 100);
      const html = maxed
        ? `<span class="icon">${def.icon}</span><b>${def.name} Lv.${level}</b><span class="max">MAX</span>`
        : `<span class="icon">${def.icon}</span><b>${def.name} Lv.${level}</b>` +
          `<span class="cost">💵 ${cost - paid}</span>` +
          `<i style="width:${pct}%"></i>`;
      setLabel(entry, html, pad.x, pad.y);
    }

    // 壁パッド(エリア解放)のラベル。残額 = cost - wallPaid
    for (const wl of wallPadLabels) {
      const { wall, pad } = wl.entry;
      if (wall.broken === true) {
        setLabelHidden(wl.label, true);
        continue;
      }
      setLabelHidden(wl.label, false);
      const paid = state.wallPaid?.[wall.id] ?? 0;
      const remaining = Math.max(0, pad.cost - paid);
      const pct = pad.cost > 0 ? Math.round((paid / pad.cost) * 100) : 0;
      const html =
        `<span class="icon">🧊</span><b>エリア解放</b>` +
        `<span class="cost">💵 ${remaining}</span>` +
        `<i style="width:${pct}%"></i>`;
      setLabel(wl.label, html, pad.x, pad.y);
    }

    // NEW! ポップ(scale ポップ → 浮かびながらフェード)
    for (const np of newPops) {
      if (!np.active) continue;
      np.age += rawDt;
      const NLIFE = 1.0;
      if (np.age >= NLIFE) {
        np.active = false;
        np.el.style.display = "none";
        continue;
      }
      const t = np.age / NLIFE;
      const s = t < 0.2 ? 0.4 + (t / 0.2) : 1.4 - (t - 0.2) * 0.5;
      np.el.style.opacity = `${t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1}`;
      const p = project(np.x, 40 + t * 35, np.y);
      np.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${s})`;
    }
  }

  return { sync, syncOverlay };
}
