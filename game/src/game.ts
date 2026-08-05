import * as THREE from "three";
import {
  COURSE_HW,
  FEATURE_Z0,
  RAIL_HALF_W,
  RAIL_X,
  collisionFeature,
  featureLipZ,
  groundY,
  lipHeight,
  railEndZ,
  railStartZ,
  railTopYAt,
  SEG,
  targetFeature,
} from "./world/course";
import { Audio } from "./fx/audio";
import { Effects } from "./fx/effects";
import { Hud } from "./ui/hud";
import { POLE_RISE_AIR, POLE_RISE_GROUND, Skier } from "./player/skier";
import { World } from "./world/world";
import { clamp, damp, dampAngle, deg, lerp, rad, smoothstep, wrapPi } from "./core/util";
import type { Input } from "./core/input";

type State = "SNOW" | "AIR" | "RAIL" | "RAILAIR" | "CRASH";

const G = 9.8;
const WHITE = new THREE.Color("#ffffff");

const SPEED_BASE = 10.2;
const SPEED_TUCK = 3.6;
const SPEED_CHECK = 3.0;
const SPEED_MIN = 6.6;
const CARVE_MAX = 6.4;

const CHARGE_TIME = 0.7;
const POP_SNOW_BASE = 1.2;
const POP_SNOW_MAX = 3.0;
const POP_LIP_BASE = 0.9;
const POP_LIP_MAX = 4.1;
/** Switch-up hops stay low and short so two fit on one rail. */
const POP_RAIL_BASE = 1.8;
const POP_RAIL_MAX = 0.9;
/** Popping off the end has the whole landing to fall into, so it goes bigger:
 *  un-charged comes out near a 270 off, fully charged near a 450. */
const EXIT_POP_BASE = 1.9;
const EXIT_POP_MAX = 3.4;

/**
 * Rotation builds under constant angular acceleration while a direction is
 * held. That makes hang time and rotation scale together: rolling off the lip
 * un-charged and holding a direction lands a 90-on, while a fully charged pop
 * held all the way round comes out at a 450-on. Letting go bleeds the spin off
 * quickly enough to place a late correction, but not instantly.
 */
// Nudged up ~12% when the loop went fixed-timestep. The old loop ran the game
// in slow motion on anything under 120fps, which quietly handed the player extra
// wall-clock time to bring a rotation round; at true speed the same numbers felt
// sluggish against the approach. Every entry scales together, and the 90/270/450
// classification rounds to the nearest half turn, so the breakpoints hold: a
// 90-on comes out near 101 degrees and a 450-on near 504, both still well inside
// their windows.
const SPIN_ACCEL = 9.3;
const SPIN_MAX = 9.5;
const SPIN_DECAY = 6;

/** Angular slack allowed when landing on snow. The same value is used for a
 *  forward landing and a switch one, so neither stance is favoured. */
const LAND_TOL = rad(55);
/** Perpendicularity slack when catching the rail. */
const RAIL_TOL = rad(45);
const RAIL_CLEAN = rad(15);

const BAL_INPUT = 5.0;
const BAL_DAMP = 1.5;
const BAL_VEL_MAX = 2.6;
/** Final stretch of the rail where a pop counts as an exit rather than a
 *  switch-up. Kept short so most of the rail is switch-up territory. */
const EXIT_ZONE = 4.5;

/**
 * How far uphill of the next lip a restart drops the skier. Two constraints
 * bracket it: the camera sits 8.2m behind, so anything under ~35m from the
 * previous rail's end leaves that rail in frame (it used to respawn 1m past it,
 * putting the camera inside the steel); and at ~10m/s this is the approach time
 * available to line up a spin, so too much of it makes every restart a wait.
 * 30m lands just uphill of the roller — the skier crests it and the next lip
 * is right there.
 */
const RESPAWN_LEAD = 30;
/** Floor on that approach when a long crash slide has eaten into it. A cramped
 *  run-in beats teleporting past a whole feature to preserve the full lead. */
const RESPAWN_MIN_LEAD = 18;

/** The rail's sit-down stance, and the extra compression while charging a pop. */
const RAIL_CROUCH = 0.55;
const RAIL_CHARGE_CROUCH = 0.3;
/**
 * How much of that compressed stance carries through a spin off the rail.
 * Popping used to extend the skier straight back to the ordinary airborne
 * stance, which reads as losing the trick rather than throwing one — a spin off
 * should stay sat down in the same shape the slide had.
 */
const RAIL_EXIT_CROUCH = 0.8 * (RAIL_CROUCH + RAIL_CHARGE_CROUCH);

/** Beat for continuous particle emitters — historically one spawn per frame at
 *  60fps, kept at that rate so the spray looks the same as it always has. */
const FX_INTERVAL = 1 / 60;

interface Attempt {
  active: boolean;
  base: number;
  mult: number;
  labels: string[];
  approachSwitch: boolean;
  ridden: boolean;
  switchUps: number;
}

function halves(spin: number): number {
  return Math.max(0, Math.round(Math.abs(spin) / Math.PI));
}

export class Game {
  readonly world = new World();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.4, 2600);
  private skier = new Skier();
  private effects = new Effects(this.world.scene);
  private audio = new Audio();
  private hud: Hud;

  // --- skier state -------------------------------------------------------
  private state: State = "SNOW";
  private x = 0;
  private z = -18;
  private y = 0;
  private vy = 0;
  private vx = 0;
  private speed = SPEED_BASE;
  private yaw = 0;
  private spinVel = 0;
  private spinAccum = 0;
  private spinDir = 0;
  private spinCapped = false;
  /** Whether the current airborne phase came off the rail rather than the lip.
   *  The two want different stances: a spin on opens up, a spin off stays sat. */
  private airFromRail = false;
  private isSwitch = false;
  /**
   * Which shoulder the skier checks over when riding switch. Continuous in
   * [-1, 1] rather than a hard +1/-1 so the head swings across instead of
   * snapping. +1 is the left shoulder, -1 the right — see `headYaw` below.
   */
  private switchShoulder = 1;
  private charge = 0;
  private charging = false;
  private crashT = 0;
  private landCompress = 0;
  private clock = 0;
  private sketch = 0;
  /** True on simulation steps that coincide with the cosmetic emitter beat. */
  private fxBeat = false;
  private fxAcc = 0;

  // --- render interpolation ----------------------------------------------
  // The skier's world position comes straight off simulation state, so with a
  // fixed step it can only ever land on step boundaries. Rendering it raw makes
  // frames that owe 0, 1 or 2 steps advance by visibly different amounts — the
  // classic fixed-timestep judder. present() draws between the last two steps
  // instead. Everything else it touches is exponentially smoothed and needs no
  // such treatment.
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevYaw = 0;
  /** Interpolated pose used for all rendering this frame. */
  private viewX = 0;
  private viewY = 0;
  private viewZ = 0;
  private viewYaw = 0;

  // --- rail --------------------------------------------------------------
  private railIndex = -1;
  private railYaw = 0;
  private bal = 0;
  private balVel = 0;
  private instability = 2.2;
  private wanderPhase = 0;
  private settleT = 0;
  private settled = false;
  private band = 0.16;

  // --- scoring -----------------------------------------------------------
  private session = 0;
  private attempt: Attempt = {
    active: false,
    base: 0,
    mult: 1,
    labels: [],
    approachSwitch: false,
    ridden: false,
    switchUps: 0,
  };
  private attempts = 0;
  private hintAlpha = 1;
  private fade = 0;

  // --- camera ------------------------------------------------------------
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = new THREE.Vector3();
  private shakeVel = new THREE.Vector3();
  private camInit = false;

  constructor(hudRoot: HTMLElement) {
    this.hud = new Hud(hudRoot);
    this.world.scene.add(this.skier.root);
    this.y = groundY(this.x, this.z);
    this.skier.root.rotation.order = "YXZ";
  }

  unlockAudio() {
    this.audio.start();
  }

  private startAttempt() {
    this.attempt = {
      active: true,
      base: 0,
      mult: 1,
      labels: [],
      approachSwitch: this.isSwitch,
      ridden: false,
      switchUps: 0,
    };
  }

  private voidAttempt() {
    this.attempt.active = false;
    this.attempt.base = 0;
    this.attempt.mult = 1;
    this.attempt.labels = [];
  }

  private bank() {
    if (!this.attempt.active) return;
    const pts = Math.round(Math.round(this.attempt.base) * this.attempt.mult);
    if (pts > 0) {
      this.session += pts;
      this.audio.bank();
      this.hud.showFlash(`+${pts.toLocaleString("en-US")}`, "good");
    }
    this.attempt.active = false;
    this.attempt.base = 0;
    this.attempt.mult = 1;
    this.attempts++;
  }

  private crash(reason: string, why = "") {
    if (this.state === "CRASH") return;
    this.note(`crash ${why} from ${this.state} yaw=${deg(wrapPi(this.yaw)).toFixed(0)}`);
    const wasActive = this.attempt.active;
    this.voidAttempt();
    this.state = "CRASH";
    this.crashT = 0;
    this.spinVel = 0;
    this.vy = 0;
    this.audio.bail();
    this.audio.setScrape(0, 0);
    this.audio.setTension(0);
    this.effects.bail(this.x, this.y, this.z);
    this.kick(0.9);
    if (wasActive) this.hud.showFlash("BAIL — 0", "bad");
    else this.hud.showFlash(reason, "bad");
    this.attempts++;
  }

  private kick(power: number) {
    this.shakeVel.x += (Math.random() - 0.5) * power * 3.2;
    this.shakeVel.y += (Math.random() - 0.5) * power * 3.2;
    this.shakeVel.z += (Math.random() - 0.5) * power * 2.0;
  }

  private trace: string[] = [];
  private note(msg: string) {
    this.trace.push(`${this.clock.toFixed(2)} ${msg}`);
    if (this.trace.length > 40) this.trace.shift();
  }

  private steer(input: Input): number {
    return (input.right ? 1 : 0) - (input.left ? 1 : 0);
  }

  // ========================================================================

  /**
   * One fixed simulation step. Everything that decides *what happened* lives
   * here and only ever sees a constant `dt`, so the outcome of a run no longer
   * depends on the player's frame rate.
   */
  step(dt: number, input: Input) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
    this.clock += dt;
    this.fxBeat = this.nextFxBeat(dt);
    const steer = this.steer(input);

    switch (this.state) {
      case "SNOW":
        this.updateSnow(dt, input, steer);
        break;
      case "AIR":
        this.updateAir(dt, input, steer);
        break;
      case "RAIL":
        this.updateRail(dt, input, steer);
        break;
      case "RAILAIR":
        this.updateRailAir(dt, input, steer);
        break;
      case "CRASH":
        this.updateCrash(dt);
        break;
    }

    if (this.attempt.active && this.state === "RAIL") {
      this.attempt.base += 100 * dt;
    }

    this.landCompress = Math.max(0, this.landCompress - dt * 3.2);
    this.sketch = Math.max(0, this.sketch - dt * 2.0);
  }

  /**
   * Presentation, run once per rendered frame on the real frame delta. None of
   * this feeds back into the simulation, and all of the smoothing here is
   * exponential, so it stays correct at any refresh rate without needing to be
   * interpolated between fixed steps.
   */
  present(dt: number, alpha: number) {
    const a = clamp(alpha, 0, 1);
    this.viewX = lerp(this.prevX, this.x, a);
    this.viewY = lerp(this.prevY, this.y, a);
    this.viewZ = lerp(this.prevZ, this.z, a);
    this.viewYaw = this.prevYaw + wrapPi(this.yaw - this.prevYaw) * a;

    this.world.update(this.viewZ);
    this.effects.update(dt);
    this.poseSkier(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
    this.world.focusShadows(this.viewX, this.viewY, this.viewZ);
  }

  /** Collapses the interpolation window onto the current state. Called after a
   *  deliberate teleport, so the skier does not appear to slide into place. */
  private snapView() {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
    this.viewX = this.x;
    this.viewY = this.y;
    this.viewZ = this.z;
    this.viewYaw = this.yaw;
  }

  /**
   * Continuous particle emitters spawn a fixed number per call, so running them
   * straight off the simulation step would tie spray density to the step rate.
   * They get their own steady beat instead.
   */
  private nextFxBeat(dt: number): boolean {
    this.fxAcc += dt;
    if (this.fxAcc < FX_INTERVAL) return false;
    // Drop whole missed beats rather than bursting to catch up after a stall.
    this.fxAcc = Math.min(this.fxAcc - FX_INTERVAL, FX_INTERVAL);
    return true;
  }

  // --- on snow ------------------------------------------------------------

  private updateSnow(dt: number, input: Input, steer: number) {
    const target =
      SPEED_BASE + (input.up ? SPEED_TUCK : 0) - (input.down ? SPEED_CHECK : 0);
    this.speed = damp(this.speed, Math.max(SPEED_MIN, target), 1.6, dt);

    const vxTarget = steer * CARVE_MAX * (this.speed / SPEED_BASE);
    this.vx = damp(this.vx, vxTarget, 5.5, dt);

    const prevX = this.x;
    const prevZ = this.z;
    const prevY = this.y;
    this.x += this.vx * dt;
    this.z -= this.speed * dt;

    // Soft course walls keep the skier in the groomed lane.
    if (Math.abs(this.x) > COURSE_HW) {
      const over = Math.abs(this.x) - COURSE_HW;
      this.x -= Math.sign(this.x) * Math.min(over, 12 * dt);
      this.vx = damp(this.vx, 0, 6, dt);
    }

    const alignYaw = -Math.atan2(this.vx, Math.max(1, this.speed));
    this.yaw = dampAngle(this.yaw, alignYaw + (this.isSwitch ? Math.PI : 0), 11, dt);

    // Riding switch you check downhill over the shoulder you are steering
    // toward: reaching left brings the head round the left shoulder. Holding the
    // last direction when nothing is pressed avoids a twitch back to centre
    // every time the player lets go.
    if (this.isSwitch && steer !== 0) {
      this.switchShoulder = damp(this.switchShoulder, -steer, 7, dt);
    }

    const wasOnLip = lipHeight(prevX, prevZ) > 0.06;
    const ground = groundY(this.x, this.z);

    // Straight into the side of a rail: bail.
    const fi = collisionFeature(this.z);
    if (
      fi >= 0 &&
      this.z <= railStartZ(fi) + 0.4 &&
      this.z >= railEndZ(fi) - 0.2 &&
      Math.abs(this.x - RAIL_X) < 0.85 &&
      ground < railTopYAt(fi, this.z) - 0.1
    ) {
      this.y = ground;
      this.crash("BAIL — 0", "snow-hit-rail");
      return;
    }

    // Left the lip — over the end, or off its shoulder. Either way the snow has
    // dropped out from under the skis, so the skier is now airborne.
    if (wasOnLip && lipHeight(this.x, this.z) <= 0.06) {
      this.y = prevY;
      const charged = this.charging ? this.chargeAmt() : 0;
      this.launch(POP_LIP_BASE + charged * POP_LIP_MAX, true);
      if (this.charging) {
        this.audio.pop();
        this.kick(0.25 + charged * 0.35);
        this.charging = false;
        this.charge = 0;
      }
      return;
    }
    if (ground < prevY - 0.24) {
      this.y = prevY;
      this.launch(0, false);
      return;
    }
    this.y = ground;

    this.updateCharge(dt, input);
    if (this.state !== "SNOW") return;

    if (this.fxBeat && steer !== 0 && this.speed > 7) {
      const p = Math.min(1, Math.abs(this.vx) / CARVE_MAX);
      if (p > 0.12) {
        this.effects.carve(this.x, this.y, this.z, Math.sign(this.vx), p);
        this.effects.carve(this.x, this.y, this.z, Math.sign(this.vx), p * 0.6);
      }
    }
    this.audio.setCarve(Math.min(1, Math.abs(this.vx) / CARVE_MAX) * 0.9 + 0.12, this.speed);
    this.audio.setScrape(0, 0);
    this.audio.setTension(0);
  }

  private chargeAmt(): number {
    return clamp(this.charge / CHARGE_TIME, 0, 1);
  }

  private updateCharge(dt: number, input: Input) {
    if (input.space) {
      if (!this.charging) {
        this.charging = true;
        this.charge = 0;
      }
      this.charge = Math.min(CHARGE_TIME, this.charge + dt);
    } else if (this.charging) {
      this.charging = false;
      const amt = this.chargeAmt();
      this.charge = 0;
      const fi = collisionFeature(this.z);
      const onLip = fi >= 0 && lipHeight(this.x, this.z) > 0.03;
      this.launch(
        onLip ? POP_LIP_BASE + amt * POP_LIP_MAX : POP_SNOW_BASE + amt * POP_SNOW_MAX,
        onLip,
      );
      this.audio.pop();
      this.kick(0.25 + amt * 0.3);
    }
  }

  private launch(vy: number, fromLip: boolean) {
    this.note(`launch vy=${vy.toFixed(2)} lip=${fromLip}`);
    this.snapYaw = null;
    this.airFromRail = false;
    this.state = "AIR";
    this.vy = vy;
    this.y = Math.max(this.y, groundY(this.x, this.z)) + 0.01;
    this.spinVel = 0;
    this.spinAccum = 0;
    this.spinDir = 0;
    this.spinCapped = false;
    this.audio.setCarve(0.1, this.speed);
    const fi = targetFeature(this.z);
    if (fromLip || (this.z <= featureLipZ(fi) + 2 && this.z > railEndZ(fi))) {
      if (!this.attempt.active) this.startAttempt();
    }
  }

  // --- in the air ---------------------------------------------------------

  private updateAir(dt: number, _input: Input, steer: number) {
    this.vy -= G * dt;
    this.y += this.vy * dt;
    this.z -= this.speed * dt;
    this.x += this.vx * dt;
    this.vx *= Math.exp(-0.9 * dt);

    if (this.snapYaw !== null) {
      // Rolling off the end of the rail: settle onto the nearest skiable line.
      this.spinVel = 0;
      this.yaw = dampAngle(this.yaw, this.snapYaw, 9, dt);
    } else if (steer !== 0) {
      if (this.spinDir === 0) this.spinDir = -steer;
      this.spinVel = clamp(this.spinVel - steer * SPIN_ACCEL * dt, -SPIN_MAX, SPIN_MAX);
      this.yaw += this.spinVel * dt;
      this.spinAccum += this.spinVel * dt;
    } else {
      this.spinVel *= Math.exp(-SPIN_DECAY * dt);
      this.yaw += this.spinVel * dt;
      this.spinAccum += this.spinVel * dt;
    }

    const fi = targetFeature(this.z);
    const rs = railStartZ(fi);
    const re = railEndZ(fi);

    // Modest lateral capture assist: only helps a genuinely close approach.
    if (this.z < rs + 12 && this.z > re) {
      const dx = this.x - RAIL_X;
      if (Math.abs(dx) < 2.4) {
        this.x = damp(this.x, RAIL_X, 2.6, dt);
        this.vx = damp(this.vx, 0, 2.6, dt);
      }
    }

    if (this.z <= rs + 0.6 && this.z >= re + 1.2) {
      const top = railTopYAt(fi, this.z);
      // Angular tidy-up in the last moments before contact. It only ever
      // straightens an entry that is already inside the catch window, so a
      // straight-on approach still misses.
      const above = this.y - top;
      if (above > 0 && above < 1.3 && this.vy < 0 && Math.abs(this.x - RAIL_X) <= 1.3) {
        const p = this.perpError();
        if (p.err < RAIL_TOL) {
          const w = (1 - above / 1.3) * 5 * dt;
          this.yaw += wrapPi(p.yaw - this.yaw) * Math.min(1, w);
          this.spinVel *= Math.exp(-6 * dt);
        }
      }
      if (this.vy <= 0.8 && this.y <= top + 0.16 && this.y > top - 0.75) {
        if (Math.abs(this.x - RAIL_X) <= 1.15) {
          this.tryAttach(fi, top);
          return;
        }
      }
      // Ploughed into the side of the rail.
      if (
        Math.abs(this.x - RAIL_X) < RAIL_HALF_W + 0.35 &&
        this.y < top - 0.05 &&
        this.y > top - 1.5
      ) {
        this.crash("BAIL — 0", "air-hit-rail-side");
        return;
      }
    }

    const g = groundY(this.x, this.z);
    // Same idea as the rail catch: inside the last moments of a descent, tidy
    // an already-valid orientation so the landing reads clean rather than
    // permanently crooked. It never rescues an orientation that would fail.
    if (this.snapYaw === null && this.vy < 0 && this.y - g < 1.4) {
      const align = -Math.atan2(this.vx, Math.max(1, this.speed));
      const dFwd = wrapPi(this.yaw - align);
      const dSw = wrapPi(this.yaw - align - Math.PI);
      const target = Math.abs(dFwd) <= Math.abs(dSw) ? align : align + Math.PI;
      if (Math.min(Math.abs(dFwd), Math.abs(dSw)) < LAND_TOL) {
        const w = Math.min(1, (1 - (this.y - g) / 1.4) * 4.5 * dt);
        this.yaw += wrapPi(target - this.yaw) * w;
        this.spinVel *= Math.exp(-5 * dt);
      }
    }
    if (this.y <= g && this.vy < 0) {
      this.y = g;
      this.resolveLanding();
    }
    this.audio.setCarve(0.06, this.speed);
  }

  /** Angular error between the current yaw and a side-on rail orientation. */
  private perpError(): { err: number; yaw: number } {
    const a = wrapPi(this.yaw - Math.PI / 2);
    const b = wrapPi(this.yaw + Math.PI / 2);
    return Math.abs(a) <= Math.abs(b)
      ? { err: Math.abs(a), yaw: Math.PI / 2 }
      : { err: Math.abs(b), yaw: -Math.PI / 2 };
  }

  private tryAttach(fi: number, top: number) {
    const { err, yaw } = this.perpError();
    if (err > RAIL_TOL) {
      this.crash("BAIL — 0", "attach-underrotated");
      return;
    }
    const extra = Math.max(0, Math.round((Math.abs(this.spinAccum) - Math.PI / 2) / Math.PI));
    this.state = "RAIL";
    this.railIndex = fi;
    this.railYaw = yaw;
    this.yaw = wrapPi(yaw);
    this.y = top + 0.02;
    this.vy = 0;
    this.vx = 0;
    this.x = RAIL_X;
    this.speed = Math.min(this.speed, 9.0);
    this.spinVel = 0;

    if (!this.attempt.active) this.startAttempt();
    this.attempt.ridden = true;
    if (extra > 0) {
      this.attempt.base += 100 * extra;
      this.attempt.mult += 0.5 * extra;
    }
    const spinDeg = 90 + 180 * extra;
    const prefix = this.attempt.approachSwitch ? "SWITCH " : "";
    this.attempt.labels.push(`${prefix}${spinDeg} ON`);

    // Entry kick: bigger spin-on, bigger fight. Sloppy angles hurt too.
    const sloppy = smoothstep(RAIL_CLEAN, RAIL_TOL, err);
    const dir = this.spinAccum >= 0 ? -1 : 1;
    this.bal = dir * (0.08 + sloppy * 0.22);
    this.balVel = dir * (0.9 + 0.5 * extra + sloppy * 0.9);
    this.instability = Math.min(3.3, 2.2 + 0.55 * extra + sloppy * 0.5);
    this.band = Math.max(0.09, 0.16 - 0.02 * extra);
    this.settled = false;
    this.settleT = 0;
    this.wanderPhase = Math.random() * 6;

    this.note(`attach ${spinDeg} err=${deg(err).toFixed(0)} bal=${this.bal.toFixed(2)}`);
    this.audio.railLock();
    this.effects.railSparks(this.x, this.y, this.z, 14);
    this.kick(0.4);
    if (extra > 0) this.audio.tick();
  }

  // --- on the rail --------------------------------------------------------

  private updateRail(dt: number, input: Input, steer: number) {
    const fi = this.railIndex;
    // Steel is slower than snow: the bleed-off lengthens the slide and leaves
    // room for two switch-ups plus an exit.
    this.speed = damp(this.speed, 8.0, 2.0, dt);
    this.z -= this.speed * dt;
    this.x = damp(this.x, RAIL_X, 9, dt);
    this.y = railTopYAt(fi, this.z) + 0.02;
    this.yaw = dampAngle(this.yaw, this.railYaw, 12, dt);

    this.updateBalance(dt, steer);
    if (this.state !== "RAIL") return;

    // Charging a rail pop never blocks balancing.
    if (input.space) {
      if (!this.charging) {
        this.charging = true;
        this.charge = 0;
      }
      this.charge = Math.min(CHARGE_TIME, this.charge + dt);
    } else if (this.charging) {
      this.charging = false;
      const amt = this.chargeAmt();
      this.charge = 0;
      this.railPop(amt, steer);
      return;
    }

    if (this.z <= railEndZ(fi)) {
      this.rideOff();
      return;
    }

    if (this.fxBeat) {
      this.effects.railSparks(this.x, this.y - 0.06, this.z, Math.random() > 0.55 ? 1 : 0);
    }
    this.audio.setCarve(0.05, this.speed);
    this.audio.setScrape(0.6 + Math.abs(this.bal) * 0.4, Math.abs(this.bal));
    this.audio.setTension(smoothstep(0.5, 0.98, Math.abs(this.bal)));
  }

  private updateBalance(dt: number, steer: number) {
    this.wanderPhase += dt * (1.1 + this.attempt.switchUps * 0.35);
    const wander =
      (Math.sin(this.wanderPhase) * 0.42 + Math.sin(this.wanderPhase * 2.31 + 1.2) * 0.24) *
      (this.settled ? 1 : 0.5);

    const accel = this.instability * this.bal + wander + steer * BAL_INPUT;
    this.balVel += accel * dt;
    this.balVel *= Math.exp(-BAL_DAMP * dt);
    this.balVel = clamp(this.balVel, -BAL_VEL_MAX, BAL_VEL_MAX);
    this.bal += this.balVel * dt;

    if (!this.settled) {
      if (Math.abs(this.bal) < this.band) {
        this.settleT += dt;
        if (this.settleT > 0.5) {
          this.settled = true;
          this.instability = 1.05 + this.attempt.switchUps * 0.12;
          this.band = 0.16;
          this.audio.tick();
        }
      } else {
        this.settleT = 0;
      }
    }

    if (Math.abs(this.bal) >= 1) {
      this.bal = clamp(this.bal, -1, 1);
      this.x = RAIL_X + this.bal * 0.5;
      this.crash("BAIL — 0", "balance-out");
    }
  }

  private railPop(amt: number, steer: number) {
    const fi = this.railIndex;
    const toEnd = this.z - railEndZ(fi);
    const exiting = toEnd <= EXIT_ZONE;
    this.vy = exiting
      ? EXIT_POP_BASE + amt * EXIT_POP_MAX
      : POP_RAIL_BASE + amt * POP_RAIL_MAX;
    this.spinVel = 0;
    this.spinAccum = 0;
    this.spinDir = -steer;
    this.spinCapped = false;
    this.audio.pop();
    this.kick(0.3);
    this.note(`railpop toEnd=${toEnd.toFixed(1)} dir=${this.spinDir} vy=${this.vy.toFixed(2)}`);
    if (exiting) {
      this.exitRail();
    } else {
      this.state = "RAILAIR";
      this.y += 0.04;
    }
  }

  private rideOff() {
    // Simple drop: turn the nearest 90 degrees into whichever stance is closer.
    // Which one that is depends on the slide direction, so this is not biased
    // toward landing forward.
    const alignYaw = -Math.atan2(this.vx, Math.max(1, this.speed));
    const dFwd = Math.abs(wrapPi(this.yaw - alignYaw));
    const dSw = Math.abs(wrapPi(this.yaw - alignYaw - Math.PI));
    this.snapYaw = dFwd <= dSw ? alignYaw : alignYaw + Math.PI;
    this.spinVel = 0;
    this.vy = 0.35;
    this.exitRail();
    this.note(`rideoff snap=${deg(wrapPi(this.snapYaw)).toFixed(0)}`);
  }

  private exitRail() {
    const fi = this.railIndex;
    this.airFromRail = true;
    this.state = "AIR";
    this.spinCapped = false;
    if (this.attempt.active && this.attempt.ridden) {
      const toEnd = this.z - railEndZ(fi);
      if (toEnd <= EXIT_ZONE + 0.6) this.attempt.base += 250;
    }
    this.attempt.ridden = false;
    this.spinAccum = 0;
    this.note(`exit base=${this.attempt.base.toFixed(0)}`);
    this.audio.setScrape(0, 0);
    this.audio.setTension(0);
  }

  private snapYaw: number | null = null;

  // --- switch-up hop ------------------------------------------------------

  private updateRailAir(dt: number, _input: Input, steer: number) {
    const fi = this.railIndex;
    this.vy -= G * dt;
    this.y += this.vy * dt;
    this.z -= this.speed * dt;
    this.x = damp(this.x, RAIL_X, 5, dt);

    // Switch-ups are 180s: assist the rotation to settle near a half turn.
    if (!this.spinCapped) {
      const dir = this.spinDir !== 0 ? this.spinDir : steer !== 0 ? -steer : 0;
      if (dir !== 0) {
        this.spinVel = clamp(this.spinVel + dir * 26 * dt, -8.5, 8.5);
        if (Math.abs(this.spinAccum) > Math.PI * 0.88) this.spinCapped = true;
      }
    } else {
      this.spinVel *= Math.exp(-9 * dt);
    }
    this.yaw += this.spinVel * dt;
    this.spinAccum += this.spinVel * dt;

    if (this.z <= railEndZ(fi)) {
      this.exitRail();
      return;
    }

    const top = railTopYAt(fi, this.z);
    if (this.vy < 0 && this.y <= top + 0.06) {
      const { err, yaw } = this.perpError();
      if (err > RAIL_TOL) {
        this.crash("BAIL — 0", "switchup-badangle");
        return;
      }
      const n = halves(this.spinAccum);
      this.state = "RAIL";
      this.railYaw = yaw;
      this.yaw = wrapPi(yaw);
      this.y = top + 0.02;
      this.vy = 0;
      this.spinVel = 0;
      this.effects.railSparks(this.x, this.y, this.z, 12);
      this.kick(0.35);

      if (n % 2 === 1) {
        this.attempt.switchUps++;
        this.attempt.base += 250;
        this.attempt.mult += 0.5;
        this.attempt.labels.push("180 SWITCH-UP");
        this.note(`switchup #${this.attempt.switchUps} bal=${this.bal.toFixed(2)}`);
        this.audio.switchUp();
        // Fresh, strong imbalance — alarming but recoverable.
        const k = this.attempt.switchUps;
        const dir = this.spinAccum >= 0 ? -1 : 1;
        this.bal = dir * Math.min(0.82, 0.66 + 0.04 * k);
        this.balVel = dir * (0.3 + 0.12 * k);
        this.instability = Math.min(3.3, 2.5 + 0.28 * k);
        this.band = Math.max(0.1, 0.16 - 0.015 * k);
        this.settled = false;
        this.settleT = 0;
      } else {
        this.note(`reconnect halves=${n} spin=${deg(this.spinAccum).toFixed(0)}`);
        this.audio.railLock();
        this.balVel += (Math.random() - 0.5) * 0.8;
      }
      return;
    }

    if (this.y < top - 1.4) {
      this.crash("BAIL — 0", "switchup-missed");
    }
  }

  // --- landing ------------------------------------------------------------

  private resolveLanding() {
    const alignYaw = -Math.atan2(this.vx, Math.max(1, this.speed));
    const dFwd = Math.abs(wrapPi(this.yaw - alignYaw));
    const dSw = Math.abs(wrapPi(this.yaw - alignYaw - Math.PI));
    const err = Math.min(dFwd, dSw);
    const impact = clamp(-this.vy / 7, 0, 1);

    if (err > LAND_TOL) {
      this.crash("BAIL — 0", "land-badangle");
      return;
    }

    const landSwitch = dSw < dFwd;

    // Exit rotation bonus: half turns completed beyond the base 90 off.
    if (this.attempt.active && this.attempt.labels.length > 0) {
      const n = Math.max(0, Math.round((Math.abs(this.spinAccum) - Math.PI / 2) / Math.PI));
      if (n > 0) {
        this.attempt.base += 150 * n;
        this.attempt.mult += 0.5 * n;
        this.attempt.labels.push(
          `${90 + 180 * n} OFF TO ${landSwitch ? "SWITCH" : "REGULAR"}`,
        );
      } else {
        this.attempt.labels.push(`OFF TO ${landSwitch ? "SWITCH" : "REGULAR"}`);
      }
    }

    this.note(
      `land ${landSwitch ? "switch" : "regular"} err=${deg(err).toFixed(0)} banked=${Math.round(
        Math.round(this.attempt.base) * this.attempt.mult,
      )}`,
    );
    this.snapYaw = null;
    if (landSwitch && !this.isSwitch) {
      // Flipped alongside the steer mapping so the two agree: the side the
      // rotation carried them to is the same side steering that way would pick.
      this.switchShoulder = this.spinAccum >= 0 ? -1 : 1;
    }
    this.isSwitch = landSwitch;
    this.state = "SNOW";
    this.vy = 0;
    this.spinVel = 0;
    this.spinAccum = 0;
    this.y = groundY(this.x, this.z);
    this.yaw = alignYaw + (landSwitch ? Math.PI : 0);
    this.landCompress = 0.6 + impact * 0.5;
    this.sketch = err > rad(28) ? 1 : 0;
    this.effects.landing(this.x, this.y, this.z, impact * 2.2);
    this.audio.land(impact);
    this.kick(0.35 + impact * 0.5);
    this.bank();
  }

  // --- crash & recovery ---------------------------------------------------

  private updateCrash(dt: number) {
    this.crashT += dt;
    this.speed = damp(this.speed, 4.2, 1.4, dt);
    this.z -= this.speed * dt;
    this.x = damp(this.x, clamp(this.x, -COURSE_HW, COURSE_HW), 3, dt);
    this.y = groundY(this.x, this.z);
    this.yaw += dt * 2.2;
    if (this.crashT > 1.0) this.fade = Math.min(1, this.fade + dt * 6);
    if (this.fxBeat && Math.random() > 0.75) {
      this.effects.snow.spawn(
        this.x, this.y + 0.15, this.z,
        (Math.random() - 0.5) * 3, 1.2, 2.0,
        0.5, WHITE, 0.5,
      );
    }
    this.audio.setCarve(0.35, this.speed);
    if (this.crashT > 1.25) this.respawn();
  }

  private respawn() {
    // Drop into the clear ride-away ahead, not on top of the wreck. Solving for
    // the first lip that still leaves at least RESPAWN_MIN_LEAD of approach
    // keeps a long crash slide from stranding the skier on the next take-off.
    const next = Math.max(
      0,
      Math.ceil((FEATURE_Z0 - this.z + RESPAWN_MIN_LEAD) / SEG),
    );
    // `min` because z runs negative downhill: never teleport back uphill, and
    // accept a short approach rather than skipping a whole feature to get the
    // full lead.
    this.z = Math.min(this.z, featureLipZ(next) + RESPAWN_LEAD);
    this.x = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = SPEED_BASE;
    this.y = groundY(this.x, this.z);
    this.yaw = this.isSwitch ? Math.PI : 0;
    this.spinVel = 0;
    this.spinAccum = 0;
    this.state = "SNOW";
    this.charging = false;
    this.charge = 0;
    this.snapYaw = null;
    this.camInit = false;
    this.snapView();
    this.skier.crashRoll = 0;
    this.skier.crashPitch = 0;
  }

  // --- presentation -------------------------------------------------------

  private poseSkier(dt: number) {
    const s = this.skier;
    let crouch = 0.22;
    let lean = 0;
    let twist = 0;
    let headYaw = 0;
    let pitch = 0;
    let armSpread = 0.15;
    let hunch = 0.8;
    let poleRise = POLE_RISE_GROUND;
    let flail = 0;

    const carveLean = clamp(this.vx / CARVE_MAX, -1, 1);

    if (this.state === "SNOW") {
      crouch = 0.40 + this.chargeAmt() * (this.charging ? 0.44 : 0) + this.landCompress * 0.42;
      lean = -carveLean * 0.36;
      twist = carveLean * 0.22 + (this.isSwitch ? 0.15 * this.switchShoulder : 0);
      // Local +X is the skier's right, and the model faces -Z, so a *negative*
      // head yaw turns toward the right shoulder. Steering left gives
      // switchShoulder = +1, which turns the head over the left shoulder.
      headYaw = this.isSwitch ? 0.75 * this.switchShoulder : 0.06;
      // Deepest gorilla stance on snow; it eases off as the skier compresses to
      // pop, so the charge still reads as a distinct wind-up.
      hunch = 0.95 - this.chargeAmt() * (this.charging ? 0.35 : 0);
      armSpread = 0.12 + Math.abs(carveLean) * 0.2 + this.sketch * 0.5;
      pitch = 0.04 + this.landCompress * 0.2;
    } else if (this.state === "AIR") {
      crouch = this.airFromRail ? RAIL_EXIT_CROUCH : 0.5 + this.chargeAmt() * 0.1;
      lean = -clamp(this.spinVel / SPIN_MAX, -1, 1) * 0.3;
      twist = clamp(this.spinVel / SPIN_MAX, -1, 1) * 0.4;
      headYaw = -clamp(this.spinVel / SPIN_MAX, -1, 1) * 0.5;
      armSpread = 0.55 + Math.abs(this.spinVel / SPIN_MAX) * 0.35;
      // The body opens up off the lip, but stays tucked over — going fully
      // upright in the air reads as someone who has lost the trick.
      hunch = 0.55;
      poleRise = POLE_RISE_AIR;
      pitch = clamp(-this.vy * 0.03, -0.18, 0.18);
    } else if (this.state === "RAIL") {
      crouch = RAIL_CROUCH + this.chargeAmt() * (this.charging ? RAIL_CHARGE_CROUCH : 0);
      lean = this.bal * 0.55;
      twist = -this.bal * 0.45 + 0.28;
      headYaw = -0.35 - this.bal * 0.3;
      armSpread = 0.45 + Math.abs(this.bal) * 0.55;
      // Barely any fold here. On a rail the weight has to stay stacked over
      // the steel — a torso pitched out over the toes is the shape of someone
      // about to bail, and it fights the balance lean the player is reading.
      hunch = 0.3;
      pitch = 0.04;
    } else if (this.state === "RAILAIR") {
      crouch = 0.4;
      lean = clamp(this.spinVel / 8, -1, 1) * 0.25;
      twist = clamp(this.spinVel / 8, -1, 1) * 0.4;
      armSpread = 0.6;
      hunch = 0.5;
      poleRise = POLE_RISE_AIR;
    } else if (this.state === "CRASH") {
      crouch = 0.75;
      armSpread = 0.9;
      hunch = 0.15;
      flail = 1;
      s.crashRoll = damp(s.crashRoll, 1.05, 7, dt);
      s.crashPitch = damp(s.crashPitch, 0.42, 6, dt);
    }

    if (this.state !== "CRASH") {
      s.crashRoll = damp(s.crashRoll, 0, 9, dt);
      s.crashPitch = damp(s.crashPitch, 0, 9, dt);
    }

    const wob = this.sketch * Math.sin(this.clock * 26) * 0.28;
    s.setPose({
      crouch: clamp(crouch, 0, 1),
      lean: lean + wob,
      twist,
      headYaw,
      pitch,
      armSpread: clamp(armSpread, 0, 1),
      hunch,
      poleRise,
      flail,
      t: this.clock,
    });

    s.root.position.set(this.viewX, this.viewY + s.clearance(), this.viewZ);
    s.root.rotation.y = this.viewYaw;
    // Never let a contact point sit under the visible snow. This also catches
    // the case where interpolating a chord across a convex roller or lip would
    // otherwise cut below the surface.
    const floor = groundY(this.viewX, this.viewZ) + 0.02;
    if (s.root.position.y < floor) s.root.position.y = floor;
  }

  private updateCamera(dt: number) {
    // Behind and above the direction of travel, pitched down enough that the
    // approach, lip, rail and landing all stay in frame.
    const back = 8.2;
    const up = 4.6;
    const targetX = this.viewX * 0.72;
    const targetY = Math.max(this.viewY, groundY(this.viewX, this.viewZ)) + up;
    const targetZ = this.viewZ + back;
    const lookY = groundY(this.viewX, this.viewZ - 9) + 0.9;

    if (!this.camInit) {
      this.camPos.set(targetX, targetY, targetZ);
      this.camLook.set(this.viewX, lookY, this.viewZ - 9);
      this.camInit = true;
    } else {
      this.camPos.x = damp(this.camPos.x, targetX, 3.6, dt);
      this.camPos.y = damp(this.camPos.y, targetY, 3.4, dt);
      this.camPos.z = damp(this.camPos.z, targetZ, 6.5, dt);
      this.camLook.x = damp(this.camLook.x, this.viewX * 0.9, 4.5, dt);
      this.camLook.y = damp(this.camLook.y, lookY, 3.2, dt);
      this.camLook.z = damp(this.camLook.z, this.viewZ - 9, 6.0, dt);
    }

    // Restrained impact shake.
    this.shakeVel.multiplyScalar(Math.exp(-6 * dt));
    this.shake.addScaledVector(this.shakeVel, dt);
    this.shake.multiplyScalar(Math.exp(-7 * dt));
    this.shake.clampScalar(-0.35, 0.35);

    this.camera.position.copy(this.camPos).add(this.shake);
    this.camera.lookAt(this.camLook);
  }

  private updateHud(dt: number) {
    this.hud.update(dt);
    this.hud.setScore(this.session);
    const pts = Math.round(Math.round(this.attempt.base) * this.attempt.mult);
    this.hud.setCombo(
      this.attempt.active && (this.attempt.base > 0 || this.attempt.labels.length > 0),
      pts,
      this.attempt.mult,
      this.attempt.labels.join("  +  "),
    );
    this.hud.setStance(this.isSwitch);
    this.hud.setMeter(this.state === "RAIL", this.bal, this.band * 2, this.settled);

    // The reminder fades on its own after a few attempts; never needs dismissing.
    if (this.attempts >= 3 || this.clock > 34) this.hintAlpha -= dt * 0.7;
    this.hud.setHint(clamp(this.hintAlpha, 0, 1));

    if (this.state !== "CRASH" && this.fade > 0) this.fade = Math.max(0, this.fade - dt * 3.5);
    this.hud.setFade(this.fade);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Exposed for automated play-testing in the browser. */
  debugState() {
    return {
      state: this.state,
      // Accumulated simulation time. Because `dt` is clamped per frame, sim time
      // runs slower than wall-clock whenever the frame rate drops — tests should
      // measure progress against this, not against a real-world timer.
      clock: this.clock,
      trace: this.trace.slice(-14),
      distToLip: this.z - featureLipZ(targetFeature(this.z)),
      sceneObjects: (() => {
        let n = 0;
        this.world.scene.traverse(() => n++);
        return n;
      })(),
      railLeft: this.railIndex >= 0 ? this.z - railEndZ(this.railIndex) : -1,
      x: this.x,
      y: this.y,
      z: this.z,
      groundY: groundY(this.x, this.z),
      skierY: this.skier.root.position.y,
      yaw: deg(wrapPi(this.yaw)),
      isSwitch: this.isSwitch,
      speed: this.speed,
      bal: this.bal,
      session: this.session,
      combo: Math.round(Math.round(this.attempt.base) * this.attempt.mult),
      mult: this.attempt.mult,
      labels: this.attempt.labels.join(" + "),
      lift: this.skier.root.position.y - groundY(this.x, this.z),
    };
  }
}
