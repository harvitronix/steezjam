# Steez Jam

A browser-based ski game about spinning and sliding rails.

Built with [Three.js](https://threejs.org) and TypeScript. Runs in any modern
browser, no install.

## Quick start

```bash
nvm use          # Node 22.12+
pnpm install
pnpm dev         # game at http://127.0.0.1:5173
```

To work on the landing page, `pnpm site` instead — it runs both servers, because
the game only exists at `/play/` in a built bundle. In dev the Play button points
straight at the game's own server; `scripts/bundle-site.mjs` is what folds the
two together at build time.

## Controls

| Key | On snow | In the air | On the rail |
| --- | --- | --- | --- |
| `←` `→` | Carve | Spin | Balance |
| `↑` | Speed up | — | — |
| `↓` | Check speed | — | — |
| `Space` | Hold to load, release to pop | — | Release to switchup or exit |

A charge released part-way up the jump is held until the lip, so every
take-off leaves from the same place.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Game dev server with HMR (port 5173) |
| `pnpm site` | Micro-site (5174) **and** the game (5173), so Play works |
| `pnpm build` | Build the game to `game/dist` |
| `pnpm build:site` | Build both, then fold the game into `site/dist/play` |
| `pnpm preview:site` | Build everything and serve the deployable bundle |
| `pnpm typecheck` | `tsc --noEmit` across both packages |
| `pnpm test` | Playwright smoke tests against the real game |
| `pnpm check` | Typecheck + full build + tests (run this before pushing) |

## Layout

```
game/                 the playable game (Vite + Three.js)
  src/
    main.ts           entry: renderer, resize, rAF loop
    game.ts           the Game class — state machine, scoring, camera
    levels.ts         the six ability tiers and their unlock thresholds
    core/             input bindings, math helpers
    world/            course layout maths + the Three.js scene
    player/           the skier rig and its posing
    fx/               particles and the WebAudio synth
    ui/               HUD and stylesheet
  public/             static assets served verbatim
  dist/               build output (git-ignored)

site/                 the micro-site (Vite, no framework)
  src/                page content + styles
  public/media/       hero screenshot
  dist/               build output; also receives the game at dist/play/

tests/                Playwright smoke tests
scripts/              build helpers
docs/                 architecture notes
```

## Deploying

`pnpm build:site` produces **`site/dist`** as a single self-contained static
bundle: the landing page at `/` and the playable game at `/play/`. Nothing about
that bundle is committed — `scripts/bundle-site.mjs` folds the two builds
together each time, so there is no generated output to keep in sync.

**GitHub Pages is wired up.** Pushing to `main` runs the checks, and only if
they pass does the deploy job build the bundle and publish it. One-time setup:
in **Settings → Pages**, set *Source* to **GitHub Actions**. There is no `gh-pages`
branch and nothing to commit.

Both builds use relative asset URLs (`base: "./"`), so the bundle works from a
domain root, from a project subpath like `/steezjam/`, or unzipped onto itch.io
without config changes. The play page's back link is relative for the same
reason: from `/steezjam/play/` it returns to `/steezjam/`, not the domain root.

To ship only the game, deploy `game/dist` instead.

## How a hit scores

Everything sums into a base and a multiplier independently, then multiplies once
the moment you ride away. Bail anywhere before that and the whole attempt is
worth zero.

| Event | base | multiplier |
| --- | --- | --- |
| Sliding the rail | +100 / second | — |
| Spin on, per half turn past 90 | +100 | +0.5× |
| Switch-up, per half turn | +250 | +0.5× (flat) |
| Clean exit | +250 | — |
| Spin off, per half turn past 90 | +150 | +0.5× |
| Dropping in switch | — | +0.25× |
| Riding away switch | — | +0.3× |

The only persistent number is **best single hit** — there is no running session
total, and progression reads straight off it. See `docs/architecture.md` for the
measured per-tier ceilings the unlock thresholds are set against.

## Origin

The first playable version was generated in a single run of
[Steez Bench](https://steezbench.harvitronix.com), a benchmark that asks coding
agents to build this exact game from a spec. Run
`20260803003000-run-claude-claude-opus-5-cea8` scored 23/23 on functionality and
13/18 on the subjective verdict, and is the ancestor of everything in `game/src`.

## License

MIT
