import { clamp, lerp } from "../core/util";
import { LEVELS } from "../levels";

/**
 * Needle colour as the slide goes wrong: icy white through rail yellow to
 * the kit's hot pink. Same three colours the rest of the game is built from,
 * so the meter reads as part of the world rather than a debug overlay.
 */
const HEAT: Array<[number, number, number]> = [
  [234, 252, 255],
  [255, 194, 26],
  [255, 46, 99],
];

function heatColor(t: number): string {
  const x = clamp(t, 0, 1) * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(x));
  const f = x - i;
  const a = HEAT[i];
  const b = HEAT[i + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent.appendChild(n);
  return n;
}

export class Hud {
  private bestValue: HTMLElement;
  private run: HTMLElement;
  private runPoints: HTMLElement;
  private runMult: HTMLElement;
  private runTricks: HTMLElement;
  private runBadge: HTMLElement;
  private runMode = "off";
  private shownBest = -1;
  private stanceTag: HTMLElement;
  private levelRows: HTMLElement[] = [];
  private levelNames: HTMLElement[] = [];
  private levelFill: HTMLElement;
  private levelGoal: HTMLElement;
  private levelUp: HTMLElement;
  private shownLevel = -1;
  private levels: HTMLElement;
  private meter: HTMLElement;
  private meterShake: HTMLElement;
  private meterBody: HTMLElement;
  private meterNeedle: HTMLElement;
  private meterLean: HTMLElement;
  private meterBand: HTMLElement;
  private meterLock: HTMLElement;
  private edgeL: HTMLElement;
  private edgeR: HTMLElement;
  private meterOn = false;
  private wasSettled = false;
  private hint: HTMLElement;
  private fade: HTMLElement;

  constructor(root: HTMLElement) {
    const top = el("div", "hud-top", root);
    const bestBox = el("div", "best-box", top);
    el("div", "label", bestBox).textContent = "BEST HIT";
    this.bestValue = el("div", "best-value", bestBox);
    this.bestValue.textContent = "0";
    this.stanceTag = el("div", "stance-tag", top);
    this.stanceTag.textContent = "REGULAR";

    // The run readout is the loudest text on screen and sits centre-top, over
    // sky rather than over the line the player is reading.
    this.run = el("div", "run", root);
    this.runBadge = el("div", "run-badge", this.run);
    const line = el("div", "run-line", this.run);
    this.runPoints = el("div", "run-points", line);
    this.runMult = el("div", "run-mult", line);
    this.runTricks = el("div", "run-tricks", this.run);

    // Layered so each transform has one owner: the shake wrapper is written
    // every frame from JS, the body carries the pop-in keyframes, and the track
    // holds the fixed skew. Sharing one element would have them fight.
    this.meter = el("div", "meter", root);
    this.meterShake = el("div", "meter-shake", this.meter);
    this.meterBody = el("div", "meter-body", this.meterShake);
    const track = el("div", "meter-track", this.meterBody);
    // Fills clip to the frame; the needle deliberately overhangs it, so it
    // cannot live inside the same clipping context.
    const clip = el("div", "meter-clip", track);
    this.meterBand = el("div", "meter-band", clip);
    this.meterLean = el("div", "meter-lean", clip);
    el("div", "meter-ticks", clip);
    el("div", "meter-danger left", clip);
    el("div", "meter-danger right", clip);
    el("div", "meter-center", clip);
    this.meterNeedle = el("div", "meter-needle", track);
    const caption = el("div", "meter-caption", this.meterBody);
    el("div", "meter-label", caption).textContent = "BALANCE";
    this.meterLock = el("div", "meter-lock", caption);
    this.meterLock.textContent = "LOCKED";

    // Progression ladder, hardest at the top so unlocking reads as climbing.
    // Names stay hidden until reached — the next rung is a rumour, not a target.
    const ladder = el("div", "levels", root);
    this.levels = ladder;
    el("div", "levels-title", ladder).textContent = "LEVEL";
    const list = el("div", "level-list", ladder);
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      const row = el("div", "level", list);
      el("div", "level-pip", row);
      const name = el("div", "level-name", row);
      name.textContent = i === 0 ? LEVELS[0].name : "LOCKED";
      this.levelRows[i] = row;
      this.levelNames[i] = name;
    }
    const next = el("div", "level-next", ladder);
    const bar = el("div", "level-bar", next);
    this.levelFill = el("div", "level-fill", bar);
    this.levelGoal = el("div", "level-goal", next);

    this.levelUp = el("div", "levelup", root);

    // Full-height glow on whichever side the skier is losing it toward, so the
    // warning is readable without looking away from the skier.
    this.edgeL = el("div", "edge-warn left", root);
    this.edgeR = el("div", "edge-warn right", root);

    this.hint = el("div", "hint", root);
    this.hint.innerHTML =
      '<span class="hint-keyboard"><b>&#9664; &#9654;</b> carve &middot; steer &middot; balance &nbsp;&nbsp; ' +
      '<b>&#9650; &#9660;</b> speed &nbsp;&nbsp; <b>SPACE</b> hold to charge, release to pop</span>' +
      '<span class="hint-touch"><b>&#9664; &#9654;</b> steer &nbsp;&nbsp; <b>POP</b> hold, then release</span>';
    this.fade = el("div", "fade", root);
  }

  setBest(v: number) {
    if (v === this.shownBest) return;
    this.shownBest = v;
    this.bestValue.textContent = v.toLocaleString("en-US");
    this.bestValue.classList.remove("pulse");
    void this.bestValue.offsetWidth;
    this.bestValue.classList.add("pulse");
  }

  /**
   * `live` while the attempt is running, then `landed` or `bailed`, which stay
   * up until the next attempt starts.
   */
  setRun(
    mode: "off" | "live" | "landed" | "bailed",
    points: number,
    mult: number,
    tricks: string,
    isBest: boolean,
  ) {
    if (mode !== this.runMode) {
      this.runMode = mode;
      this.run.className = `run ${mode}`;
      if (mode === "landed" || mode === "bailed") {
        // Re-trigger the stamp on every result, not just the first.
        void this.run.offsetWidth;
        this.run.classList.add("stamp");
      }
    }
    if (mode === "off") return;

    const pts = points.toLocaleString("en-US");
    if (this.runPoints.textContent !== pts) this.runPoints.textContent = pts;
    const m = `${mult.toFixed(1)}x`;
    if (this.runMult.textContent !== m) this.runMult.textContent = m;
    if (this.runTricks.textContent !== tricks) this.runTricks.textContent = tricks;

    const badge = mode === "bailed" ? "BAILED" : isBest ? "NEW BEST" : "";
    if (this.runBadge.textContent !== badge) this.runBadge.textContent = badge;
    this.run.classList.toggle("is-best", isBest && mode !== "bailed");
  }

  setLevel(index: number, best: number) {
    if (index !== this.shownLevel) {
      this.shownLevel = index;
      for (let i = 0; i < LEVELS.length; i++) {
        const reached = i <= index;
        this.levelNames[i].textContent = reached ? LEVELS[i].name : "LOCKED";
        this.levelRows[i].className =
          "level " + (i === index ? "is-current" : reached ? "is-done" : "is-locked");
      }
      this.levels.classList.remove("peek");
      void this.levels.offsetWidth;
      this.levels.classList.add("peek");
    }
    const next = LEVELS[index + 1];
    if (!next) {
      this.levelFill.style.width = "100%";
      this.levelGoal.textContent = "MAXED";
      return;
    }
    const from = LEVELS[index].at;
    const span = next.at - from;
    this.levelFill.style.width = `${clamp((best - from) / span, 0, 1) * 100}%`;
    this.levelGoal.textContent =
      `${Math.round(best).toLocaleString("en-US")} / ${next.at.toLocaleString("en-US")}`;
  }

  showLevelUp(name: string) {
    this.levelUp.textContent = name;
    this.levelUp.classList.remove("show");
    void this.levelUp.offsetWidth;
    this.levelUp.classList.add("show");
  }

  setStance(sw: boolean) {
    const t = sw ? "SWITCH" : "REGULAR";
    if (this.stanceTag.textContent !== t) {
      this.stanceTag.textContent = t;
      this.stanceTag.classList.toggle("switch", sw);
    }
  }

  setMeter(visible: boolean, value: number, band: number, settled: boolean) {
    if (visible !== this.meterOn) {
      this.meterOn = visible;
      this.meter.classList.toggle("on", visible);
      if (visible) {
        // Restart the pop-in on every fresh lock-on, not just the first.
        this.meterBody.classList.remove("pop");
        void this.meterBody.offsetWidth;
        this.meterBody.classList.add("pop");
        this.wasSettled = false;
      }
    }
    if (!visible) {
      this.edgeL.style.opacity = "0";
      this.edgeR.style.opacity = "0";
      return;
    }

    const v = clamp(value, -1, 1);
    const danger = Math.abs(v);
    const pos = 50 + v * 50;

    this.meterNeedle.style.left = `${pos}%`;
    // Fill from the centre out to the needle: how far off you are, at a glance.
    this.meterLean.style.left = `${v >= 0 ? 50 : pos}%`;
    this.meterLean.style.width = `${danger * 50}%`;

    this.meter.style.setProperty("--heat", heatColor(danger));
    this.meter.style.setProperty("--glow", (0.25 + danger * 0.75).toFixed(3));
    this.meter.classList.toggle("hot", danger > 0.72);

    this.meterBand.style.width = `${band * 100}%`;
    this.meterBand.style.left = `${50 - band * 50}%`;

    // The whole meter starts rattling once the slide gets away from you.
    const rattle = clamp((danger - 0.45) / 0.55, 0, 1);
    const jx = (Math.random() - 0.5) * rattle * 7;
    const jy = (Math.random() - 0.5) * rattle * 5;
    this.meterShake.style.transform = `translate(${jx.toFixed(2)}px,${jy.toFixed(2)}px)`;

    const warn = clamp((danger - 0.35) / 0.65, 0, 1).toFixed(3);
    this.edgeL.style.opacity = v < 0 ? warn : "0";
    this.edgeR.style.opacity = v > 0 ? warn : "0";

    if (settled && !this.wasSettled) {
      this.meterLock.classList.remove("show");
      void this.meterLock.offsetWidth;
      this.meterLock.classList.add("show");
    }
    this.wasSettled = settled;
  }

  setHint(v: number) {
    this.hint.style.opacity = String(clamp(v, 0, 1));
  }

  setFade(v: number) {
    this.fade.style.opacity = String(clamp(v, 0, 1));
  }

  update(_dt: number) {
    // Reserved for time-based HUD effects; the meter and run panel are driven
    // straight from state.
  }
}
