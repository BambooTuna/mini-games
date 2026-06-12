// DOM オーバーレイ: クエストバナー、クマのHPバー/ボス名タグ、text/coin/levelup エフェクト。
// project を使うのでカメラ更新後に sync する。
import { CONFIG } from "../config.js";

export function createOverlayUi(ctx) {
  const { overlay, project } = ctx;

  // クエストバナー(変化時のみ書き換え)
  const questBanner = document.getElementById("quest-banner");
  let lastQuestHtml = null;

  function updateQuestBanner(state) {
    if (!questBanner) return;
    const q = state.quest;
    if (!q) {
      if (lastQuestHtml !== null) {
        questBanner.classList.add("hidden");
        lastQuestHtml = null;
      }
      return;
    }
    const html =
      `<span class="q-icon">🎯</span><span class="q-text">${q.text ?? ""}</span>` +
      `<b class="q-prog">${q.progress ?? 0}/${q.target ?? 0}</b>`;
    if (lastQuestHtml !== html) {
      questBanner.innerHTML = html;
      questBanner.classList.remove("hidden");
      lastQuestHtml = html;
    }
  }

  const hpBars = new Map();
  const bossTags = new Map();
  const fxPool = [];

  function getFxDiv(i) {
    if (!fxPool[i]) {
      const el = document.createElement("div");
      el.className = "fx";
      overlay.appendChild(el);
      fxPool[i] = el;
    }
    return fxPool[i];
  }

  function sync(state) {
    updateQuestBanner(state);

    // クマのHPバー + ボスの名前タグ
    for (const bear of state.bears) {
      const tier = CONFIG.bear.tiers[bear.tier];
      const isBoss = tier?.boss === true;
      if (isBoss) {
        let tag = bossTags.get(bear.id);
        if (!tag) {
          tag = document.createElement("div");
          tag.className = "boss-tag";
          tag.textContent = tier.name ?? "BOSS";
          overlay.appendChild(tag);
          bossTags.set(bear.id, tag);
        }
        tag.dataset.alive = "1";
        const tp = project(bear.x, 70 * tier.scale + 28, bear.y);
        tag.style.transform = `translate(-50%, -50%) translate(${tp.x}px, ${tp.y}px)`;
      }
      if (bear.hp >= bear.maxHp && !isBoss) continue;
      let bar = hpBars.get(bear.id);
      if (!bar) {
        bar = document.createElement("div");
        bar.className = isBoss ? "hp-bar boss" : "hp-bar";
        bar.innerHTML = "<i></i>";
        overlay.appendChild(bar);
        hpBars.set(bear.id, bar);
      }
      bar.dataset.alive = "1";
      const p = project(bear.x, 70 * tier.scale, bear.y);
      bar.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      bar.firstChild.style.width = `${Math.max(4, (bear.hp / bear.maxHp) * 100)}%`;
    }
    // ハンターのHPバー(減っている間だけ表示。スイープはクマと共通)
    for (const hunter of state.hunters ?? []) {
      if (hunter.hp >= hunter.maxHp) continue;
      let bar = hpBars.get(hunter.id);
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "hp-bar";
        bar.innerHTML = "<i></i>";
        overlay.appendChild(bar);
        hpBars.set(hunter.id, bar);
      }
      bar.dataset.alive = "1";
      const p = project(hunter.x, 82, hunter.y);
      bar.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      bar.firstChild.style.width = `${Math.max(4, (hunter.hp / hunter.maxHp) * 100)}%`;
    }

    for (const [id, bar] of hpBars) {
      if (!bar.dataset.alive) {
        bar.remove();
        hpBars.delete(id);
      } else {
        delete bar.dataset.alive;
      }
    }
    for (const [id, tag] of bossTags) {
      if (!tag.dataset.alive) {
        tag.remove();
        bossTags.delete(id);
      } else {
        delete tag.dataset.alive;
      }
    }

    // エフェクト(DOM で描くのは text / coin / levelup のみ。他 kind は 3D 側で処理)
    let fi = 0;
    for (const fx of state.effects) {
      if (fx.kind !== "text" && fx.kind !== "coin" && fx.kind !== "levelup") continue;
      const t = fx.age / fx.life;
      const el = getFxDiv(fi++);
      el.style.display = "block";
      el.style.opacity = `${1 - t}`;
      if (fx.kind === "text") {
        el.className = "fx";
        el.textContent = fx.text;
        el.style.color = fx.color;
        el.style.fontSize = `${fx.size}px`;
        const p = project(fx.x, 60, fx.y);
        el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y - t * 50}px)`;
      } else if (fx.kind === "coin") {
        el.className = "fx";
        el.textContent = "💵";
        el.style.color = "";
        el.style.fontSize = "24px";
        const x = fx.x + (fx.tx - fx.x) * t;
        const y = fx.y + (fx.ty - fx.y) * t;
        const p = project(x, 40 + Math.sin(t * Math.PI) * 70, y);
        const s = t < 0.2 ? 0.4 + t * 3 : 1; // 出現時にスケールポップ
        el.style.transform =
          `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) rotate(${t * 540}deg) scale(${s})`;
      } else {
        el.className = "fx fx-levelup";
        el.textContent = fx.text ?? "";
        el.style.color = "";
        el.style.fontSize = "28px";
        const s = 1 + 0.6 * Math.max(0, 1 - t * 3); // scale 1.6 → 1.0 に落ち着く
        const p = project(fx.x, 70, fx.y);
        el.style.transform =
          `translate(-50%, -50%) translate(${p.x}px, ${p.y - t * 70}px) scale(${s})`;
      }
    }
    for (let i = fi; i < fxPool.length; i++) fxPool[i].style.display = "none";
  }

  return { sync };
}
