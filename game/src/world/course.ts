import { smoothstep } from "../core/util";

/**
 * Course layout maths. Everything the renderer draws and everything the
 * simulation collides against is derived from these functions, so the visible
 * snow surface and the collision surface can never disagree.
 *
 * World axes: the fall line runs toward -Z, screen-right is +X, up is +Y.
 * The groomed base plane is y = SLOPE * z (z is negative downhill, so y falls).
 */

export const SLOPE = 0.16;
/** Distance between identical rail set-ups. */
export const SEG = 72;
/** z of the first feature's lip start. */
export const FEATURE_Z0 = -60;

export const LIP_LEN = 5.5;
/** Height above the local snow at the lip edge. The hill drops 0.88m over the
 *  same run, so this is what makes the take-off actually kick upward. */
export const LIP_H = 1.7;
export const LIP_HW = 3.4;
/**
 * Gap between the lip edge and the start of the rail. Sized so the slowest
 * take-off the game allows just reaches the steel: at 3.5m an uncharged pop
 * landed 3m up the rail and a full-charge pop landed 10.5m up it, so the whole
 * charge range was spent overshooting rail rather than using it.
 */
export const GAP = 6.5;

/** 20% longer than the original 18m: room for a 360 switch-up (~8m of rail)
 *  and still a second hit plus a clean exit. */
export const RAIL_LEN = 21.6;
export const RAIL_H0 = 1.0;
/** The rail is flatter than the hill, so the landing falls away beneath it. */
export const RAIL_SLOPE = 0.11;
export const RAIL_X = 0;
export const RAIL_HALF_W = 0.11;

/** Half width of the skiable groomed lane. */
export const COURSE_HW = 15;

export function featureLipZ(i: number): number {
  return FEATURE_Z0 - i * SEG;
}

export function lipEndZ(i: number): number {
  return featureLipZ(i) - LIP_LEN;
}

export function railStartZ(i: number): number {
  return lipEndZ(i) - GAP;
}

export function railEndZ(i: number): number {
  return railStartZ(i) - RAIL_LEN;
}

/** Total downhill length occupied by one feature's geometry. */
export const FEATURE_LEN = LIP_LEN + GAP + RAIL_LEN;

/**
 * Index of the feature whose geometry could contain z, or -1 when z sits in
 * the open ride-away between features.
 */
export function collisionFeature(z: number): number {
  const u = (FEATURE_Z0 - z) / SEG;
  const i = Math.floor(u);
  if (i < 0) return -1;
  return u - i <= (FEATURE_LEN + 4) / SEG ? i : -1;
}

/** The feature the skier is currently working with (upcoming or underfoot). */
export function targetFeature(z: number): number {
  const c = collisionFeature(z);
  if (c >= 0) return c;
  return Math.max(0, Math.ceil((FEATURE_Z0 - z) / SEG));
}

/** Height of the shaped snow lip above the base plane. */
export function lipHeight(x: number, z: number): number {
  const i = collisionFeature(z);
  if (i < 0) return 0;
  const d = featureLipZ(i) - z;
  if (d < 0 || d > LIP_LEN) return 0;
  return lipProfile(d) * lipLateral(x);
}

export function lipProfile(d: number): number {
  const t = d / LIP_LEN;
  return LIP_H * Math.pow(t, 1.5);
}

export function lipLateral(x: number): number {
  const u = Math.abs(x - RAIL_X) / LIP_HW;
  return 1 - smoothstep(0.6, 1.0, u);
}

/**
 * Gentle roller in the ride-away between features. It is flat across the whole
 * feature (lip, rail, landing) so the trick geometry stays exact, and its
 * period matches the feature spacing so recycled terrain tiles stay seamless.
 */
export const ROLL_H = 1.15;
const ROLL_START = FEATURE_LEN + 6;

export function rollHeight(z: number): number {
  const s = (((FEATURE_Z0 - z) % SEG) + SEG) % SEG;
  if (s < ROLL_START) return 0;
  const t = (s - ROLL_START) / (SEG - ROLL_START);
  return (ROLL_H * (1 - Math.cos(t * Math.PI * 2))) / 2;
}

/** Snow surface height. */
export function groundY(x: number, z: number): number {
  return SLOPE * z + rollHeight(z) + lipHeight(x, z);
}

/** Top surface of feature i's rail at downhill position z. */
export function railTopYAt(i: number, z: number): number {
  const rs = railStartZ(i);
  return SLOPE * rs + RAIL_H0 - RAIL_SLOPE * (rs - z);
}

export function onRailSpan(i: number, z: number, pad = 0): boolean {
  return z <= railStartZ(i) + pad && z >= railEndZ(i) - pad;
}
