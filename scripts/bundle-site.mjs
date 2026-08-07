#!/usr/bin/env node
/**
 * Folds the built game into the built micro-site so `site/dist` is a single
 * self-contained deployable: the landing page at `/`, the game at `/play/`.
 *
 * Both builds use relative asset URLs (`base: "./"`), so the result works from
 * a domain root, a subpath, or an itch.io-style zip upload without changes.
 */
import { cp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

if (process.env.PLAUSIBLE_SCRIPT_URL) {
  const analytics = `    <!-- Privacy-friendly analytics by Plausible -->
    <script async src="${process.env.PLAUSIBLE_SCRIPT_URL}"></script>
    <script>
      window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
      plausible.init()
    </script>`;

  for (const page of [join(siteDist, "index.html"), join(target, "index.html")]) {
    const html = await readFile(page, "utf8");
    await writeFile(page, html.replace("  </head>", `${analytics}\n  </head>`));
  }
}

console.log(`bundle-site: game -> ${target}`);
console.log("bundle-site: deploy site/dist (landing page at /, game at /play/)");
