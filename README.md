# Steez Jam

A browser ski game about one thing: hitting a terrain-park rail with style.

Carve down the fall line, charge a pop off the lip, spin 450 onto a rail, fight
the balance meter, throw two switch-ups, spin off and stomp it switch. Then line
up the next one. No menus, no levels, no unlocks — the whole game is one hit,
repeated, and all the depth is in how you hit it.

Built with [Three.js](https://threejs.org) and TypeScript. Runs in any modern
browser, no install.

## Quick start

```bash
nvm use          # Node 22.12+
pnpm install
pnpm dev         # game at http://127.0.0.1:5173
```

## Controls

| Key | On snow | In the air | On the rail |
| --- | --- | --- | --- |
| `←` `→` | Carve | Spin | Fight the balance meter |
| `↑` | Tuck for speed | — | — |
| `↓` | Check speed | — | — |
| `Space` | Hold to charge, release to pop | — | Pop a switch-up, or an exit near the end |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Game dev server with HMR (port 5173) |
| `pnpm site` | Micro-site dev server (port 5174) |
| `pnpm build` | Build the game to `game/dist` |
| `pnpm build:site` | Build both, then fold the game into `site/dist/play` |
| `pnpm preview:site` | Build everything and serve the deployable bundle |
| `pnpm typecheck` | `tsc --noEmit` across both packages |
| `pnpm test` | Playwright smoke tests against the real game |
| `pnpm check` | Typecheck + full build (run this before pushing) |

## Layout

```
game/                 the playable game (Vite + Three.js)
  src/
    main.ts           entry: renderer, resize, rAF loop
    game.ts           the Game class — state machine, scoring, camera
    core/             input bindings, math helpers
    world/            course layout maths + the Three.js scene
    player/           the skier rig and its posing
    fx/               particles and the WebAudio synth
    ui/               HUD and stylesheet
  public/             static assets served verbatim
  dist/               build output (git-ignored)

site/                 the micro-site (Vite, no framework)
  src/                page content + styles
  public/media/       gameplay video and poster
  dist/               build output; also receives the game at dist/play/

tests/                Playwright smoke tests
scripts/              build helpers
docs/                 architecture notes
```

## Deploying

`pnpm build:site` produces **`site/dist`** as a single self-contained static
bundle: the landing page at `/` and the playable game at `/play/`.

Both builds use relative asset URLs (`base: "./"`), so that directory can be
dropped on any static host — Netlify, Vercel, Cloudflare Pages, GitHub Pages, an
S3 bucket — or zipped and uploaded to itch.io, without config changes.

To ship only the game, deploy `game/dist` instead.

## Origin

The first playable version was generated in a single run of
[steezbench](https://github.com/harvitronix/steezbench), a benchmark that asks
coding agents to build this exact game from a spec. Run
`20260803003000-run-claude-claude-opus-5-cea8` scored 23/23 on functionality and
13/18 on the subjective verdict, and is the ancestor of everything in `game/src`.

## License

MIT
