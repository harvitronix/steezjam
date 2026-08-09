import * as THREE from "three";
import "./ui/style.css";
import { Game } from "./game";
import { bindKeyboard, bindTouch, createInput } from "./core/input";
import * as course from "./world/course";

const app = document.getElementById("app") as HTMLElement;
app.innerHTML = "";

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Straight linear output keeps the bright, saturated ski-film palette; ACES
// washes the snow and jacket colours out.
renderer.toneMapping = THREE.NoToneMapping;
app.appendChild(renderer.domElement);

const hudRoot = document.createElement("div");
hudRoot.id = "hud";
app.appendChild(hudRoot);

const touchControls = document.createElement("div");
touchControls.className = "touch-controls";
touchControls.setAttribute("aria-label", "Touch controls");
const steer = document.createElement("div");
steer.className = "touch-steer";
touchControls.appendChild(steer);

function touchButton(label: string, className: string, ariaLabel: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `touch-button ${className}`;
  button.textContent = label;
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

const touchLeft = touchButton("◀", "touch-left", "Steer left");
const touchRight = touchButton("▶", "touch-right", "Steer right");
const touchPop = touchButton("POP", "touch-pop", "Hold to charge, release to pop");
steer.append(touchLeft, touchRight);
touchControls.appendChild(touchPop);
app.appendChild(touchControls);

const game = new Game(hudRoot);

const input = createInput();
bindKeyboard(input, { onFirstInteraction: () => game.unlockAudio() });
bindTouch(input, { left: touchLeft, right: touchRight, pop: touchPop });

function resize() {
  // Measure the container, not the window: the play page sizes the game to a
  // box rather than letting it take the whole viewport.
  const w = app.clientWidth;
  const h = app.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  game.resize(w, h);
}
new ResizeObserver(resize).observe(app);
resize();

/**
 * Fixed-timestep simulation with a variable-rate render.
 *
 * The game used to step on the raw frame delta, clamped to 34ms. That made the
 * whole thing frame-rate dependent in two directions at once: a 120Hz display
 * integrated gravity differently from a 60Hz one, and a machine that dropped
 * below 30fps ran the game in visible slow motion, because every frame was
 * worth at most 34ms of game time no matter how long it actually took.
 *
 * Now `step()` only ever sees FIXED_DT and the accumulator decides how many
 * steps a frame owes, so a run plays out identically everywhere. `present()`
 * still runs once per frame on the real delta, and draws the skier interpolated
 * between the last two steps: without that, frames owing 0, 1 or 2 steps advance
 * by visibly different amounts and the whole thing judders.
 */
const FIXED_DT = 1 / 120;
/**
 * Longest real interval a single frame may bank. Beyond this the simulation
 * deliberately falls behind wall-clock rather than trying to catch up: without
 * it, returning to a backgrounded tab would cash in minutes of accumulated time
 * as thousands of steps and hang the page.
 */
const MAX_FRAME = 0.25;

let last = performance.now();
let accumulator = 0;

function frame(now: number) {
  const frameTime = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
  last = now;

  accumulator += frameTime;
  while (accumulator >= FIXED_DT) {
    game.step(FIXED_DT, input);
    accumulator -= FIXED_DT;
  }

  // Whatever time is left in the accumulator is how far past the last completed
  // step this frame sits — render between the last two steps by that fraction.
  game.present(Math.max(0.0005, frameTime), accumulator / FIXED_DT);
  renderer.render(game.world.scene, game.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Small hook so the rendered game can be exercised by automated browser tests.
(window as unknown as { gameState: () => unknown }).gameState = () => game.debugState();

// Dev-only handles on the live objects and the course maths, for posing the
// camera at the skier and forcing hard-to-reach states while tuning the rig.
// Neither is present in a production build.
if (import.meta.env.DEV) {
  const w = window as unknown as { game: Game; course: typeof course };
  w.game = game;
  w.course = course;
}
