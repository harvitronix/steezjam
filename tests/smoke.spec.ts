import { test, expect, type Page } from "@playwright/test";

/** Shape of the debug hook the game installs on `window`. */
interface DebugState {
  state: "SNOW" | "AIR" | "RAIL" | "RAILAIR" | "CRASH";
  clock: number;
  x: number;
  y: number;
  z: number;
  groundY: number;
  skierY: number;
  lift: number;
  yaw: number;
  isSwitch: boolean;
  speed: number;
  bal: number;
  session: number;
  combo: number;
  mult: number;
  labels: string;
  sceneObjects: number;
  distToLip: number;
  railLeft: number;
  trace: string[];
}

declare global {
  interface Window {
    gameState: () => DebugState;
  }
}

async function readState(page: Page): Promise<DebugState> {
  return page.evaluate(() => window.gameState());
}

/**
 * Waits until the *simulation* has advanced by `seconds`, not the wall clock.
 * Software WebGL on a loaded machine can drop to a few frames per second, and
 * the game clamps `dt` per frame — so wall-clock sleeps make these assertions
 * flaky for reasons that have nothing to do with the game being wrong.
 */
async function play(page: Page, seconds: number, budgetMs = 60_000) {
  const target = (await readState(page)).clock + seconds;
  await page.waitForFunction(
    (t) => window.gameState().clock >= t,
    target,
    { timeout: budgetMs, polling: 100 },
  );
}

/** Holds a key for `seconds` of simulation time. */
async function hold(page: Page, key: string, seconds: number) {
  await page.keyboard.down(key);
  await play(page, seconds);
  await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  // Attach so each test can assert on it.
  (page as unknown as { _errors: string[] })._errors = errors;

  await page.goto("/");
  await page.waitForFunction(() => typeof window.gameState === "function");
});

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { _errors: string[] })._errors ?? [];
  expect(errors, "no page or console errors").toEqual([]);
});

test("boots straight into a playable skiing scene", async ({ page }) => {
  const s = await readState(page);
  expect(s.state).toBe("SNOW");
  expect(s.speed).toBeGreaterThan(0);
  expect(s.sceneObjects).toBeGreaterThan(10);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#hud")).toBeVisible();
});

test("skier travels continuously downhill", async ({ page }) => {
  const a = await readState(page);
  await play(page, 1.5);
  const b = await readState(page);
  // The fall line runs toward -Z.
  expect(b.z).toBeLessThan(a.z - 5);
});

test("carving moves the skier laterally in both directions", async ({ page }) => {
  const start = (await readState(page)).x;
  await hold(page, "ArrowRight", 0.8);
  const right = (await readState(page)).x;
  expect(right).toBeGreaterThan(start + 0.5);

  await hold(page, "ArrowLeft", 1.4);
  const left = (await readState(page)).x;
  expect(left).toBeLessThan(right - 0.5);
});

test("a charged pop gets the skier airborne", async ({ page }) => {
  // CHARGE_TIME is 0.7s of simulation time; hold past it for a full charge.
  await hold(page, "Space", 0.8);
  await play(page, 0.15);

  const s = await readState(page);
  expect(s.state).toBe("AIR");
  expect(s.y).toBeGreaterThan(s.groundY);
});

test("never sinks through the snow over a long session", async ({ page }) => {
  test.setTimeout(120_000);
  // The single most important invariant: the skier's rendered feet must never
  // drop below the visible snow surface, in any state, for any length of play.
  const samples: number[] = [];
  for (let i = 0; i < 60; i++) {
    await play(page, 0.5);
    const s = await readState(page);
    samples.push(s.lift);
    // Occasionally poke at the controls so the run covers more than plain skiing.
    if (i % 7 === 3) await hold(page, "Space", 0.5);
    if (i % 5 === 2) await hold(page, "ArrowLeft", 0.4);
    if (i % 5 === 4) await hold(page, "ArrowRight", 0.4);
  }
  const worst = Math.min(...samples);
  expect(worst, `lowest clearance over 30s was ${worst.toFixed(3)}m`).toBeGreaterThanOrEqual(0);
});

test("restarts in the clear, with the next feature ahead", async ({ page }) => {
  test.setTimeout(120_000);
  // Skiing straight at the rail is a guaranteed bail, so this needs no input.
  await page.waitForFunction(() => window.gameState().state === "CRASH", null, {
    timeout: 60_000,
    polling: 100,
  });
  await page.waitForFunction(() => window.gameState().state !== "CRASH", null, {
    timeout: 30_000,
    polling: 100,
  });

  const s = await readState(page);
  expect(s.state).toBe("SNOW");
  // `distToLip` is positive when the target lip is still downhill of the skier.
  // It used to come back at -28: the skier respawned *past* the previous lip,
  // level with that rail's end, with the camera sitting inside the steel.
  expect(s.distToLip, "restart must be uphill of the next lip").toBeGreaterThan(10);
  expect(s.distToLip, "restart must not be an over-long wait").toBeLessThan(45);
  expect(s.lift).toBeGreaterThanOrEqual(0);
});

test("runs at full speed even at a terrible frame rate", async ({ page, browser }) => {
  // The simulation must not slow down when frames get expensive. With the old
  // clamped-variable-timestep loop, a frame was worth at most 34ms of game time
  // however long it really took, so a struggling machine played in slow motion.
  // Shut down the fixture's own game first: two instances rendering in one
  // browser is enough contention to push frames past the loop's catch-up cap,
  // which would make this measure the host machine rather than the loop.
  await page.close();

  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const HZ = 10;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 1000 / HZ)) as typeof requestAnimationFrame;
  });
  const slow = await ctx.newPage();
  await slow.goto("http://127.0.0.1:5173/");
  await slow.waitForFunction(() => typeof window.gameState === "function");
  await slow.waitForTimeout(1500);

  const before = await slow.evaluate(() => window.gameState().clock);
  const wallStart = Date.now();
  await slow.waitForTimeout(4000);
  const after = await slow.evaluate(() => window.gameState().clock);
  const ratio = (after - before) / ((Date.now() - wallStart) / 1000);
  await ctx.close();

  // The old loop would score about 0.34 here.
  expect(ratio, `simulation ran at ${ratio.toFixed(2)}x wall-clock at ~10fps`).toBeGreaterThan(0.9);
  expect(ratio).toBeLessThan(1.1);
});

test("the world recycles rather than growing without bound", async ({ page }) => {
  const early = (await readState(page)).sceneObjects;
  await play(page, 12);
  const later = await readState(page);
  expect(later.z).toBeLessThan(-80);
  expect(later.sceneObjects).toBe(early);
});
