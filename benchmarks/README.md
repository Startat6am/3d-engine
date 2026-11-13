# GLB Import Stress Benchmark

Run from the repository root after building the importer:

```bash
./node_modules/.bin/tsc -b packages/engine-gltf-importer
node --expose-gc benchmarks/glb-import-stress.mjs
```

Controls:

- `GLB_STRESS_VERTICES`: vertex count, must be divisible by three; defaults to 1,000,002.
- `GLB_STRESS_RUNS`: sequential import count from 1 to 20; defaults to 3.
- `GLB_STRESS_TEXTURE_BYTES`: embedded image payload bytes, from 0 to 128 MiB; defaults to 0.

The script generates a deterministic GLB in memory, imports it repeatedly, records importer phase timings and Node process memory snapshots, drops each imported result, and forces several GC passes when `--expose-gc` is available. Set `GLB_STRESS_TEXTURE_BYTES` to add one embedded image bufferView. The synthetic image bytes use a PNG MIME label but are not a valid encoded PNG; the importer copies their payload but this benchmark does not decode them. It outputs one JSON report to stdout and does not write a generated model file. The repository CI runs both the geometry-only and 16 MiB embedded-image cases on the supported Node 22 runtime after the workspace build; use those logs as the supported-runtime baseline.

## Recorded baseline (2026-11-12)

Environment: Node 25.9.0, Linux arm64, 48 reported CPUs, 189,774 MiB reported host memory, explicit GC enabled. This sandbox runtime is outside the repository's supported Node range (22.12.x), so these numbers are diagnostic only and must not be treated as the supported-runtime baseline.

| Measurement                            |                          Result |
| -------------------------------------- | ------------------------------: |
| Synthetic GLB source                   |                12,000,396 bytes |
| Vertices / triangles                   |             1,000,002 / 333,334 |
| Importer-reported geometry output      |                28,000,056 bytes |
| Import wall time, run 1                |                       180.31 ms |
| Import wall time, runs 2–3             |           140.93 ms / 140.83 ms |
| ArrayBuffers while result retained     |                       38.18 MiB |
| ArrayBuffers after result release + GC | 11.48 MiB (source fixture only) |
| ArrayBuffers after source release + GC |                        0.03 MiB |

The post-release ArrayBuffers snapshots returned to the source-fixture baseline after each run; the remaining RSS did not fall proportionally because process RSS includes allocator/runtime retention. This is not proof of a peak-memory ceiling or a browser/GPU lifecycle result.

## Embedded image payload run (2026-11-12)

Same environment as the geometry-only run (Node 25.9.0, Linux arm64, explicit GC). Command:

```bash
GLB_STRESS_TEXTURE_BYTES=16777216 node --expose-gc benchmarks/glb-import-stress.mjs
```

| Measurement                            |                          Result |
| -------------------------------------- | ------------------------------: |
| Vertices / triangles                   |             1,000,002 / 333,334 |
| Embedded image payload                 |       16,777,216 bytes (16 MiB) |
| Total GLB source                       |                28,777,756 bytes |
| Geometry output                        |                28,000,056 bytes |
| Import wall time, run 1                |                       187.52 ms |
| Import wall time, runs 2–3             |           145.43 ms / 144.49 ms |
| ArrayBuffers while result retained     |                       70.18 MiB |
| ArrayBuffers after result release + GC | 27.48 MiB (source fixture only) |
| ArrayBuffers after source release + GC |                        0.03 MiB |

This confirms that the importer returns to the source-fixture ArrayBuffer baseline after each result is released in this Node diagnostic run. It is not an image-decoding or GPU upload test, nor a sampled peak-memory profile.

## Limitations

- This fixture measures geometry decode/build only: no embedded textures, image decode, GPU allocation, editor entity lifecycle, or WebGL context loss.
- Memory is sampled at specific points, not continuously; a transient peak between samples may be missed.
- Node `process.memoryUsage()` is not equivalent to browser tab memory. Repeat the benchmark on the supported Node version and add browser-specific acceptance instrumentation before making cross-runtime performance claims.
- Do not place user-provided/private model files in this benchmark or commit generated fixture binaries.
