# Testing and Quality Specification

**Status:** proposed baseline.

## Test layers
- Unit: core data structures, transforms, serialization validators, import metadata, math.
- Integration: package boundaries, renderer extraction, physics synchronization, asset lifecycle, save/load.
- Contract: public package exports, backend adapter conformance, importer conformance.
- E2E: Playwright editor workflows and player acceptance scenes.
- Visual: browser screenshot comparisons with controlled tolerances.
- Performance: repeatable workloads with environment metadata and raw result artifacts.

## Tooling candidates
Vitest for unit/integration; Playwright for browser E2E; TypeScript strict mode; ESLint + Prettier; package manager and exact versions selected during Foundation. CI runs formatting, lint, typecheck, tests, and production builds.

## Benchmark scenarios
Entity counts and component densities; mesh count/triangle count/draw calls; voxel volume/chunk count and remesh; cold/warm GLB load; physics body/collider counts; serialization size/entity count. Capture median and tail latency, CPU/GPU time where available, memory estimates, and hardware/browser/driver details.

## Error and flake policy
Tests must not depend on external network assets; fixtures are checked in or generated deterministically. Browser/GPU tests declare capability requirements and skip with a recorded reason, never silently pass. Flaky tests are quarantined with an issue and owner, not deleted.

## Acceptance
Every milestone gate lists required checks. Performance changes include before/after results. Serialization schema changes include migration fixtures. Public API changes include type-level and runtime contract tests.
