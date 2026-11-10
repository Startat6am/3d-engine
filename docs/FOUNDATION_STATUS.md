# Foundation milestone status

**Status:** complete — Foundation exit gate passed in GitHub Actions.

## Implemented in this milestone

- pnpm workspace with strict TypeScript project references and a committed lockfile.
- ESLint and Prettier; Vitest unit-test runner; Playwright Chromium E2E; GitHub Actions verification workflow.
- `@engine/core`: lifecycle host with ordered startup, reverse shutdown, rollback after startup failure, idempotent disposal, and generation-tagged entity registry.
- `@engine/geometry`: CPU-side mesh contract and box primitive.
- `@engine/renderer`: Three.js WebGL2 adapter isolated behind engine-owned interfaces; resize, mesh submission, render, and disposal.
- `@engine/editor`: React application shell with hierarchy, inspector, and live canvas viewport.
- `@engine/player`: separate non-React runtime shell using shared core/geometry/renderer packages.

## Verification

GitHub Actions CI run [#2](https://github.com/Startat6am/3d-engine/actions/runs/42709412738) passed on commit `087e9b531171575e90a4557e40e20804994bebc4`:

- frozen pnpm install;
- Prettier check and ESLint;
- TypeScript project typecheck;
- 6 unit tests;
- production builds for Editor and Player;
- Playwright Chromium editor E2E.

Vercel preview deployment completed successfully: [open Editor preview](https://3d-engine-fnmna5hk4-planbnba-2567s-projects.vercel.app). Preview access follows the project's Vercel authentication settings.

The Playwright browser could not launch in the implementation container because its Chromium installation lacked `libglib-2.0.so.0`; CI installed Chromium and its OS dependencies and passed the E2E test.

## Known limitations

- Editor and Player production bundles currently emit a greater-than-500 kB minified chunk warning due to the initial Three.js integration. Gzip sizes are approximately 201 kB and 131 kB respectively; splitting/lazy-loading is a follow-up optimization.
- The current viewport is a primitive-scene foundation, not a complete camera-navigation or editing toolset.
- Dependency-boundary automation, WebGL2 visual regression, browser compatibility matrix, and licensing review remain hardening tasks.

## Explicit non-claims

This milestone does not implement the complete ECS component store/query scheduler, transform hierarchy, `.world` serialization, asset registry/importers, physics, animation, audio, input, editor command/undo stack, or AI authoring runtime. Those remain separate roadmap milestones.
