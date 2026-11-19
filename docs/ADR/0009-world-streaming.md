# ADR 0009: Bounded world streaming and chunk lifecycle

**Status:** Accepted and partially implemented M7 baseline
**Date:** 2026-11-19

## Decision

- Model chunk lifecycle explicitly: requested → loading/generating → meshing → resident, with failure, eviction and disposed terminal/side states.
- Every world instance receives finite resource limits: maximum concurrent jobs, queued jobs, resident chunks and per-chunk payload bytes. Invalid, zero, negative or non-finite limits are rejected.
- Deduplicate work by world identity, chunk coordinate and source revision.
- Every job has an AbortSignal/cancellation path. Cancellation releases intermediate buffers and never publishes a partial result.
- Completion checks world generation, chunk revision and neighbor revision tokens. Stale completions are discarded.
- Eviction is explicit and idempotent in the initial API; no hidden unbounded queue and no implicit LRU policy.
- World disposal cancels all jobs, releases owned buffers and rejects later requests with a stable disposed-world error.
- Main-thread execution is the reference implementation. Worker execution is optional and must conform to the same contract before it is enabled.

## Implementation status

`@engine/world` now exposes `WorldChunkScheduler<T>` with caller-supplied positive limits for concurrent jobs, queued jobs, resident chunks and per-chunk payload bytes. It deduplicates by coordinate/revision, orders queued work by priority with FIFO ties, propagates `AbortSignal`, rejects stale revision completions, enforces explicit eviction, releases resident values through a caller callback, and disposes idempotently. Resident capacity is never resolved through hidden LRU eviction. A deterministic generator hook supplies a stable PRNG stream scoped to the seed and signed chunk coordinate, plus the job AbortSignal. Broader world lifecycle stress tests and production defaults remain open.

## Consequences

M7 guarantees bounded work by requiring caller-supplied finite limits; it does not claim hardware-independent throughput or memory budgets. Default product limits will be selected only after benchmark evidence. A worker is an optimization, never a correctness requirement.
