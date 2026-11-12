import os from 'node:os';
import { GlbImporter } from '../packages/engine-gltf-importer/dist/index.js';

const vertexCount = Number(process.env.GLB_STRESS_VERTICES ?? 1_000_002);
const runs = Number(process.env.GLB_STRESS_RUNS ?? 3);
if (!Number.isSafeInteger(vertexCount) || vertexCount < 3 || vertexCount % 3 !== 0) {
  throw new Error('GLB_STRESS_VERTICES must be a positive safe integer divisible by 3');
}
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
  throw new Error('GLB_STRESS_RUNS must be an integer from 1 to 20');
}

function createSyntheticGlb(vertices) {
  const binaryBytes = vertices * 3 * Float32Array.BYTES_PER_ELEMENT;
  const document = {
    asset: { version: '2.0', generator: 'Choreon synthetic GLB stress benchmark' },
    buffers: [{ byteLength: binaryBytes }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binaryBytes }],
    accessors: [{ bufferView: 0, componentType: 5126, count: vertices, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonChunkBytes = (json.byteLength + 3) & ~3;
  const binaryChunkBytes = (binaryBytes + 3) & ~3;
  const totalBytes = 12 + 8 + jsonChunkBytes + 8 + binaryChunkBytes;
  const source = new ArrayBuffer(totalBytes);
  const header = new DataView(source);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, totalBytes, true);
  header.setUint32(12, jsonChunkBytes, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(source, 20, json.byteLength).set(json);
  new Uint8Array(source, 20 + json.byteLength, jsonChunkBytes - json.byteLength).fill(0x20);
  const binHeader = 20 + jsonChunkBytes;
  header.setUint32(binHeader, binaryChunkBytes, true);
  header.setUint32(binHeader + 4, 0x004e4942, true);
  const positions = new Float32Array(source, binHeader + 8, vertices * 3);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const offset = vertex * 3;
    positions[offset] = vertex % 997;
    positions[offset + 1] = Math.floor(vertex / 997) % 997;
    positions[offset + 2] = (vertex % 31) / 31;
  }
  return source;
}

async function collectGarbage() {
  if (typeof globalThis.gc !== 'function') return;
  for (let pass = 0; pass < 3; pass += 1) {
    globalThis.gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return Object.fromEntries(
    Object.entries(usage).map(([key, value]) => [key, Number((value / 1024 / 1024).toFixed(2))]),
  );
}

await collectGarbage();
const baseline = memorySnapshot();
let source = createSyntheticGlb(vertexCount);
const sourceBytes = source.byteLength;
const afterFixture = memorySnapshot();
const results = [];
const importer = new GlbImporter();

for (let run = 1; run <= runs; run += 1) {
  const startedAt = performance.now();
  let imported = await importer.import(source, {
    uri: `benchmarks/generated-${vertexCount}-vertices.glb`,
    settings: {},
    signal: new AbortController().signal,
  });
  const wallMs = Number((performance.now() - startedAt).toFixed(2));
  const whileRetained = memorySnapshot();
  results.push({
    run,
    wallMs,
    metadata: imported.metadata,
    memoryWhileResultRetainedMiB: whileRetained,
  });
  imported = null;
  await collectGarbage();
  results[results.length - 1].memoryAfterReleaseMiB = memorySnapshot();
}

source = null;
await collectGarbage();

console.log(
  JSON.stringify(
    {
      benchmark: 'choreon-glb-import-stress-v1',
      generatedFixture: true,
      fixture: {
        sourceBytes,
        vertexCount,
        triangleCount: Math.floor(vertexCount / 3),
        indexed: false,
        embeddedTextures: 0,
      },
      environment: {
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cpuCount: os.cpus().length,
        totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
        gcExposed: typeof globalThis.gc === 'function',
      },
      memoryBaselineMiB: baseline,
      memoryAfterFixtureMiB: afterFixture,
      memoryAfterSourceReleaseMiB: memorySnapshot(),
      runs: results,
      notes: [
        'Memory figures are process snapshots, not a sampled peak-memory profile.',
        'Run with --expose-gc for comparable post-release snapshots.',
        'This synthetic geometry-only fixture does not measure texture decode or GPU allocations.',
      ],
    },
    null,
    2,
  ),
);
