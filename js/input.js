// タッチ(バーチャルジョイスティック) + キーボード(WASD/矢印) + マウスドラッグ入力。
// getMove() が {x, y}(長さ0〜1の方向ベクトル)を返す。

const JOYSTICK_RADIUS = 60;

export function createInput(container) {
  const keys = new Set();
  const stick = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };

  const joystickEl = document.getElementById("joystick");
  const baseEl = document.getElementById("joystick-base");
  const stickEl = document.getElementById("joystick-stick");

  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  function pointerStart(x, y) {
    stick.active = true;
    stick.originX = x;
    stick.originY = y;
    stick.dx = 0;
    stick.dy = 0;
    joystickEl.classList.remove("hidden");
    joystickEl.style.left = `${x}px`;
    joystickEl.style.top = `${y}px`;
    baseEl.style.left = "0px";
    baseEl.style.top = "0px";
    stickEl.style.left = "0px";
    stickEl.style.top = "0px";
  }

  function pointerMove(x, y) {
    if (!stick.active) return;
    let dx = x - stick.originX;
    let dy = y - stick.originY;
    const len = Math.hypot(dx, dy);
    if (len > JOYSTICK_RADIUS) {
      dx = (dx / len) * JOYSTICK_RADIUS;
      dy = (dy / len) * JOYSTICK_RADIUS;
    }
    stick.dx = dx / JOYSTICK_RADIUS;
    stick.dy = dy / JOYSTICK_RADIUS;
    stickEl.style.left = `${dx}px`;
    stickEl.style.top = `${dy}px`;
  }

  function pointerEnd() {
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    joystickEl.classList.add("hidden");
  }

  container.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    pointerStart(t.clientX, t.clientY);
  }, { passive: false });

  container.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    pointerMove(t.clientX, t.clientY);
  }, { passive: false });

  container.addEventListener("touchend", (e) => {
    e.preventDefault();
    pointerEnd();
  }, { passive: false });

  container.addEventListener("mousedown", (e) => pointerStart(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => pointerMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", pointerEnd);

  function getMove() {
    let x = stick.dx;
    let y = stick.dy;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  return { getMove };
}
