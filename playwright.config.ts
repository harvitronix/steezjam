import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against the real game in a real browser. The game exposes
 * `window.gameState()` (see game/src/game.ts `debugState`), which is how the
 * tests inspect simulation state without reaching into private fields.
 */
export default defineConfig({
  testDir: "./tests",
  // Software WebGL is CPU-bound; running specs in parallel starves the render
  // loop and makes wall-clock assertions flaky. One worker keeps them honest.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Software WebGL: headless Chromium has no GPU here, and the game
        // must still initialise its renderer for any of this to be meaningful.
        launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader"] },
      },
    },
  ],
  webServer: {
    command: "pnpm --filter @steezjam/game dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
