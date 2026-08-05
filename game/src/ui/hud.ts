import { clamp } from "../core/util";

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
  private meterFill: HTMLElement;
  private meterBand: HTMLElement;
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

    this.meter = el("div", "meter", root);
    const track = el("div", "meter-track", this.meter);
    this.meterBand = el("div", "meter-band", track);
    el("div", "meter-danger left", track);
    el("div", "meter-danger right", track);
    el("div", "meter-center", track);
    this.meterFill = el("div", "meter-knob", track);
    el("div", "meter-label", this.meter).textContent = "BALANCE";

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

  setMeter(visible: boolean, value: number, band: number) {
    this.meter.style.opacity = visible ? "1" : "0";
    if (!visible) return;
    const v = clamp(value, -1, 1);
    this.meterFill.style.left = `${50 + v * 50}%`;
    const danger = Math.abs(v);
    this.meterFill.style.background = danger > 0.72 ? "#ff2d20" : danger > 0.45 ? "#ffb020" : "#fff";
    this.meterFill.style.boxShadow = `0 0 ${6 + danger * 22}px rgba(255,${
      Math.round(200 - danger * 180)
    },40,${0.35 + danger * 0.6})`;
    this.meterBand.style.width = `${band * 100}%`;
    this.meterBand.style.left = `${50 - band * 50}%`;
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
