# Contributing to Steez Jam

Thanks for helping make Steez Jam better.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Small bug fixes and focused improvements are welcome as pull requests. For a
large feature or a change to the game's direction, open an issue first so we
can agree on the shape of it before either of us invests heavily.

Read [the architecture notes](docs/architecture.md) before changing simulation
or terrain code. In particular:

- `game/src/world/course.ts` is the source of truth for rendered and physical
  terrain.
- Outcome-affecting work belongs in the fixed-timestep `step()` path;
  presentation belongs in `present()`.
- The world recycles fixed pools and must not grow during a run.
- Gameplay tuning needs to be played, not only typechecked.

Keep changes focused. The codebase uses strict TypeScript, two-space indentation,
double quotes, and comments that explain why rather than restate the code.

## Before opening a pull request

Run the complete check:

```bash
pnpm check
```

Describe what changed and why, mention any manual gameplay testing, and include
a screenshot or short recording for visible changes. Tests should cover new
behavior without duplicating the implementation.

By submitting a contribution, you agree that it may be distributed under the
project's [MIT License](LICENSE).
