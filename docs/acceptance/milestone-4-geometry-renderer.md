# Milestone 4 — Geometry & renderer baseline acceptance

## Scope in this slice

- Assemble the existing CPU mesh primitives into a repeatable player acceptance scene: Box, UV Sphere, Plane, and Cylinder.
- Render ECS-backed primitive entities using the WebGL2 adapter and propagated world transforms.
- Make geometry replacement detection include position, normal, and index buffer identity.
- Add a Playwright browser check that instruments WebGL2 `drawElements`, verifies at least four mesh draw calls, checks WebGL2 availability, and rejects page errors.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm test` — 47 tests passed across 7 files.
- `pnpm --filter @engine/player build` — passed.
- `pnpm e2e` — 8 browser E2E tests passed, including at least four WebGL2 mesh draw calls and more than 500 non-background framebuffer pixels in the player acceptance scene.

## Known limitations

- This is a renderer baseline scene, not a full editor scene or asset pipeline.
- Textures, shadow maps, instancing, post-processing, and GPU resource caching remain out of scope.
- Renderer performance claims are deferred until a reproducible benchmark with hardware/runtime metadata is available.
