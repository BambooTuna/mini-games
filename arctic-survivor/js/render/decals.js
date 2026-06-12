// 地面デカール(平面メッシュ + Canvas テクスチャ)の生成ヘルパー。状態は持たない。
import * as THREE from "three";

// 地面に貼る半透明デカール。h 省略で正方形
export function addDecal(scene, texture, x, y, w, h = w) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: 0.85, depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 1.6, y);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}

// 「乗ると緑に光って脈動」の共通処理(ゾーン/パッド/壁パッドで共有)。
// 色と不透明度を適用し、推奨スケールを返す(呼び出し側でバウンス等を掛けてから適用する)
export function glowDecal(decal, active, elapsed) {
  decal.material.color.set(active ? 0x6ee87a : 0xffffff);
  decal.material.opacity = active ? 1 : 0.85;
  return active ? 1 + Math.sin(elapsed * 5) * 0.04 : 1;
}

export function makePadDecalTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.beginPath();
  g.roundRect(24, 24, 208, 208, 52);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 12;
  g.setLineDash([34, 22]);
  g.beginPath();
  g.roundRect(24, 24, 208, 208, 52);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

// ゾーン用デカール(角丸破線枠に枠色・アイテム絵文字・▼(置く)/▲(取る)を焼き込む)
export function makeZoneDecalTexture(icon, frameColor, arrowGlyph) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.beginPath();
  g.roundRect(20, 20, 216, 216, 48);
  g.fill();
  g.strokeStyle = frameColor;
  g.lineWidth = 12;
  g.setLineDash([30, 20]);
  g.beginPath();
  g.roundRect(20, 20, 216, 216, 48);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "112px sans-serif";
  g.fillText(icon, 128, 118); // 絵文字は基準線が高めに出るので数px下げて中央に見せる
  g.fillStyle = frameColor;
  g.font = "44px sans-serif";
  g.fillText(arrowGlyph, 128, 202);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace; // カラー絵文字を正しい色味で出すために必須
  return texture;
}

// ベルトコンベア用テクスチャ(暗色ベルト + 進行方向(+x)の矢羽根。RepeatWrapping で長さ方向に繰り返す)
export function makeBeltTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(40,46,58,0.92)";
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = "rgba(20,24,32,0.95)";
  g.fillRect(0, 0, 64, 4);
  g.fillRect(0, 28, 64, 4);
  g.strokeStyle = "#ffd84d";
  g.lineWidth = 6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(22, 8);
  g.lineTo(42, 16);
  g.lineTo(22, 24);
  g.stroke();
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// 動線チェブロン用テクスチャ(東向き「>」。向きは rotation.x=-π/2 後の rotation.z で与える)
export function makeChevronTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "#ffffff";
  g.lineWidth = 24;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(42, 26);
  g.lineTo(96, 64);
  g.lineTo(42, 102);
  g.stroke();
  return new THREE.CanvasTexture(c);
}
