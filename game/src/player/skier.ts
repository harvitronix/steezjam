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
  tuck: number;
  flail: number;
  t: number;
}

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
  g.translate(0, 0, 0);
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
      boot.add(box(0.2, 0.2, 0.3, bootMat, -0.05, 0, 0.01));
      boot.add(box(0.22, 0.07, 0.34, lam("#4a4f57"), -0.13, 0, 0.02));
    }

    // --- torso ------------------------------------------------------------
    this.chest.position.y = 0.2;
    this.hips.add(this.chest);
    this.chest.add(box(0.62, 0.44, 0.42, jacket, 0.22));
    this.chest.add(box(0.63, 0.14, 0.43, jacketAlt, 0.05));
    this.chest.add(box(0.6, 0.12, 0.41, jacketDark, 0.44));
    // Hood slouched behind the neck.
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), jacketAlt);
    hood.scale.set(1, 0.7, 0.8);
    hood.position.set(0, 0.46, 0.17);
    hood.castShadow = true;
    this.chest.add(hood);

    const arms: Array<[THREE.Group, THREE.Group, number]> = [
      [this.armL, this.foreL, -1],
      [this.armR, this.foreR, 1],
    ];
    for (const [arm, fore, side] of arms) {
      arm.position.set(side * 0.34, 0.4, 0);
      this.chest.add(arm);
      arm.add(box(0.2, 0.32, 0.22, side < 0 ? jacketAlt : jacket, -0.15));
      fore.position.y = -0.3;
      arm.add(fore);
      fore.add(box(0.18, 0.3, 0.2, jacket, -0.14));
      fore.add(box(0.14, 0.11, 0.16, jacketDark, -0.32));
      // Pole hanging loose from the glove.
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 1.15, 5),
        lam("#d8dde3"),
      );
      pole.position.set(0, -0.34, 0.34);
      pole.rotation.x = Math.PI / 2 - 0.35;
      fore.add(pole);
      const basket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8),
        lam("#ff7a18"),
      );
      basket.position.set(0, -0.5, 0.85);
      basket.rotation.x = Math.PI / 2 - 0.35;
      fore.add(basket);
    }

    // --- head -------------------------------------------------------------
    this.head.position.y = 0.56;
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
      tuck: 0,
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
    for (const [thigh, shin, boot, side] of [
      [this.thighL, this.shinL, this.bootL, -1] as const,
      [this.thighR, this.shinR, this.bootR, 1] as const,
    ]) {
      thigh.rotation.x = thighA + sway * side;
      thigh.rotation.z = side * 0.06 * crouch;
      shin.rotation.x = shinA;
      boot.rotation.x = -(thigh.rotation.x + shin.rotation.x);
      boot.position.y = -L_SHIN;
    }

    this.hips.rotation.x = p.pitch * 0.5 + crouch * 0.16;
    this.chest.rotation.y = p.twist;
    this.chest.rotation.x = p.pitch * 0.7 + p.tuck * 0.55 + crouch * 0.22;
    this.chest.rotation.z = -p.lean * 0.22;

    this.head.rotation.y = p.headYaw - p.twist;
    this.head.rotation.x = -this.chest.rotation.x * 0.7 - this.hips.rotation.x * 0.4;

    const spread = p.armSpread;
    const bob = Math.sin(p.t * 2.4) * 0.06;
    const flail = p.flail;
    for (const [arm, fore, side] of [
      [this.armL, this.foreL, -1] as const,
      [this.armR, this.foreR, 1] as const,
    ]) {
      arm.rotation.z = side * (0.22 + spread * 1.05 + flail * 0.9);
      arm.rotation.x = -0.12 - p.tuck * 0.9 + bob * side + flail * Math.sin(p.t * 9 + side) * 0.6;
      arm.rotation.y = side * spread * 0.3;
      fore.rotation.x = -0.45 - spread * 0.35 - p.tuck * 0.5 + flail * 0.4;
      fore.rotation.z = -side * 0.18;
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
