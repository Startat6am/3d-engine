import os from 'node:os';
import { WorldChunkScheduler } from '../packages/engine-world/dist/index.js';
import {
  createVoxelChunkSnapshot,
  editVoxelChunk,
  meshVoxelChunk,
  meshVoxelChunkAsync,
} from '../packages/engine-voxel/dist/index.js';

const repeats = Number(process.env.VOXEL_BENCH_REPEATS ?? 8);
const lifecycleCycles = Number(process.env.VOXEL_BENCH_LIFECYCLE_CYCLES ?? 32);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) {
  throw new Error('VOXEL_BENCH_REPEATS must be an integer from 1 to 100');
}
if (!Number.isSafeInteger(lifecycleCycles) || lifecycleCycles < 1 || lifecycleCycles > 1000) {
  throw new Error('VOXEL_BENCH_LIFECYCLE_CYCLES must be an integer from 1 to 1000');
}

const palette = [{ material: { kind: 'builtin', key: 'stone' } }];
const chunkCells = 16 ** 3;
const cellIndex = (x, y, z) => x + 16 * (y + 16 * z);

function fixture(kind) {
  const cells = new Uint16Array(chunkCells);
  if (kind === 'single') cells[cellIndex(8, 8, 8)] = 1;
  if (kind === 'solid') cells.fill(1);
  if (kind === 'checkerboard') {
    for (let z = 0; z < 16; z += 1) {
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          if ((x + y + z) % 2 === 0) cells[cellIndex(x, y, z)] = 1;
        }
      }
    }
  }
  return createVoxelChunkSnapshot({ coordinate: { x: 0, y: 0, z: 0 }, palette, cells });
}

function meshMetrics(mesh) {
  let faces = 0;
  let geometryBytes = 0;
  for (const part of mesh.parts) {
    faces += part.geometry.indices.length / 6;
    for (const value of Object.values(part.geometry)) {
      if (ArrayBuffer.isView(value)) geometryBytes += value.byteLength;
    }
  }
  return { meshParts: mesh.parts.length, exposedFaces: faces, geometryBytes };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(3),
  );
}

function memoryMiB() {
  const usage = process.memoryUsage();
  return Object.fromEntries(
    Object.entries(usage).map(([key, value]) => [key, Number((value / 1024 / 1024).toFixed(2))]),
  );
}

async function benchmarkMeshing(kind) {
  const source = fixture(kind);
  const timings = [];
  let metrics = meshMetrics(meshVoxelChunk(source));
  for (let run = 0; run < repeats; run += 1) {
    const started = performance.now();
    const mesh = meshVoxelChunk(source);
    timings.push(performance.now() - started);
    metrics = meshMetrics(mesh);
  }
  return {
    fixture: kind,
    occupiedCells: source.copyCells().reduce((total, value) => total + Number(value !== 0), 0),
    chunkPayloadBytes: source.copyCells().byteLength,
    ...metrics,
    repeats,
    wallMs: {
      min: Number(Math.min(...timings).toFixed(3)),
      median: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      max: Number(Math.max(...timings).toFixed(3)),
    },
  };
}

async function benchmarkLifecycle() {
  const released = [];
  const scheduler = new WorldChunkScheduler({
    limits: {
      maxConcurrentJobs: 2,
      maxQueuedJobs: 4,
      maxResidentChunks: 1,
      maxChunkPayloadBytes: 8192,
    },
    releaseResident: (resident) => released.push(resident),
  });
  const timings = [];
  let totalFaces = 0;
  let peakResidents = 0;
  for (let cycle = 0; cycle < lifecycleCycles; cycle += 1) {
    const coordinate = { x: cycle, y: -cycle, z: 0 };
    const started = performance.now();
    const resident = await scheduler.request({
      coordinate,
      revision: cycle,
      run: async (signal) => {
        const empty = createVoxelChunkSnapshot({
          coordinate,
          palette,
          cells: new Uint16Array(chunkCells),
        });
        const edited = editVoxelChunk(empty, [
          { x: cycle % 16, y: (cycle * 3) % 16, z: (cycle * 7) % 16, value: 1 },
        ]).snapshot;
        const mesh = await meshVoxelChunkAsync(edited, {}, 1, signal);
        return { value: { snapshot: edited, mesh }, byteLength: edited.copyCells().byteLength };
      },
    });
    totalFaces += meshMetrics(resident.mesh).exposedFaces;
    peakResidents = Math.max(peakResidents, scheduler.residentCount);
    scheduler.evict(coordinate);
    timings.push(performance.now() - started);
  }
  scheduler.dispose();
  return {
    cycles: lifecycleCycles,
    totalExposedFaces: totalFaces,
    peakResidentChunks: peakResidents,
    releasedResidents: released.length,
    wallMs: {
      min: Number(Math.min(...timings).toFixed(3)),
      median: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      max: Number(Math.max(...timings).toFixed(3)),
    },
    schedulerDisposed: scheduler.isDisposed,
    residentChunksAfterDispose: scheduler.residentCount,
  };
}

const before = memoryMiB();
const meshing = [];
for (const kind of ['empty', 'single', 'solid', 'checkerboard']) {
  meshing.push(await benchmarkMeshing(kind));
}
const lifecycle = await benchmarkLifecycle();
const report = {
  benchmark: 'choreon-voxel-world-stress-v1',
  generatedFixtures: true,
  configuration: {
    chunkDimensions: [16, 16, 16],
    chunkCells,
    voxelSize: 1,
    repeats,
    lifecycleCycles,
  },
  environment: {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
  },
  memoryBeforeMiB: before,
  memoryAfterMiB: memoryMiB(),
  meshing,
  lifecycle,
  notes: [
    'CPU meshing wall time is measured synchronously; no renderer, GPU upload, physics cooking, or disk I/O is included.',
    'Lifecycle timing includes snapshot creation, one revisioned edit, cooperative async meshing, scheduler publication, and explicit eviction.',
    'Results are diagnostic raw measurements, not portable performance guarantees or CI thresholds.',
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
