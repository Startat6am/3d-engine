# Browser Memory Benchmark

The Playwright browser-memory diagnostic runs against the production Editor build in Chromium.

## Fixture and sampling

- Synthetic GLB: 300,000 vertices with POSITION, NORMAL, and TEXCOORD_0 attributes.
- Embedded texture: 2048 × 2048 RGBA PNG (16 MiB decoded pixel allocation).
- Renderer heap: Chrome DevTools Protocol `Performance.getMetrics` / `JSHeapUsedSize`, sampled after `HeapProfiler.collectGarbage`.
- WebGL allocations: instrument `bufferData` and `texImage2D`; subtract tracked sizes on `deleteBuffer` and `deleteTexture`.
- Samples: initial Editor baseline, imported scene retained, after object removal, then a repeat import/removal cycle.

The test asserts that the fixture actually uploads the expected texture and vertex buffers, and that tracked live buffer/texture allocation bytes return to the pre-import baseline after removal.

## Interpretation and limits

- `JSHeapUsedSize` measures the renderer's JavaScript heap, not total browser-tab memory or OS process RSS.
- WebGL byte counts are requested allocation sizes inferred from API calls. They are not driver-reported VRAM, physical residency, or total GPU memory (driver overhead, tiling, mipmaps, and implementation-specific storage may differ).
- The Node GLB stress benchmark remains the source of process peak-RSS measurements.
- This browser test is a repeatable lifecycle diagnostic, not a universal memory ceiling. A release ceiling requires repeated runs on representative browser/OS/GPU combinations and explicit headroom for driver and browser overhead.
