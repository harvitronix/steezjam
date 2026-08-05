# Architecture

How the game is put together, and the invariants worth not breaking.

## Shape of the thing

There is no engine and no ECS. The game has exactly one entity — the skier — so
an entity system would be pure overhead. Instead it is a **single `Game` class
driving a five-state machine**, with rendering, audio, particles and HUD as
collaborators it owns.

```
main.ts          renderer + rAF loop + input binding
  └── Game       simulation, scoring, camera
        ├── World      scene graph, terrain recycling, lighting
        ├── Skier      the character rig, posed each frame
        ├── Effects    particle pools
        ├── Audio      WebAudio synthesis
        └── Hud        DOM overlay
```

`main.ts` owns the frame loop. Nothing else drives time.

## The loop: fixed simulation, variable render

`Game` splits into two entry points, and the distinction matters:

- **`step(dt, input)`** — the simulation. Only ever called with `FIXED_DT`
  (1/120s), as many times per frame as the accumulator owes. Everything that
  decides *what happened* lives here: the state machine, collisions, scoring.
- **`present(dt, alpha)`** — presentation, once per rendered frame on the real
  frame delta. World recycling, particles, skier posing, camera, HUD.

The payoff is that a run plays out identically on any machine. The original
loop stepped on the raw frame delta clamped to 34ms, which made the game
frame-rate dependent in two directions at once: a 120Hz display integrated
gravity differently from a 60Hz one, and a machine below 30fps ran the game in
visible **slow motion**, because a frame was worth at most 34ms of game time no
matter how long it actually took. At 8fps the simulation ran at roughly a
quarter speed.

`present()` draws the skier **interpolated between the last two steps**, using
whatever fraction of a step is left in the accumulator. This is not optional.
The camera, shake and limb damping are all exponential and would be fine on
their own, but the skier's world position comes straight off simulation state
and can only ever land on step boundaries. Rendering it raw means frames owing
0, 1 or 2 steps advance by visibly different amounts — measured as a 2.5x swing
between consecutive frames, which reads as judder even though the simulation is
perfectly regular. Interpolating cuts rendered-speed variance by about 4x.

`snapView()` collapses the interpolation window after a deliberate teleport
(currently just `respawn()`), so the skier does not appear to slide into place
from wherever it crashed.

Three guards keep the loop honest:

- `MAX_FRAME` (0.25s) caps how much real time one frame may bank. Past that the
  simulation deliberately falls behind wall-clock, because the alternative is
  returning to a backgrounded tab and cashing in minutes of accumulated time as
  thousands of steps.
- Continuous particle emitters (carve spray, rail sparks, crash powder) spawn a
  fixed count per call, so running them straight off the simulation step would
  tie spray density to the step rate. They get their own `FX_INTERVAL` beat at
  60Hz — the rate they historically ran at.
- The floor clamp in `poseSkier` also catches the one case interpolation can get
  wrong: lerping a chord across a convex surface (a roller crest, the lip) cuts
  slightly below it.

Because of `MAX_FRAME`, simulation time can still legitimately lag wall-clock on
a badly overloaded machine. Tests therefore measure progress against
`debugState().clock`, never against a wall-clock sleep.

## The state machine

`Game.state` is one of five values, each with its own update function:

| State | Meaning | Leaves via |
| --- | --- | --- |
| `SNOW` | Carving on the groomed surface | Pop, lip launch, drop, or hitting a rail side |
| `AIR` | Airborne between snow and anything else | Rail catch, landing, or crash |
| `RAIL` | Sliding, balance meter live | Switch-up pop, exit pop, ride-off, or balance bail |
| `RAILAIR` | The short hop of a switch-up | Reconnect, exit, or crash |
| `CRASH` | Tumbling, controls locked | Auto-respawn after ~1.25s |

`step()` dispatches on state, then applies the shared per-step tail (rail score
accrual, landing-compression and sketch decay). Per-state update functions keep
a uniform `(dt, input, steer)` signature even when they ignore an argument, so
adding input handling to a state is a local change.

## The one rule: `course.ts` is the single source of truth

`world/course.ts` is pure maths — no Three.js import. It defines the fall line,
the shaped lip profile, the roller between features, and the rail's height at
any `z`.

**Both the simulation and the renderer derive their geometry from it.** The
physics collides against `groundY(x, z)`; the terrain mesh bakes the same
function into its vertices; the lip mesh is generated from the same
`lipProfile`/`lipLateral` pair the collision uses.

This is why the skier never sinks through the snow, and why the lip you can see
is exactly the lip you launch off. If you change terrain shape, change it in
`course.ts` and let both sides follow. Never hand-tune a mesh to "look right"
against different collision maths.

World axes: **the fall line runs toward −Z**, screen-right is +X, up is +Y.
Because `z` goes negative downhill and the base plane is `y = SLOPE * z`, `y`
falls as the player progresses.

## Bounded world

The run is endless but the scene is not. `World` keeps fixed pools —
6 terrain tiles, 4 feature groups (lip + rail + markers), 84 instanced trees —
and repositions them ahead of the skier as `z` decreases. Nothing is ever
allocated during play, so memory is flat over an arbitrarily long session.

Two constraints make the recycling seamless:

- The roller's period equals the feature spacing (`SEG`), so a tile can be moved
  by whole tile lengths and still line up with `groundY()`.
- Instanced trees set `frustumCulled = false`; their precomputed bounding sphere
  would otherwise cull the whole pool once instances drift away from the origin.

The `world recycles rather than growing without bound` smoke test guards this by
asserting the scene object count is identical after 12 seconds of play.

## Feel, and where it lives

Most of what makes the game good is a handful of tuning constants at the top of
`game.ts`. Two are worth understanding before touching them:

**Rotation is acceleration-based, not rate-based.** Holding a direction applies
constant angular acceleration (`SPIN_ACCEL`) up to `SPIN_MAX`. Because hang time
and rotation therefore scale together, a lazy roll off the lip naturally comes
out at a 90-on and a fully-charged pop held all the way round lands a 450-on —
without the game ever quantising your spin for you. Releasing bleeds rotation at
`SPIN_DECAY`, fast enough to place a late correction but not instantly.

**Assists only tidy an entry that already works.** In the last moments before
contact, both the rail catch and the snow landing nudge yaw toward a clean
orientation — but only when the current angle is already inside the tolerance
window (`RAIL_TOL`, `LAND_TOL`). A straight-on rail approach still bails; a
wildly under-rotated landing still bails. The assist removes visual scruffiness,
not consequence. Widening these tolerances is the fastest way to make the game
feel mushy.

**Risk is priced into balance.** A bigger spin onto the rail sets a bigger
starting imbalance, a higher `instability`, and a narrower settle `band`. Style
costs something, which is the whole game.

## Scoring

An `Attempt` accumulates `base` points and a `mult` while the player is on and
around a feature. It is **banked only on a successful snow landing**; any crash
voids it entirely. This is what makes a three-switch-up run feel like it's worth
something as you ride it out.

Awards, all summed into `base` and `mult` independently and multiplied once at
the landing:

| Event | base | mult |
| --- | --- | --- |
| Sliding the rail | +100/s | — |
| Entry, per half-turn past 90° | +100 | +0.5 |
| Switch-up, per half-turn | +250 | +0.5 (flat) |
| Clean exit | +250 | — |
| Exit spin, per half-turn past 90° | +150 | +0.5 |
| Dropping in switch | — | +0.25 |
| Riding away switch | — | +0.3 |

Switch-ups are linear in rotation while their multiplier is flat, so a 360
switch-up pays twice a 180 without also doubling everything else in the run.
Charge decides which you get: past `SWITCHUP_360_CHARGE` the hop commits to a
full rotation, taking about 8m of rail against 5m for a 180. Before that,
charge only changed hop height and every switch-up came out a 180 regardless.

There is no running session total — the only persistent number is `best`, the
highest single rail hit. Chasing one great hit is a sharper goal than watching a
total climb, and it means every approach is a fresh attempt at the record rather
than a small increment on a number that only ever goes up.

The finished attempt is held in `result` and stays on screen until
`startAttempt()` fires for the next one, so the score is readable through the
landing, the ride-away and the next approach instead of flashing past. A bail
persists the same way, showing the trick list struck through.

## Debug hook

`Game.debugState()` is exposed as `window.gameState()`. It reports state,
position, ground clearance, stance, balance, score and a rolling trace of recent
transitions. The Playwright smoke tests read it rather than reaching into
private fields — keep it in sync when adding state worth asserting on.

## Known rough edges

Things that scored below full marks in the original evaluation, or that are
simply next on the list:

- **Control feel (2/3)** and **animation quality (2/3)** — the skier rig is
  procedural boxes; poses are readable but not yet stylish.
- **Era style (2/3)** — the mid-2000s look could push much further on kit,
  silhouette and topsheet graphics.
- No asset pipeline. Everything is generated in code (canvas textures, procedural
  geometry). That is a genuine strength for load time; if models are ever added,
  they belong behind a loader in `game/src/core/`.
