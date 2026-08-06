/**
 * Session progression.
 *
 * You start barely able to ski and unlock ability by banking points. A fresh
 * page load starts over — this is a run to be replayed, not a save file, so
 * nothing here touches storage.
 *
 * Ability is expressed as physics wherever possible rather than as rules: a
 * beginner cannot throw a 270 because their spin is slow and their pop is
 * small, not because a check rejects it. The two exceptions are the switch and
 * switch-up gates, which have to be explicit — see `canSwitch` below.
 */
export interface Level {
  /** Only shown once reached; locked rows read LOCKED on the HUD. */
  name: string;
  /** Points needed **on a single rail hit** to reach it. */
  at: number;
  /** Scales SPIN_ACCEL and SPIN_MAX. */
  spin: number;
  /** Scales every pop height — lip, snow, switch-up and exit. */
  pop: number;
  /**
   * Half-turns past the base 90 allowed onto the rail: 0 is a 90 on, 1 a 270,
   * 2 a 450, 3 a 630. Enforced as a ceiling on accumulated air rotation, so the
   * skier physically stops turning rather than being scored down for
   * over-rotating.
   *
   * This must stay inside what the tier's `spin` and `pop` can actually deliver
   * in the available hang time. Set it higher than that and the skier never
   * stops driving the rotation, lands mid-turn and bails every attempt — so
   * re-measure after changing either.
   */
  entryHalves: number;
  /** The same off the rail. 0 means exits auto-snap and cannot be spun. */
  exitHalves: number;
  /**
   * Whether the skier can ride away switch. Off, rail exits snap to the forward
   * stance. This can't be left to the spin ceiling: coming off a rail the skier
   * is already sideways, so a mere 90 in the continuing direction would land
   * them switch.
   */
  canSwitch: boolean;
  /** Whether mid-rail switch-up hops are available at all. */
  switchUps: boolean;
  /** Scales rail instability. Lower is steadier — better riders fight less. */
  instability: number;
}

/**
 * Every tier must be reachable in **one hit** at the tier below it, so nothing
 * here is a grind — you unlock by finally landing a better run, not by
 * repeating the one you already have.
 *
 * Measured single-hit ceilings, running the real scoring path: beginner ~520,
 * intermediate ~1,200, advanced ~5,580, NS Kid ~6,980, pro ~8,200. Each
 * threshold sits below the ceiling of the tier that has to clear it, so every
 * gate is one good run away rather than a grind. Re-measure the ceilings if any
 * scoring award changes — these numbers are downstream of the whole table.
 */
export const LEVELS: readonly Level[] = [
  {
    name: "BEGINNER",
    at: 0,
    spin: 0.6,
    pop: 0.72,
    entryHalves: 0,
    exitHalves: 0,
    canSwitch: false,
    switchUps: false,
    instability: 1,
  },
  {
    name: "INTERMEDIATE",
    at: 400,
    spin: 0.74,
    pop: 0.84,
    entryHalves: 0,
    exitHalves: 1,
    canSwitch: true,
    switchUps: false,
    instability: 0.95,
  },
  {
    name: "ADVANCED",
    at: 1_000,
    spin: 0.86,
    pop: 0.93,
    entryHalves: 1,
    exitHalves: 1,
    canSwitch: true,
    switchUps: true,
    instability: 0.9,
  },
  {
    name: "NS KID",
    at: 2_500,
    spin: 0.94,
    pop: 1,
    entryHalves: 1,
    exitHalves: 2,
    canSwitch: true,
    switchUps: true,
    instability: 0.85,
  },
  {
    name: "PRO",
    at: 3_500,
    spin: 1,
    pop: 1,
    entryHalves: 2,
    exitHalves: 2,
    canSwitch: true,
    switchUps: true,
    instability: 0.8,
  },
  {
    name: "WOM TALLISCH",
    at: 5_000,
    // Enough spin and hang time to actually get a 630 round. Measured at the
    // previous 1.25/1.05 the ceiling was 596 degrees onto the rail — 34 short
    // of a 630 on, which would have meant driving the rotation to a target the
    // tier could not reach and bailing every attempt.
    spin: 1.4,
    pop: 1.1,
    entryHalves: 3,
    exitHalves: 3,
    canSwitch: true,
    switchUps: true,
    instability: 0.74,
  },
];

/** Index of the highest level unlocked by a best single hit of `best`. */
export function levelAt(best: number): number {
  let i = 0;
  while (i + 1 < LEVELS.length && best >= LEVELS[i + 1].at) i++;
  return i;
}
