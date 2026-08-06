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
  ["← →", "Carve on snow · spin in the air · fight the balance meter on the rail"],
  ["↑", "Tuck for speed"],
  ["↓", "Check your speed"],
  ["Space", "Hold to charge, release to pop"],
];

/** Mirrors the in-game ladder: only the first rung is named. */
const LADDER = ["LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "BEGINNER"];

interface Trick {
  name: string;
  how: string;
}

const TRICKS: Trick[] = [
  {
    name: "90 on",
    how: "Roll off the lip and hold a direction. The only way onto the steel when you start out, and it never stops working.",
  },
  {
    name: "270 · 450 on",
    how: "More charge, more rotation — and a far nastier balance kick the moment you land on the rail. Style is priced in.",
  },
  {
    name: "180 switch-up",
    how: "Tap Space mid-rail with a direction held. Pop, half turn, reconnect. Two fit on one rail with room to spare.",
  },
  {
    name: "360 switch-up",
    how: "Charge past halfway before you pop. Worth double a 180, but it eats about eight metres of rail getting round.",
  },
  {
    name: "Spin off",
    how: "Charge into the last stretch and release. 270 off, 450 if you have it, 630 once you really do.",
  },
  {
    name: "Stomp it switch",
    how: "Land backwards and keep riding. Your stance carries into the next hit, and dropping in switch pays extra.",
  },
];

const SCORING: Array<[string, string]> = [
  ["Sliding the rail", "100 / second"],
  ["Spin on", "+100 and +0.5× per half turn past 90"],
  ["Switch-up", "+250 per half turn, +0.5×"],
  ["Clean exit", "+250"],
  ["Spin off", "+150 and +0.5× per half turn past 90"],
  ["Drop in switch", "+0.25×"],
  ["Ride away switch", "+0.3×"],
];

const FEATURES: Array<[string, string]> = [
  [
    "One rail, endlessly",
    "No levels to pick, no menus, no unlocks to buy. The whole game is a single park feature repeating down the fall line, and all the depth is in how you hit it.",
  ],
  [
    "Earn your ability",
    "You start slow and small, with one trick to your name. Every tier you climb hands you real physics — faster spin, a bigger pop, a steadier edge — not a bigger number.",
  ],
  [
    "Risk you can feel",
    "The bigger the rotation onto the rail, the harder the balance meter fights you once you land on it. Nothing costs nothing.",
  ],
  [
    "Bank it or bail it",
    "Points ride with you until your skis touch snow. Bail anywhere before the landing and the whole attempt is worth zero.",
  ],
  [
    "A real trade on every approach",
    "Charging buys air and rotation, and spends rail. Pop huge and you land halfway down the steel with less room to work.",
  ],
  [
    "Runs anywhere",
    "Pure WebGL, no downloads, no plugin, no account. It opens straight into play in any modern browser.",
  ],
];

document.getElementById("app")!.innerHTML = `
  <header class="hero">
    <div class="hero__bg" aria-hidden="true"></div>
    <div class="wrap hero__inner">
      <p class="kicker">Browser ski game</p>
      <h1 class="title">Steez<span class="title__jam">Jam</span></h1>
      <p class="lede">
        One rail, over and over. You start out barely able to ski — and you earn
        every trick you land. Carve in, pop a <em>450 on</em>, hold the balance,
        throw a <em>360 switch-up</em>, spin off and stomp it switch.
      </p>
      <div class="cta">
        <a class="btn btn--play" href="${PLAY_URL}">Play now</a>
        <a class="btn btn--ghost" href="https://github.com/harvitronix/steezjam">Source on GitHub</a>
      </div>
      <p class="cta__note">Keyboard required · No install · Free</p>
    </div>
  </header>

  <section class="wrap section">
    <div class="frame">
      <img class="frame__shot" src="./media/hero.jpg" width="2000" height="1183"
           alt="Steez Jam: a skier sliding a park rail, with the balance meter, live trick score and level ladder on screen." />
    </div>
  </section>

  <section class="wrap section">
    <h2 class="h2">The controls fit on one hand</h2>
    <ul class="controls">
      ${CONTROLS.map(
        ([key, what]) => `
        <li class="control">
          <kbd class="control__key">${key}</kbd>
          <span class="control__what">${what}</span>
        </li>`,
      ).join("")}
    </ul>
    <p class="aside">
      That last one is the whole game. Charge buys air and rotation — and costs
      rail time, because a bigger pop drops you further down the steel.
    </p>
  </section>

  <section class="wrap section">
    <h2 class="h2">You start out bad at this</h2>
    <div class="earn">
      <div class="earn__copy">
        <p>
          Your first run has one trick in it: a 90 on, a 90 off. Slow spin, small
          pop, and you can't ride switch at all. Not because the game says no —
          because you can't turn fast enough yet.
        </p>
        <p>
          Six tiers, each unlocked by <strong>one good rail hit</strong>. Not a
          grind, not a total to farm: land something better than you have before
          and the next tier opens. What's above you stays hidden until you
          get there.
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
    <h2 class="h2">The trick list</h2>
    <div class="tricks">
      ${TRICKS.map(
        (t) => `
        <article class="trick">
          <h3 class="trick__name">${t.name}</h3>
          <p class="trick__how">${t.how}</p>
        </article>`,
      ).join("")}
    </div>
  </section>

  <section class="wrap section">
    <h2 class="h2">How a hit scores</h2>
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

  <section class="wrap section">
    <h2 class="h2">What it is</h2>
    <div class="features">
      ${FEATURES.map(
        ([name, body]) => `
        <article class="feature">
          <h3 class="feature__name">${name}</h3>
          <p class="feature__body">${body}</p>
        </article>`,
      ).join("")}
    </div>
  </section>

  <section class="wrap section closer">
    <h2 class="h2 closer__h2">Drop in.</h2>
    <a class="btn btn--play btn--big" href="${PLAY_URL}">Play Steez Jam</a>
  </section>

  <footer class="wrap footer">
    <p>Built with Three.js. Mid-2000s park skiing, no logos harmed.</p>
    <p><a href="https://github.com/harvitronix/steezjam">github.com/harvitronix/steezjam</a></p>
  </footer>
`;
