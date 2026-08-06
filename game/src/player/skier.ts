import * as THREE from "three";
import { clamp, lerp } from "../core/util";

/**
 * Mid-2000s park skier: oversized outerwear, baggy pants over chunky boots,
 * loud twin tips, goggles + low helmet, poles hanging loose.
 *
 * Rig layout:
 *   root    yaw / pitch, sits at the snow contact point
 *    +- skis    kept nearly flat so the bases never dig into the snow
 *    +- rig     rolls about the ski line for lean / rail balance
 *        +- hips -> legs (2-link IK) -> boots
 *        +- chest -> arms + poles, head
 */

const JACKET = "#f2521d";
const JACKET_ALT = "#ffcf2e";
const JACKET_DARK = "#16265e";
const PANTS = "#1d2f74";
const PANTS_ALT = "#3f5bd6";
const BOOT = "#2b2b31";
const SKIN = "#e0a984";
const HELMET = "#f4f6f8";

const L_THIGH = 0.42;
const L_SHIN = 0.42;
const FOOT_Y = 0.15;
const STAND_HIP = 0.94;

export interface SkierPose {
  crouch: number;
  lean: number;
  twist: number;
  headYaw: number;
  pitch: number;
  armSpread: number;
  /**
   * "Gorilla steez": 0 is upright, 1 is the mid-2000s park stance — torso
   * folded forward over the knees, arms hanging long so the hands drop to
   * about knee height, poles held out wide rather than tucked in.
   */
  hunch: number;
  /** Angle the pole baskets ride above the grips, in radians. Negative droops. */
  poleRise: number;
  flail: number;
  t: number;
}

/** How far back from straight-out-sideways the poles are swept. */
const POLE_SWEEP = 0.62;
/** On snow the baskets ride up, since the hands are carried low. */
export const POLE_RISE_GROUND = 0.3;
/** Airborne they hang lower — poles held level in the air read as stiff. */
export const POLE_RISE_AIR = -0.16;

// Scratch objects — setPose runs every frame and must not allocate.
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _qDesired = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();

function lam(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  y = 0,
  x = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function topsheetTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111318";
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = "#ff2d20";
  g.fillRect(0, 0, 128, 12);
  g.fillStyle = "#ffd21e";
  g.fillRect(0, 20, 128, 12);
  g.fillStyle = "#00d4ff";
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 16, 12);
    g.lineTo(i * 16 + 8, 20);
    g.lineTo(i * 16 + 16, 12);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.4, 1);
  return t;
}

function skiGeometry(): THREE.BufferGeometry {
  // Side profile of a twin tip, extruded across the ski width.
  const s = new THREE.Shape();
  const L = 0.92;
  const th = 0.035;
  s.moveTo(-L, 0.0);
  s.lineTo(-L * 0.82, -0.02);
  s.lineTo(L * 0.82, -0.02);
  s.lineTo(L, 0.0);
  s.lineTo(L, 0.1);
  s.lineTo(L * 0.78, th);
  s.lineTo(-L * 0.78, th);
  s.lineTo(-L, 0.1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  // Extrusion starts at zero, so center its width on the mesh origin.
  g.translate(-0.08, 0, 0);
  return g;
}

export class Skier {
  readonly root = new THREE.Group();
  readonly skis = new THREE.Group();
  private rig = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private thighL = new THREE.Group();
  private thighR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  private bootL = new THREE.Group();
  private bootR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  /** Pole rigs, gripped at the group origin with the shaft running along +Y. */
  private poleL = new THREE.Group();
  private poleR = new THREE.Group();
  /** Extra roll applied to the whole rig, used for crash tumbles. */
  crashRoll = 0;
  crashPitch = 0;

  constructor() {
    const jacket = lam(JACKET);
    const jacketAlt = lam(JACKET_ALT);
    const jacketDark = lam(JACKET_DARK);
    const pants = lam(PANTS);
    const pantsAlt = lam(PANTS_ALT);
    const bootMat = lam(BOOT);
    const skin = lam(SKIN);

    // --- skis -------------------------------------------------------------
    const topMat = new THREE.MeshLambertMaterial({ map: topsheetTexture() });
    const baseMat = lam("#1b1d22");
    const skiGeo = skiGeometry();
    for (const side of [-1, 1]) {
      const ski = new THREE.Mesh(skiGeo, [baseMat, topMat]);
      ski.castShadow = true;
      ski.position.set(side * 0.18, 0.02, -0.02);
      this.skis.add(ski);
      const binding = box(0.16, 0.06, 0.34, lam("#22252b"), 0.07, side * 0.18, -0.02);
      this.skis.add(binding);
    }
    this.root.add(this.skis);

    // --- legs -------------------------------------------------------------
    this.root.add(this.rig);
    this.hips.position.y = STAND_HIP;
    this.rig.add(this.hips);
    this.hips.add(box(0.5, 0.3, 0.34, pants, 0.02));
    this.hips.add(box(0.52, 0.09, 0.36, jacketDark, 0.14));

    const legs: Array<[THREE.Group, THREE.Group, THREE.Group, number]> = [
      [this.thighL, this.shinL, this.bootL, -1],
      [this.thighR, this.shinR, this.bootR, 1],
    ];
    for (const [thigh, shin, boot, side] of legs) {
      thigh.position.set(side * 0.17, -0.06, 0);
      this.hips.add(thigh);
      // Baggy pants: wide, slightly tapered tubes.
      thigh.add(box(0.29, L_THIGH + 0.06, 0.31, pants, -L_THIGH / 2 + 0.02));
      shin.position.y = -L_THIGH;
      thigh.add(shin);
      shin.add(box(0.27, L_SHIN + 0.02, 0.29, pants, -L_SHIN / 2));
      // Cuff bunching above the boot.
      shin.add(box(0.31, 0.15, 0.33, pantsAlt, -L_SHIN + 0.09));
      boot.position.y = -L_SHIN;
      shin.add(boot);
      // Built upward from the sole, not downward from the ankle. The IK settles
      // the ankle at a fixed height whatever the crouch, and hanging a 0.165m
      // boot below that put its sole 0.075m *under* the ski — the topsheet ran
      // straight through the middle of it.
      boot.add(box(0.2, 0.2, 0.3, bootMat, 0.08, 0, 0.01));
      boot.add(box(0.22, 0.07, 0.34, lam("#4a4f57"), 0.0, 0, 0.02));
    }

    // --- torso ------------------------------------------------------------
    this.chest.position.y = 0.2;
    this.hips.add(this.chest);
    this.chest.add(box(0.62, 0.44, 0.42, jacket, 0.22));
    this.chest.add(box(0.63, 0.14, 0.43, jacketAlt, 0.05));
    this.chest.add(box(0.6, 0.12, 0.41, jacketDark, 0.44));
    const arms: Array<[THREE.Group, THREE.Group, THREE.Group, number]> = [
      [this.armL, this.foreL, this.poleL, -1],
      [this.armR, this.foreR, this.poleR, 1],
    ];
    for (const [arm, fore, pole, side] of arms) {
      arm.position.set(side * 0.34, 0.4, 0);
      this.chest.add(arm);
      arm.add(box(0.2, 0.32, 0.22, side < 0 ? jacketAlt : jacket, -0.15));
      fore.position.y = -0.3;
      arm.add(fore);
      fore.add(box(0.18, 0.3, 0.2, jacket, -0.14));
      fore.add(box(0.14, 0.11, 0.16, jacketDark, -0.32));

      // The pole hangs off the glove, but its *direction* is driven in chest
      // space by setPose — parenting the shaft straight to the forearm made it
      // swing wildly with every arm animation.
      pole.position.y = -0.34;
      fore.add(pole);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 1.02, 5),
        lam("#d8dde3"),
      );
      // Grip sits near the origin with a short stub above the fist.
      shaft.position.y = 0.36;
      shaft.castShadow = true;
      pole.add(shaft);
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, 0.16, 6),
        lam("#16181c"),
      );
      grip.position.y = -0.06;
      pole.add(grip);
      const basket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8),
        lam("#ff7a18"),
      );
      basket.position.y = 0.75;
      pole.add(basket);
    }

    // --- head -------------------------------------------------------------
    this.head.position.y = 0.63;
    this.chest.add(this.head);
    this.head.add(box(0.16, 0.1, 0.16, skin, 0.0));
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10), lam(HELMET));
    skull.scale.set(1, 0.95, 1.05);
    skull.position.y = 0.13;
    skull.castShadow = true;
    this.head.add(skull);
    this.head.add(box(0.35, 0.055, 0.35, lam("#e33a12"), 0.2));
    const goggles = box(0.31, 0.11, 0.06, lam("#101216"), 0.11, 0, -0.13);
    this.head.add(goggles);
    const lens = box(0.27, 0.085, 0.03, new THREE.MeshLambertMaterial({
      color: "#43d8ff",
      emissive: new THREE.Color("#0b5f7a"),
    }), 0.11, 0, -0.16);
    this.head.add(lens);
    this.head.add(box(0.34, 0.07, 0.02, lam("#ffcf2e"), 0.12, 0, 0.16));

    this.setPose({
      crouch: 0.25,
      lean: 0,
      twist: 0,
      headYaw: 0,
      pitch: 0,
      armSpread: 0.2,
      hunch: 0.85,
      poleRise: POLE_RISE_GROUND,
      flail: 0,
      t: 0,
    });
  }

  setPose(p: SkierPose) {
    const crouch = clamp(p.crouch, 0, 1);
    const hipY = STAND_HIP - 0.4 * crouch;
    this.hips.position.y = hipY;

    // Two-link IK so the boots stay planted on the skis at every crouch depth.
    const h = clamp(hipY - FOOT_Y, 0.34, L_THIGH + L_SHIN - 0.005);
    const knee = Math.acos(
      clamp((L_THIGH * L_THIGH + L_SHIN * L_SHIN - h * h) / (2 * L_THIGH * L_SHIN), -1, 1),
    );
    const thighA = Math.acos(
      clamp((L_THIGH * L_THIGH + h * h - L_SHIN * L_SHIN) / (2 * L_THIGH * h), -1, 1),
    );
    const shinA = -(Math.PI - knee);
    const sway = Math.sin(p.t * 2.1) * 0.02;

    // Set before the legs are posed: the IK below solves the chain in hips
    // space, so it needs to know how far the hips are tipped.
    const hunch = clamp(p.hunch, 0, 1);
    this.hips.rotation.x = p.pitch * 0.5 + crouch * 0.16 - hunch * 0.2;

    for (const [thigh, shin, boot, side] of [
      [this.thighL, this.shinL, this.bootL, -1] as const,
      [this.thighR, this.shinR, this.bootR, 1] as const,
    ]) {
      // Cancel the hip pitch out of the chain. Without this the legs swing with
      // the folding torso — the IK places the foot straight down in *hips*
      // space, which stops being straight down the moment the hips rotate, and
      // the boots drift off the back of the skis.
      thigh.rotation.x = thighA + sway * side - this.hips.rotation.x;
      thigh.rotation.z = side * 0.06 * crouch;
      shin.rotation.x = shinA;
      // Levelled against the whole chain, hips included, so the soles stay flat
      // on the topsheets rather than tipping with the torso.
      boot.rotation.x = -(this.hips.rotation.x + thigh.rotation.x + shin.rotation.x);
      boot.position.y = -L_SHIN;
    }
    this.chest.rotation.y = p.twist;
    // The fold happens mostly at the chest, so the silhouette breaks over the
    // knees rather than bending the whole body like a plank.
    // NOTE the sign: travel runs toward -Z, so a *positive* rotation.x tips the
    // torso uphill. Folding forward over the skis means going negative.
    this.chest.rotation.x = p.pitch * 0.7 - hunch * 0.88 + crouch * 0.22;
    this.chest.rotation.z = -p.lean * 0.22;

    this.head.rotation.y = p.headYaw - p.twist;
    // Chin stays up as the torso folds — a hunched skier still looks down the
    // hill, and it keeps the goggles readable from the chase camera.
    this.head.rotation.x = -this.chest.rotation.x * 0.86 - this.hips.rotation.x * 0.5;

    const spread = p.armSpread;
    const bob = Math.sin(p.t * 2.4) * 0.06;
    const flail = p.flail;
    // Arms hang plumb rather than swinging forward with the folded chest, which
    // is what drops the hands to knee height instead of out in front of the face.
    const plumb = -(this.chest.rotation.x + this.hips.rotation.x) * 0.95 * hunch;
    for (const [arm, fore, pole, side] of [
      [this.armL, this.foreL, this.poleL, -1] as const,
      [this.armR, this.foreR, this.poleR, 1] as const,
    ]) {
      arm.rotation.z = side * (0.22 + spread * 1.05 + flail * 0.9 - hunch * 0.1);
      arm.rotation.x = -0.12 + plumb + bob * side + flail * Math.sin(p.t * 9 + side) * 0.6;
      arm.rotation.y = side * spread * 0.3;
      // Elbows straighten as the stance deepens, reaching the hands lower.
      fore.rotation.x = -0.45 - spread * 0.35 + hunch * 0.4 + flail * 0.4;
      fore.rotation.z = -side * 0.18;

      // Aim the pole in rig space — out sideways, swept back, basket high.
      // Aiming it in chest space instead tips the baskets straight into the
      // snow, because the torso fold takes that whole frame down with it.
      // Chest yaw is folded back in so the poles still swing with the
      // shoulders when the skier counter-rotates.
      const sweep = POLE_SWEEP + spread * 0.25;
      const cr = Math.cos(p.poleRise);
      _dir.set(
        side * Math.cos(sweep) * cr,
        Math.sin(p.poleRise),
        Math.sin(sweep) * cr,
      );
      _dir.applyAxisAngle(UP, this.chest.rotation.y);
      _qDesired.setFromUnitVectors(UP, _dir);
      _qParent
        .copy(this.hips.quaternion)
        .multiply(this.chest.quaternion)
        .multiply(arm.quaternion)
        .multiply(fore.quaternion)
        .invert();
      pole.quaternion.copy(_qParent).multiply(_qDesired);
    }

    this.rig.rotation.z = p.lean + this.crashRoll;
    this.rig.rotation.x = this.crashPitch;
    // The skis keep only a fraction of the lean, so they read as edged without
    // ever tipping a corner below the snow.
    this.skis.rotation.z = lerp(0, p.lean, 0.3) + this.crashRoll;
    this.skis.rotation.x = this.crashPitch;
  }

  /**
   * Vertical clearance the root needs so no ski corner drops under the snow,
   * given the current roll/pitch of the rig.
   */
  clearance(): number {
    const roll = Math.abs(this.skis.rotation.z) + Math.abs(this.crashRoll);
    const pitch = Math.abs(this.crashPitch);
    return 0.035 + 0.34 * Math.sin(clamp(roll, 0, 1.4)) + 0.95 * Math.sin(clamp(pitch, 0, 1.2));
  }
}
