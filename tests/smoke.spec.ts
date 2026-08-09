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
  best: number;
  level: string;
  levelIndex: number;
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

test("touch controls steer while charging and pop on release", async ({ page, browser }) => {
  await page.close();
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await context.newPage();
  await mobile.goto("http://127.0.0.1:5173/");
  await mobile.waitForFunction(() => typeof window.gameState === "function");

  const leftButton = mobile.locator(".touch-left");
  const popButton = mobile.locator(".touch-pop");
  const levels = mobile.locator(".levels");
  await expect(leftButton).toBeVisible();
  await expect(popButton).toBeVisible();
  await expect(levels).toHaveClass(/peek/);
  const left = (await leftButton.boundingBox())!;
  const pop = (await popButton.boundingBox())!;
  const touch = await context.newCDPSession(mobile);
  const start = await readState(mobile);

  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: left.x + left.width / 2, y: left.y + left.height / 2, id: 0 },
      { x: pop.x + pop.width / 2, y: pop.y + pop.height / 2, id: 1 },
    ],
  });
  await play(mobile, 0.8);
  const held = await readState(mobile);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await play(mobile, 0.15);
  const released = await readState(mobile);

  expect(held.x).toBeLessThan(start.x - 0.5);
  expect(released.state).toBe("AIR");
  await expect.poll(() => levels.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await context.close();
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

test("renders at a steady speed rather than juddering", async ({ page }) => {
  // A fixed simulation step only lands the skier on step boundaries, so frames
  // that owe 0, 1 or 2 steps advance by different amounts unless present()
  // interpolates. Measuring distance per unit of *real* frame time isolates
  // that: it should be near constant however irregular the frames themselves
  // are. Without interpolation this scores around 0.32.
  const jitter = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const g = (window as unknown as { game: { skier: { root: { position: { z: number } } } } }).game;
        const zs: number[] = [];
        const ts: number[] = [];
        let n = 0;
        const tick = (now: number) => {
          zs.push(g.skier.root.position.z);
          ts.push(now);
          if (++n < 130) requestAnimationFrame(tick);
          else {
            const speeds: number[] = [];
            for (let i = 16; i < zs.length; i++) {
              const dz = zs[i - 1] - zs[i];
              const dt = (ts[i] - ts[i - 1]) / 1000;
              if (dz > -1 && dz < 2 && dt > 0) speeds.push(dz / dt);
            }
            const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            const sd = Math.sqrt(
              speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length,
            );
            resolve(sd / mean);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(jitter, `rendered-speed jitter was ${jitter.toFixed(3)}`).toBeLessThan(0.2);
});

test("starts locked down at beginner, with the ladder ahead hidden", async ({ page }) => {
  const s = await readState(page);
  expect(s.levelIndex).toBe(0);
  expect(s.level).toBe("BEGINNER");

  // Every rung above the current one keeps its name secret.
  const names = await page.locator(".level-name").allTextContents();
  expect(names.filter((n) => n !== "LOCKED")).toEqual(["BEGINNER"]);
  expect(names.filter((n) => n === "LOCKED")).toHaveLength(5);
});

test("the world recycles rather than growing without bound", async ({ page }) => {
  const early = (await readState(page)).sceneObjects;
  await play(page, 12);
  const later = await readState(page);
  expect(later.z).toBeLessThan(-80);
  expect(later.sceneObjects).toBe(early);
});
