import "./style.css";

/**
 * The micro-site is a single static page. It is authored here rather than in
 * index.html so the content lives in one editable structure and the markup
 * stays consistent across sections.
 */

interface Trick {
  name: string;
  how: string;
}

const CONTROLS: Array<[string, string]> = [
  ["← →", "Carve on snow · spin in the air · fight the balance meter on the rail"],
  ["↑", "Tuck for speed"],
  ["↓", "Check your speed"],
  ["Space", "Hold to charge, release to pop"],
];

const TRICKS: Trick[] = [
  {
    name: "90 on",
    how: "Roll off the lip uncharged and hold one direction. The cheapest way onto the steel.",
  },
  {
    name: "270 on",
    how: "Half-charge the pop, hold the spin the whole way. More points, a nastier balance kick.",
  },
  {
    name: "450 on",
    how: "Full charge, hold all the way round. Lands you sideways and sketchy. Worth it.",
  },
  {
    name: "Switch-up",
    how: "Tap Space mid-rail with a direction held to pop a 180 and reconnect. Two fit on one rail.",
  },
  {
    name: "Spin off",
    how: "Charge in the last few metres and release. Uncharged is a 270 off, full charge is a 450.",
  },
  {
    name: "Stomp it switch",
    how: "Land backwards and keep riding switch. Your stance carries into the next hit.",
  },
];

const FEATURES: Array<[string, string]> = [
  [
    "One rail, endlessly",
    "No levels, no menus, no unlocks. The whole game is a single park feature repeating down the fall line, and all the depth is in how you hit it.",
  ],
  [
    "Risk you can feel",
    "Bigger rotations onto the rail mean a bigger balance fight once you land on it. Style is priced in.",
  ],
  [
    "Bank it or bail it",
    "Points ride with you until you touch snow. Bail before the landing and the whole attempt goes to zero.",
  ],
  [
    "Runs anywhere",
    "Pure WebGL, no downloads, no plugin. It opens straight into play in any modern browser.",
  ],
];

document.getElementById("app")!.innerHTML = `
  <header class="hero">
    <div class="hero__bg" aria-hidden="true"></div>
    <div class="wrap hero__inner">
      <p class="kicker">Browser ski game</p>
      <h1 class="title">Steez<span class="title__jam">Jam</span></h1>
      <p class="lede">
        An endless rail session. Carve in, pop a <em>450 on</em>, hold the balance,
        switch up twice, spin off and stomp it switch. Then do it again, better.
      </p>
      <div class="cta">
        <a class="btn btn--play" href="./play/">Play now</a>
        <a class="btn btn--ghost" href="https://github.com/harvitronix/steezjam">Source on GitHub</a>
      </div>
      <p class="cta__note">Keyboard required · No install · Free</p>
    </div>
  </header>

  <section class="wrap section">
    <div class="frame">
      <video
        class="frame__video"
        src="./media/gameplay.mp4"
        poster="./media/poster.jpg"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
      ></video>
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
    <a class="btn btn--play btn--big" href="./play/">Play Steez Jam</a>
  </section>

  <footer class="wrap footer">
    <p>Built with Three.js. Mid-2000s park skiing, no logos harmed.</p>
    <p><a href="https://github.com/harvitronix/steezjam">github.com/harvitronix/steezjam</a></p>
  </footer>
`;
