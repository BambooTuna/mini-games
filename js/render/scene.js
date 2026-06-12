// 描画層のエントリ。Three.js のシーン/カメラ/ライト/地面を構築し、
// 各サブモジュール(effects3d/environment/stations3d/actors/pads/overlay)を ctx で束ねる。
// ゲーム座標 (x, y) は地面平面 (x, z) に対応し、高さが y。
import * as THREE from "three";
import { loadModelOverrides } from "../models.js";
import { createEffects3d } from "./effects3d.js";
import { createEnvironment } from "./environment.js";
import { createStations3d } from "./stations3d.js";
import { createActors } from "./actors.js";
import { createPads } from "./pads.js";
import { createOverlayUi } from "./overlay.js";

export const CAMERA_AZIMUTH = 0.55; // カメラの水平回転(入力補正にも使う)
const ELEVATION = 0.92;             // 仰角
const CAM_DIST = 1600;
const VIEW_HALF_H = 400;            // 画面縦に映るワールド高さの半分

export async function createScene(canvas, world) {
  await loadModelOverrides();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe9f0);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
  const camOffset = new THREE.Vector3(
    Math.sin(CAMERA_AZIMUTH) * Math.cos(ELEVATION),
    Math.sin(ELEVATION),
    Math.cos(CAMERA_AZIMUTH) * Math.cos(ELEVATION)
  ).multiplyScalar(CAM_DIST);
  const camTarget = new THREE.Vector3(world.spawn.x, 0, world.spawn.y);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = -VIEW_HALF_H * aspect;
    camera.right = VIEW_HALF_H * aspect;
    camera.top = VIEW_HALF_H;
    camera.bottom = -VIEW_HALF_H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- ライト(強度と色は昼夜 nightF で毎フレーム補間) ----
  const SUN_DAY = new THREE.Color(0xfff4e0);
  const SUN_NIGHT = new THREE.Color(0x8aa3d8);
  const BG_DAY = new THREE.Color(0xdfe9f0);
  const BG_NIGHT = new THREE.Color(0x232f47);
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0xcfd8e0, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -900;
  sun.shadow.camera.right = 900;
  sun.shadow.camera.top = 900;
  sun.shadow.camera.bottom = -900;
  sun.shadow.camera.far = 3000;
  scene.add(sun, sun.target);

  // ---- 地面(雪原) ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(world.width + 3000, world.height + 3000),
    new THREE.MeshLambertMaterial({ color: 0xe9eef4 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(world.width / 2, 0, world.height / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- DOM 投影(ワールド座標 → 画面 px。pads/overlay が使う) ----
  const overlay = document.getElementById("overlay");
  const projVec = new THREE.Vector3();

  function project(x, h, z) {
    projVec.set(x, h, z).project(camera);
    return {
      x: (projVec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-projVec.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // ---- サブモジュールの組み立て(ctx 経由で共有) ----
  const ctx = {
    scene, camera, world, overlay, camTarget, project,
    clock: { elapsed: 0 }, // 揺らぎ・脈動用の経過時間
    fx: null,              // effects3d(spawnBurst を他モジュールへ貸し出す)
  };
  ctx.fx = createEffects3d(ctx);
  const environment = createEnvironment(ctx);
  const stations = createStations3d(ctx);
  const actors = createActors(ctx);
  const pads = createPads(ctx);
  const overlayUi = createOverlayUi(ctx);

  let lastZoom = 1;   // キルズームパンチの再投影判定
  let lastNightF = -1; // 昼夜照明の変化検知

  // ---- 毎フレーム同期 ----
  function sync(state, dt, rawDt) {
    ctx.clock.elapsed += rawDt;

    // 昼夜の照明(nightF: 0=昼 → 1=夜。ロジック側がなめらかに追従させた値)
    const nf = state.time?.nightF ?? 0;
    if (Math.abs(nf - lastNightF) > 0.001) {
      lastNightF = nf;
      hemi.intensity = 1.1 - 0.78 * nf;
      sun.intensity = 1.9 - 1.6 * nf;
      sun.color.lerpColors(SUN_DAY, SUN_NIGHT, nf);
      scene.background.lerpColors(BG_DAY, BG_NIGHT, nf);
    }

    environment.sync(state, dt, rawDt);
    actors.sync(state, dt, rawDt);
    ctx.fx.sync(state, dt, rawDt);
    stations.sync(state, dt, rawDt);
    pads.sync(state, dt, rawDt);

    // カメラ追従 + シェイク
    const player = state.player;
    camTarget.x += (player.x - camTarget.x) * Math.min(1, rawDt * 6);
    camTarget.z += (player.y - camTarget.z) * Math.min(1, rawDt * 6);
    const shakeX = state.shake > 0.5 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeZ = state.shake > 0.5 ? (Math.random() - 0.5) * state.shake : 0;
    camera.position.set(
      camTarget.x + camOffset.x + shakeX,
      camOffset.y,
      camTarget.z + camOffset.z + shakeZ
    );
    camera.lookAt(camTarget.x + shakeX, 0, camTarget.z + shakeZ);

    // キルズームパンチ(Orthographic は zoom 変更後に再投影が必須。1.0 へ戻る最終フレームも更新)
    const zoomTarget = 1 + 0.06 * Math.min(1, Math.max(0, state.zoomPunch ?? 0));
    if (zoomTarget !== lastZoom) {
      camera.zoom = zoomTarget;
      camera.updateProjectionMatrix();
      lastZoom = zoomTarget;
    }

    sun.position.set(camTarget.x + 300, 700, camTarget.z + 150);
    sun.target.position.set(camTarget.x, 0, camTarget.z);

    // DOM オーバーレイ(project を使うのでカメラ更新後)
    pads.syncOverlay(state, rawDt);
    overlayUi.sync(state);

    renderer.render(scene, camera);
  }

  return { sync };
}
