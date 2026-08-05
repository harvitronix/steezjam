import { test, expect, type Page } from "@playwright/test";

/** Shape of the debug hook the game installs on `window`. */
interface DebugState {
  state: "SNOW" | "AIR" | "RAIL" | "RAILAIR" | "CRASH";
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

/** Advances real time; the game runs on requestAnimationFrame. */
async function play(page: Page, seconds: number) {
  await page.waitForTimeout(seconds * 1000);
}

async function hold(page: Page, key: string, seconds: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(seconds * 1000);
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
  await page.keyboard.down("Space");
  await page.waitForTimeout(700);
  await page.keyboard.up("Space");
  await page.waitForTimeout(120);

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
    await page.waitForTimeout(500);
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

test("the world recycles rather than growing without bound", async ({ page }) => {
  const early = (await readState(page)).sceneObjects;
  await play(page, 12);
  const later = await readState(page);
  expect(later.z).toBeLessThan(-80);
  expect(later.sceneObjects).toBe(early);
});
