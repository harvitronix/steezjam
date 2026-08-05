import { clamp, lerp } from "../core/util";

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
  private scoreValue: HTMLElement;
  private comboBox: HTMLElement;
  private comboValue: HTMLElement;
  private multValue: HTMLElement;
  private trickText: HTMLElement;
  private stanceTag: HTMLElement;
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
  private flash: HTMLElement;
  private hint: HTMLElement;
  private fade: HTMLElement;
  private shownScore = 0;
  private pulse = 0;

  constructor(root: HTMLElement) {
    const top = el("div", "hud-top", root);
    const scoreBox = el("div", "score-box", top);
    el("div", "label", scoreBox).textContent = "SESSION";
    this.scoreValue = el("div", "score-value", scoreBox);
    this.scoreValue.textContent = "0";

    this.comboBox = el("div", "combo-box", top);
    const row = el("div", "combo-row", this.comboBox);
    this.comboValue = el("div", "combo-value", row);
    this.multValue = el("div", "mult-value", row);
    this.trickText = el("div", "trick-text", this.comboBox);
    this.stanceTag = el("div", "stance-tag", top);
    this.stanceTag.textContent = "REGULAR";

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

    // Full-height glow on whichever side the skier is losing it toward, so the
    // warning is readable without looking away from the skier.
    this.edgeL = el("div", "edge-warn left", root);
    this.edgeR = el("div", "edge-warn right", root);

    this.flash = el("div", "flash", root);
    this.hint = el("div", "hint", root);
    this.hint.innerHTML =
      "<b>&#9664; &#9654;</b> carve &middot; steer &middot; balance &nbsp;&nbsp; " +
      "<b>&#9650; &#9660;</b> speed &nbsp;&nbsp; <b>SPACE</b> hold to charge, release to pop";
    this.fade = el("div", "fade", root);
  }

  setScore(v: number) {
    if (v !== this.shownScore) {
      this.shownScore = v;
      this.scoreValue.textContent = v.toLocaleString("en-US");
      this.pulse = 1;
      this.scoreValue.classList.remove("pulse");
      void this.scoreValue.offsetWidth;
      this.scoreValue.classList.add("pulse");
    }
  }

  setCombo(active: boolean, points: number, mult: number, tricks: string) {
    this.comboBox.style.opacity = active ? "1" : "0";
    if (!active) return;
    this.comboValue.textContent = points.toLocaleString("en-US");
    this.multValue.textContent = `${mult.toFixed(1)}x`;
    if (this.trickText.textContent !== tricks) this.trickText.textContent = tricks;
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

  showFlash(text: string, kind: "good" | "bad") {
    this.flash.textContent = text;
    this.flash.className = `flash show ${kind}`;
    window.setTimeout(() => {
      if (this.flash.textContent === text) this.flash.className = "flash";
    }, 1100);
  }

  setHint(v: number) {
    this.hint.style.opacity = String(clamp(v, 0, 1));
  }

  setFade(v: number) {
    this.fade.style.opacity = String(clamp(v, 0, 1));
  }

  update(dt: number) {
    this.pulse = Math.max(0, this.pulse - dt * 3);
  }
}
