import * as THREE from "three";
import "./ui/style.css";
import { Game } from "./game";
import { bindKeyboard, createInput } from "./core/input";

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

const game = new Game(hudRoot);

const input = createInput();
bindKeyboard(input, { onFirstInteraction: () => game.unlockAudio() });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  game.resize(w, h);
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function frame(now: number) {
  // Clamped so a background tab or a long stall can never tunnel the skier
  // through the snow on the first frame back.
  const dt = Math.min(0.034, Math.max(0.0005, (now - last) / 1000));
  last = now;
  game.update(dt, input);
  renderer.render(game.world.scene, game.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Small hook so the rendered game can be exercised by automated browser tests.
(window as unknown as { gameState: () => unknown }).gameState = () => game.debugState();
