# Project Handoff â€” Choreon 3D Engine

Updated: 2026-11-19

## Current authoritative snapshot

- Repository: `Startat6am/3d-engine`; default branch: `main`.
- M6 is integrated in `main` through squash merge `54def10255ca8fad661e0077b15c3332d6a390f3` (PR
  #87).
- M6 functional implementation is closed. Exact-head GitHub Actions [run
  #506](https://github.com/Startat6am/3d-engine/actions/runs/44465087886) passed.
- M7 is being developed in draft PR [#90](https://github.com/Startat6am/3d-engine/pull/90)
  on `feat/m7-world-voxels-main`, based directly on the M6 merge commit above.
- Latest PR head before the current voxel persistence slice:
  `ebabe4d0e06388fbef758d2c6f49cfe3f707e115`; CI for that exact head failed only at
  `prettier --check` on the voxel codec files (formatting fix included in the follow-up).
  Cancellation, bounded streaming and seeded generation are included in PR #90; exact-head CI remains the merge gate.
- Keep PR #90 as Draft until the remaining M7 scope and owner review are complete; do not merge it
  automatically.

## Milestone status

- M2â€“M5: complete.
- M6 Physics/Input: functionally closed by owner direction on 2026-11-19.
- M7 World & Voxels: active; coordinates/settings, immutable chunk storage/palette validation,
  deterministic CPU meshing, stale-result validation, cooperative AbortSignal cancellation, and a
  bounded chunk scheduler, deterministic seeded generation, and repeated load/eviction lifecycle stress
  coverage are implemented. ¶»§q«^