// グリッドA*ナビゲーション: 柵・氷壁・木などのブロッカーを迂回する経路を返す。
// 方針は「直線で行けるならそのまま、塞がっていたら粗いグリッドのA*で遠回り」。
// グリッドは2種: hunter(ゲートだけ通れる)と bear(拠点全体が進入禁止)。
// 拠点拡張・壁破壊・開拓でレイアウトが変わるとバージョンキーで検知して再構築する。
import { insideCamp } from "./world.js";

const CELL = 40;
const MARGIN = 26; // ブロッカーの押し出し半径(r+14)+キャラ半径ぶんの安全マージン
const WALL_MARGIN = 24; // 壁・柵の線分からこの距離内のセルは通行不可
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export function createNavigator(world) {
  const cols = Math.ceil(world.width / CELL);
  const rows = Math.ceil(world.height / CELL);
  const size = cols * rows;
  let grids = null;
  let version = "";
  const recs = new Map(); // entityId → 経路キャッシュ

  const cellX = (x) => Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
  const cellY = (y) => Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
  const centerX = (cx) => cx * CELL + CELL / 2;
  const centerY = (cy) => cy * CELL + CELL / 2;

  function worldVersion() {
    const c = world.camp;
    const broken = (world.walls ?? []).map((w) => (w.broken ? 1 : 0)).join("");
    return `${c.x1},${c.y1},${c.x2},${c.y2}|${broken}|${world.blockers.length}`;
  }

  // 拠点の柵: 4辺の近傍セルを塞ぐ。allowGate なら南辺のゲート開口部だけ通す
  function campFenceBlocked(camp, x, y, allowGate) {
    const spanX = x > camp.x1 - WALL_MARGIN && x < camp.x2 + WALL_MARGIN;
    const spanY = y > camp.y1 - WALL_MARGIN && y < camp.y2 + WALL_MARGIN;
    if (spanX && Math.abs(y - camp.y2) < WALL_MARGIN) {
      return !(allowGate && Math.abs(x - camp.gate.x) < camp.gate.halfW - 20);
    }
    if (spanX && Math.abs(y - camp.y1) < WALL_MARGIN) return true;
    if (spanY && Math.abs(x - camp.x1) < WALL_MARGIN) return true;
    if (spanY && Math.abs(x - camp.x2) < WALL_MARGIN) return true;
    return false;
  }

  function buildGrids() {
    const hunter = new Uint8Array(size);
    const bear = new Uint8Array(size);
    const walls = (world.walls ?? []).filter((w) => !w.broken);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = centerX(cx);
        const y = centerY(cy);
        const i = cy * cols + cx;
        let blocked = 0;
        for (const b of world.blockers) {
          const m = b.r + MARGIN;
          if (Math.abs(x - b.x) < m && Math.abs(y - b.y) < m && Math.hypot(x - b.x, y - b.y) < m) {
            blocked = 1;
            break;
          }
        }
        if (!blocked) {
          for (const b of world.rectBlockers) {
            if (Math.abs(x - b.x) < b.hw + MARGIN && Math.abs(y - b.y) < b.hh + MARGIN) {
              blocked = 1;
              break;
            }
          }
        }
        if (!blocked) {
          outer: for (const w of walls) {
            for (const s of w.segments) {
              const dx = x - Math.max(Math.min(s.x1, s.x2), Math.min(Math.max(s.x1, s.x2), x));
              const dy = y - Math.max(Math.min(s.y1, s.y2), Math.min(Math.max(s.y1, s.y2), y));
              if (Math.hypot(dx, dy) < WALL_MARGIN) {
                blocked = 1;
                break outer;
              }
            }
          }
        }
        hunter[i] = blocked || (campFenceBlocked(world.camp, x, y, true) ? 1 : 0);
        bear[i] = blocked || (insideCamp(world.camp, x, y, WALL_MARGIN) ? 1 : 0);
      }
    }
    grids = { hunter, bear };
  }

  function ensure() {
    const v = worldVersion();
    if (!grids || v !== version) {
      version = v;
      buildGrids();
      recs.clear();
    }
  }

  // 直線見通し: 線分上を半セル刻みでサンプリングして全セルが通行可か見る
  function los(grid, x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(d / (CELL / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = cellX(x1 + (x2 - x1) * t);
      const cy = cellY(y1 + (y2 - y1) * t);
      if (grid[cy * cols + cx]) return false;
    }
    return true;
  }

  // 始点/終点が塞がったセルに居る場合、リング状に探して最寄りの空きセルへ寄せる
  function nearestFree(grid, cx, cy) {
    if (!grid[cy * cols + cx]) return cy * cols + cx;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (!grid[ny * cols + nx]) return ny * cols + nx;
        }
      }
    }
    return -1;
  }

  // 経路の角を直線見通しでショートカットする(セル中心のギザギザを均す)
  function smooth(grid, pts, sx, sy) {
    const out = [];
    let cur = { x: sx, y: sy };
    let i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && los(grid, cur.x, cur.y, pts[j + 1].x, pts[j + 1].y)) j++;
      out.push(pts[j]);
      cur = pts[j];
      i = j + 1;
    }
    return out;
  }

  // 8方向A*(斜めの角抜けは禁止)。waypoint のワールド座標列を返す
  function findPath(grid, sx, sy, ex, ey) {
    const start = nearestFree(grid, cellX(sx), cellY(sy));
    const goal = nearestFree(grid, cellX(ex), cellY(ey));
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [];
    const gx = goal % cols;
    const gy = (goal / cols) | 0;
    const g = new Float64Array(size).fill(Infinity);
    const f = new Float64Array(size);
    const came = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const heur = (cx, cy) => {
      const ax = Math.abs(cx - gx);
      const ay = Math.abs(cy - gy);
      return Math.max(ax, ay) + 0.414 * Math.min(ax, ay);
    };
    g[start] = 0;
    f[start] = heur(start % cols, (start / cols) | 0);
    const open = [start];
    let found = false;
    let guard = 0;
    while (open.length && guard++ < 8000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % cols;
      const cy = (cur / cols) | 0;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (grid[ni] || closed[ni]) continue;
        if (dx && dy && (grid[cy * cols + nx] || grid[ny * cols + cx])) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          f[ni] = ng + heur(nx, ny);
          came[ni] = cur;
          open.push(ni);
        }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let i = goal; i !== -1 && i !== start; i = came[i]) {
      pts.push({ x: centerX(i % cols), y: centerY((i / cols) | 0) });
    }
    pts.reverse();
    return smooth(grid, pts, sx, sy);
  }

  // 毎フレーム呼ぶ。このフレームで向かうべき座標を返す。
  // 経路はエンティティごとにキャッシュし、目標移動・時間経過・スタックで引き直す
  function next(e, tx, ty, dt, kind = "hunter") {
    ensure();
    const grid = grids[kind];
    if (recs.size > 300) recs.clear();
    let rec = recs.get(e.id);
    if (!rec) {
      rec = { tx, ty, path: null, idx: 0, repathT: 0, lastX: e.x, lastY: e.y, stuckT: 0 };
      recs.set(e.id, rec);
    }
    // スタック検出: 移動中フラグが立っているのにほぼ進んでいない
    const moved = Math.hypot(e.x - rec.lastX, e.y - rec.lastY);
    rec.lastX = e.x;
    rec.lastY = e.y;
    rec.stuckT = e.moving && moved < 30 * dt ? rec.stuckT + dt : 0;

    rec.repathT -= dt;
    const retarget = Math.hypot(tx - rec.tx, ty - rec.ty) > 60;
    if (rec.repathT <= 0 || retarget || rec.stuckT > 0.6) {
      rec.tx = tx;
      rec.ty = ty;
      rec.repathT = 0.6 + Math.random() * 0.4;
      rec.stuckT = 0;
      rec.path = los(grid, e.x, e.y, tx, ty) ? null : findPath(grid, e.x, e.y, tx, ty);
      rec.idx = 0;
    }
    if (!rec.path) return { x: tx, y: ty };
    while (
      rec.idx < rec.path.length &&
      Math.hypot(rec.path[rec.idx].x - e.x, rec.path[rec.idx].y - e.y) < 26
    ) {
      rec.idx++;
    }
    return rec.idx < rec.path.length ? rec.path[rec.idx] : { x: tx, y: ty };
  }

  return { next };
}
