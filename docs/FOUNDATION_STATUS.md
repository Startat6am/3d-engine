# Foundation milestone status

**Status:** in progress — implementation scaffold exists; exit gate is not yet signed off.

## Implemented in this iteration

- pnpm workspace with strict TypeScript project references and a committed lockfile.
- ESLint and Prettier configuration; Vitest unit-test runner; Playwright Chromium E2E configuration; GitHub Actions verification workflow.
- `@engine/core`: lifecycle host with ordered startup, reverse shutdown, rollback after startup failure, idempotent disposal, and generation-tagged entity registry.
- `@engine/geometry`: renderer-independent CPU mesh contract and box primitive.
- `@engine/renderer`: Three.js WebGL2 adapter isolated behind engine-owned interfaces; resize, mesh submission, render, and disposal.
- `@engine/editor`: React application shell with hierarchy, inspector, and a live canvas viewport.
- `@engine/player`: separate non-React runtime shell using shared core/geometry/renderer packages.

## Verification observed

- Frozen install is the intended CI path; local dependency resolution completed and lockfile was generated.
- Prettier check, ESLint, TypeScript project build/typecheck, and Vitest passed in the implementation environment.
- Editor and player production builds passed with Vite 7.3.8.
- Unit tests currently cover engine startup/rollback/shutdown/disposal and stale entity handles.

## Remaining gate items

- Playwright browser test could not run in the implementation container because its Chromium binary lacks host `libglib-2.0.so.0`; CI installs Chromium and OS dependencies with `playwright install --with-deps chromium` and runs the E2E test. The E2E gate remains pending until a CI run passes.
- Production bundles currently emit a >500 kB chunk warning due to the initial Three.js integration; measure and split/lazy-load renderer/editor code in a later optimization pass.
- Verify Vercel deployment from the monorepo root strategy before advertising a hosted editor URL.
- Add package-boundary checks, browser WebGL2 smoke coverage, and dependency/licensing review.

## Explicit non-claims

This milestone does not implement the complete ECS component store/query scheduler, transform hierarchy, `.world` serialization, asset registry/importers, physics, animation, audio, input, editor command/undo stack, or AI authoring runtime. Those remain separate roadmap milestones.
