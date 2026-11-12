import os from 'node:os';
import { GlbImporter } from '../packages/engine-gltf-importer/dist/index.js';

const vertexCount = Number(process.env.GLB_STRESS_VERTICES ?? 1_000_002);
const runs = Number(process.env.GLB_STRESS_RUNS ?? 3);
const textureBytes = Number(process.env.GLB_STRESS_TEXTURE_BYTES ?? 0);
const maxPeakRssDeltaMiB = Number(process.env.GLB_STRESS_MAX_PEAK_RSS_DELTA_MIB ?? 0);
if (!Number.isSafeInteger(vertexCount) || vertexCount < 3 || vertexCount % 3 !== 0) {
  throw new Error('GLB_STRESS_VERTICES must be a positive safe integer divisible by 3');
}
if (!Number.isSafeInteger(textureBytes) || textureBytes < 0 || textureBytes > 128 * 1024 * 1024) {
  throw new Error('GLB_STRESS_TEXTURE_BYTES must be an integer from 0 to 134217728');
}
if (!Number.isFinite(maxPeakRssDeltaMiB) || maxPeakRssDeltaMiB < 0) {
  throw new Error('GLB_STRESS_MAX_PEAK_RSS_DELTA_MIB must be a non-negative number');
}
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
  throw new Error('GLB_STRESS_RUNS must be an integer from 1 to 20');
}

function createSyntheticGlb(vertices, embeddedTextureBytes) {
  const positionBytes = vertices * 3 * Float32Array.BYTES_PER_ELEMENT;
  const binaryBytes = positionBytes + embeddedTextureBytes;
  const document = {
    asset: { version: '2.0', generator: 'Choreon synthetic GLB stress benchmark' },
    buffers: [{ byteLength: binaryBytes }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes },
      ...(embeddedTextureBytes > 0
        ? [{ buffer: 0, byteOffset: positionBytes, byteLength: embeddedTextureBytes }]
        : []),
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: vertices, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    ...(embeddedTextureBytes > 0
      ? { images: [{ name: 'Synthetic embedded image', bufferView: 1, mimeType: 'image/png' }] }
      : {}),
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
  if (embeddedTextureBytes > 0) {
    new Uint8Array(source, binHeader + 8 + positionBytes, embeddedTextureBytes).fill(0x7f);
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

function peakRssSnapshotMiB() {
  if (process.platform === 'win32') return null;
  const { maxRSS } = process.resourceUsage();
  // Node reports maxRSS in KiB (ru_maxrss units) on supported Unix platforms.
  return Number((maxRSS / 1024).toFixed(2));
}

async function importOnce(importer, source, run) {
  const startedAt = performance.now();
  const imported = await importer.import(source, {
    uri: `benchmarks/generated-${vertexCount}-vertices-${textureBytes}-texture-bytes.glb`,
    settings: {},
    signal: new AbortController().signal,
  });
  const wallMs = Number((performance.now() - startedAt).toFixed(2));
  return {
    run,
    wallMs,
    metadata: imported.metadata,
    memoryWhileResultRetainedMiB: memorySnapshot(),
    peakRssWhileResultRetainedMiB: peakRssSnapshotMiB(),
  };
}

async function executeRuns() {
  await collectGarbage();
  const baseline = memorySnapshot();
  const peakRssBaselineMiB = peakRssSnapshotMiB();
  const source = createSyntheticGlb(vertexCount, textureBytes);
  const sourceBytes = source.byteLength;
  const afterFixture = memorySnapshot();
  const peakRssAfterFixtureMiB = peakRssSnapshotMiB();
  const results = [];
  const importer = new GlbImporter();

  for (let run = 1; run <= runs; run += 1) {
    const result = await importOnce(importer, source, run);
    await collectGarbage();
    result.memoryAfterReleaseMiB = memorySnapshot();
    result.peakRssAfterReleaseMiB = peakRssSnapshotMiB();
    results.push(result);
  }

  return {
    baseline,
    peakRssBaselineMiB,
    sourceBytes,
    afterFixture,
    peakRssAfterFixtureMiB,
    results,
  };
}

const report = await executeRuns();
await collectGarbage();
const peakRssAfterSourceReleaseMiB = peakRssSnapshotMiB();
const peakRssDeltaMiB =
  report.peakRssBaselineMiB === null || peakRssAfterSourceReleaseMiB === null
    ? null
    : Number((peakRssAfterSourceReleaseMiB - report.peakRssBaselineMiB).toFixed(2));
const peakRssBudgetExceeded =
  maxPeakRssDeltaMiB > 0 && (peakRssDeltaMiB === null || peakRssDeltaMiB > maxPeakRssDeltaMiB);
const output = {
  benchmark: 'choreon-glb-import-stress-v1',
  generatedFixture: true,
  fixture: {
    sourceBytes: report.sourceBytes,
    vertexCount,
    triangleCount: Math.floor(vertexCount / 3),
    indexed: false,
    embeddedImages: textureBytes > 0 ? 1 : 0,
    embeddedTextureBytes: textureBytes,
  },
  environment: {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
    gcExposed: typeof globalThis.gc === 'function',
  },
  memoryBaselineMiB: report.baseline,
  peakRssBaselineMiB: report.peakRssBaselineMiB,
  memoryAfterFixtureMiB: report.afterFixture,
  peakRssAfterFixtureMiB: report.peakRssAfterFixtureMiB,
  memoryAfterSourceReleaseMiB: memorySnapshot(),
  peakRssAfterSourceReleaseMiB,
  peakRssDeltaMiB,
  peakRssBudgetMiB: maxPeakRssDeltaMiB > 0 ? maxPeakRssDeltaMiB : null,
  peakRssBudgetExceeded,
  runs: report.results,
  notes: [
    'process.memoryUsage values are point-in-time snapshots; peakRss fields use the OS process high-water mark and include runtime startup plus the synthetic fixture.',
    'Peak RSS is unavailable on Windows; the optional GLB_STRESS_MAX_PEAK_RSS_DELTA_MIB budget is enforced only when configured.',
    'Run with --expose-gc for comparable post-release snapshots.',
    'Synthetic image payload bytes are copied as embedded image data; no image decode or GPU allocation is measured.',
  ],
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (peakRssBudgetExceeded) {
  throw new Error(
    `GLB peak RSS delta (${peakRssDeltaMiB} MiB) exceeds the configured budget (${maxPeakRssDeltaMiB} MiB)`,
  );
}
