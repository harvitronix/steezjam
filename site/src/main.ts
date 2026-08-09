import "./style.css";

/**
 * The game is folded into /play only at build time, by scripts/bundle-site.mjs.
 * In dev it runs on its own server, so the Play button has to point there or it
 * lands on a path this server knows nothing about. `pnpm site` starts both.
 */
const PLAY_URL = import.meta.env.DEV ? "http://127.0.0.1:5173/" : "./play/";

/**
 * The micro-site is a single static page. It is authored here rather than in
 * index.html so the content lives in one editable structure and the markup
 * stays consistent across sections.
 */

const CONTROLS: Array<[string, string]> = [
  ["← → / Touch", "Carve · spin · balance"],
  ["↑", "Speed up"],
  ["↓", "Check your speed"],
  ["Space / POP", "Hold to load, release to pop"],
];

/** Mirrors the in-game ladder: only the first rung is named. */
const LADDER = ["LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "BEGINNER"];

const SCORING: Array<[string, string]> = [
  ["Sliding the rail", "100 / second"],
  ["Spin on", "+100 and +0.5× per half turn past 90"],
  ["Switch-up", "+250 per half turn, +0.5×"],
  ["Clean exit", "+250"],
  ["Spin off", "+150 and +0.5× per half turn past 90"],
  ["Drop in switch", "+0.25×"],
  ["Ride away switch", "+0.3×"],
];

document.getElementById("app")!.innerHTML = `
  <header class="hero">
    <div class="hero__bg" aria-hidden="true"></div>
    <div class="wrap hero__inner">
      <p class="kicker">Browser ski game</p>
      <h1 class="title">Steez<span class="title__jam">Jam</span></h1>
      <p class="lede">
        One run, infinite rails. Start as a beginner and work your way up
        with every trick you land.
      </p>
      <div class="cta">
        <a class="btn btn--play" href="${PLAY_URL}">Play now</a>
        <a class="btn btn--ghost" href="https://github.com/harvitronix/steezjam">Source on GitHub</a>
      </div>
      <p class="cta__note">Keyboard or touch · No install · Free</p>
    </div>
  </header>

  <section class="wrap section">
    <div class="frame">
      <img class="frame__shot" src="./media/hero.jpg" width="2000" height="1183"
           alt="Steez Jam: a skier sliding a park rail, with the balance meter, live trick score and level ladder on screen." />
    </div>
  </section>

  <section class="wrap section">
    <h2 class="h2">Controls</h2>
    <ul class="controls">
      ${CONTROLS.map(
        ([key, what]) => `
        <li class="control">
          <kbd class="control__key">${key}</kbd>
          <span class="control__what">${what}</span>
        </li>`,
      ).join("")}
    </ul>
  </section>

  <section class="wrap section">
    <h2 class="h2">Levels</h2>
    <div class="earn">
      <div class="earn__copy">
        <p>
          You start out bad and unlock skills as you get better. The whole
          game is one session: keep trying until you unlock the secret
          pro, who has definitely not endorsed this game.
        </p>
      </div>
      <ol class="ladder">
        ${LADDER.map(
          (name) => `
          <li class="rung ${name === "LOCKED" ? "rung--locked" : "rung--current"}">
            <span class="rung__pip"></span>${name}
          </li>`,
        ).join("")}
      </ol>
    </div>
  </section>

  <section class="wrap section">
    <h2 class="h2">Scoring</h2>
    <ul class="scoring">
      ${SCORING.map(
        ([what, worth]) => `
        <li class="score-row">
          <span class="score-row__what">${what}</span>
          <span class="score-row__worth">${worth}</span>
        </li>`,
      ).join("")}
    </ul>
    <p class="aside">
      Everything sums up, then multiplies once, the moment you ride away. Touch
      a hand down anywhere before that and it's all zero.
    </p>
  </section>

  <section class="wrap section closer">
    <h2 class="h2 closer__h2">Drop in.</h2>
    <a class="btn btn--play btn--big" href="${PLAY_URL}">Play Steez Jam</a>
  </section>

  <footer class="wrap footer">
    <p>Built with Three.js. A project by <a href="https://harvitronix.com" target="_blank">Matt Harvey</a>.</p>
    <p><a href="https://github.com/harvitronix/steezjam">Open Source on GitHub</a></p>
  </footer>
`;
