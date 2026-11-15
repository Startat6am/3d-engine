# Browser Memory Benchmark

The Playwright browser-memory diagnostic runs against the production Editor build in Chromium.

## Fixture and sampling

- Synthetic GLB: 60,000 vertices with POSITION, NORMAL, and TEXCOORD_0 attributes.
- Embedded texture: 2048 × 2048 RGBA PNG (16 MiB decoded pixel allocation).
- Renderer heap: Chrome DevTools Protocol `Performance.getMetrics` / `JSHeapUsedSize`, sampled after `HeapProfiler.collectGarbage`.
- WebGL allocations: instrument `bufferData`, `texImage2D`, `texSubImage2D`, and `texStorage2D`; subtract tracked sizes on `deleteBuffer` and `deleteTexture`.
- Samples: initial Editor baseline, imported scene retained, after object removal, then a repeat import/removal cycle.

The test asserts that the fixture actually uploads the expected texture and vertex buffers, and that tracked live buffer/texture allocation bytes return to the pre-import baseline after removal.

## Interpretation and limits

- `JSHeapUsedSize` measures the renderer's JavaScript heap, not total browser-tab memory or OS process RSS.
- WebGL byte counts are requested allocation sizes inferred from API calls. They are not driver-reported VRAM, physical residency, or total GPU memory (driver overhead, tiling, mipmaps, and implementation-specific storage may differ).
- The Node GLB stress benchmark remains the source of process peak-RSS measurements.
- This browser test is a repeatable lifecycle diagnostic, not a universal memory ceiling. A release ceiling requires repeated runs on representative browser/OS/GPU combinations and explicit headroom for driver and browser overhead.

## Observed CI sample

CI #267 (Node 22.23.4, Chromium) measured renderer JS heap at 2.60 MB before import, 8.25 MB while the scene was retained, 8.36 MB after object removal, and 11.64 MB after a second import/removal cycle. The higher post-removal heap is consistent with imported asset records and source payloads remaining in the Editor project registry; this diagnostic does not assert that those project-owned bytes should be discarded when a scene object is deleted. WebGL instrumentation measured 2.16 MB peak buffer allocations and a 16 MiB requested texture allocation for the first cycle and 16,793,604 bytes for the 2049×2049 repeat texture. After each removal, tracked texture allocation returned to 0 bytes and tracked buffer allocation returned to 720 bytes. The repeat cycle uploaded a distinct 2049×2049 ImageBitmap and released it. These are single-run diagnostic observations, not a release budget or cross-device guarantee.
