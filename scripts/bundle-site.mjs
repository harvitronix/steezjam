#!/usr/bin/env node
/**
 * Folds the built game into the built micro-site so `site/dist` is a single
 * self-contained deployable: the landing page at `/`, the game at `/play/`.
 *
 * Both builds use relative asset URLs (`base: "./"`), so the result works from
 * a domain root, a subpath, or an itch.io-style zip upload without changes.
 */
import { cp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gameDist = join(root, "game", "dist");
const siteDist = join(root, "site", "dist");
const target = join(siteDist, "play");

async function assertDir(path, hint) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    /* fall through */
  }
  console.error(`bundle-site: missing ${path}\n  ${hint}`);
  process.exit(1);
}

await assertDir(gameDist, "Run `pnpm --filter @steezjam/game build` first.");
await assertDir(siteDist, "Run `pnpm --filter @steezjam/site build` first.");

await rm(target, { recursive: true, force: true });
await cp(gameDist, target, { recursive: true });

console.log(`bundle-site: game -> ${target}`);
console.log("bundle-site: deploy site/dist (landing page at /, game at /play/)");
