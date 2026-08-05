# Steez Jam

A Three.js browser ski game: an endless terrain-park rail session. Read
`docs/architecture.md` before changing simulation or terrain code — it explains
the state machine, the recycling scheme, and why the feel constants are what
they are.

## Commands

```bash
pnpm dev          # game dev server, http://127.0.0.1:5173
pnpm site         # micro-site dev server, http://127.0.0.1:5174
pnpm typecheck    # tsc --noEmit across both packages
pnpm test         # Playwright smoke tests (starts the dev server itself)
pnpm check        # typecheck + full build + tests — run before pushing
pnpm build:site   # deployable bundle at site/dist (game at /play/)
```

Node 22.12+ (`nvm use`), pnpm workspaces. `pnpm` only — do not use npm/yarn here.

## Non-negotiables

- **`game/src/world/course.ts` is the single source of truth for terrain.** Both
  the physics and the rendered meshes derive from it. Never tune a mesh to match
  different collision maths — change `course.ts` and let both follow.
- **The skier must never sink below the visible snow.** There is a smoke test
  for it. If a change makes it fail, the change is wrong.
- **The world must not grow.** Fixed object pools are repositioned, never
  allocated during play. There is a smoke test for this too.
- **No menus, no title screen, no levels.** The game opens directly into play
  and stays in one continuous view. That is the design, not an omission.
- Keep `Game.debugState()` in sync with any new state worth asserting on — the
  tests read it instead of private fields.
- **Simulation goes in `step()`, presentation in `present()`.** `step()` runs on
  a fixed timestep; `present()` runs once per rendered frame. Putting anything
  that affects the outcome of a run into `present()` makes the game frame-rate
  dependent again. Continuous particle emitters gate on `fxBeat` so spray
  density doesn't follow the step rate.
- Tests measure progress against `debugState().clock`, never a wall-clock sleep
  — the loop can legitimately fall behind real time on an overloaded machine.

## Style

- TypeScript strict, no `any`. Two-space indent, double quotes.
- Comments explain *why* a number or an approach was chosen, not what the line
  does. The existing comments are a good model — match their density.
- Tuning constants live at the top of their module with a comment on the
  intent behind the value.
- Prefer procedural geometry and canvas textures over asset files; the game
  loads instantly because it ships no binaries.

## When changing feel

The gameplay constants in `game/src/game.ts` are tuned against each other. After
touching `SPIN_*`, `POP_*`, `*_TOL`, or the balance constants, actually play it —
`pnpm dev` — rather than trusting the tests. The tests prove it isn't broken;
they cannot tell you it still feels good.
