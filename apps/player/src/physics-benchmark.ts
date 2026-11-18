import { EngineRuntime } from '@engine/core';
import { createPhysicsWorld, type PhysicsWorld } from '@engine/physics';

const status = document.querySelector<HTMLElement>('#benchmark-status');
const output = document.querySelector<HTMLElement>('#benchmark-results');
if (!status || !output) throw new Error('Physics benchmark page is incomplete');

const FIXED_DT = 1 / 60;
const WARMUP_STEPS = 120;
const MEASURED_STEPS = 300;
const QUERY_COUNT = 1_200;

type BrowserMemorySnapshot = {
  jsHeap: { usedBytes: number; totalBytes: number; limitBytes: number } | null;
  userAgentSpecificMemory: {
    bytes: number;
    breakdown: Array<{ bytes: number; attribution: string[]; types: string[] }>;
  } | null;
  userAgentSpecificMemoryStatus:
    | 'available'
    | 'unsupported'
    | 'not-cross-origin-isolated'
    | 'unavailable';
};

function readJsHeap(): BrowserMemorySnapshot['jsHeap'] {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return memory
    ? {
        usedBytes: memory.usedJSHeapSize,
        totalBytes: memory.totalJSHeapSize,
        limitBytes: memory.jsHeapSizeLimit,
      }
    : null;
}

async function captureBrowserMemory(): Promise<BrowserMemorySnapshot> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{
      bytes: number;
      breakdown: Array<{ bytes: number; attribution: string[]; types: string[] }>;
    }>;
  };
  if (!perf.measureUserAgentSpecificMemory) {
    return {
      jsHeap: readJsHeap(),
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryStatus: 'unsupported',
    };
  }
  if (!globalThis.crossOriginIsolated) {
    return {
      jsHeap: readJsHeap(),
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryStatus: 'not-cross-origin-isolated',
    };
  }
  try {
    const measured = await perf.measureUserAgentSpecificMemory();
    return {
      jsHeap: readJsHeap(),
      userAgentSpecificMemory: {
        bytes: measured.bytes,
        breakdown: measured.breakdown.map((entry) => ({
          bytes: entry.bytes,
          attribution: [...entry.attribution],
          types: [...entry.types],
        })),
      },
      userAgentSpecificMemoryStatus: 'available',
    };
  } catch {
    return {
      jsHeap: readJsHeap(),
      userAgentSpecificMemory: null,
      userAgentSpecificMemoryStatus: 'unavailable',
    };
  }
}

type TimingSummary = {
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function summarize(values: readonly number[]): TimingSummary {
  return {
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    medianMs: Number(percentile(values, 0.5).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4)),
  };
}

function addFloor(physics: PhysicsWorld, runtime: EngineRuntime, extent: number): void {
  const entity = runtime.world.createEntity();
  const body = physics.createBody(entity, { type: 'static', position: [0, -0.5, 0] });
  physics.createCollider(body, { shape: { type: 'box', halfExtents: [extent, 0.5, extent] } });
}

async function runSparseScenario(bodyCount: number) {
  const physics = await createPhysicsWorld({ gravity: [0, -9.81, 0] });
  const runtime = new EngineRuntime();
  addFloor(physics, runtime, 30);
  const createStart = performance.now();
  for (let index = 0; index < bodyCount; index += 1) {
    const entity = runtime.world.createEntity();
    const position: [number, number, number] = [
      (index % 32) * 0.7 - 10.85,
      1 + (index % 3) * 0.55,
      Math.floor(index / 32) * 0.7 - 10.85,
    ];
    const body = physics.createBody(entity, { type: 'dynamic', position, canSleep: false });
    physics.createCollider(body, { shape: { type: 'sphere', radius: 0.25 } });
  }
  const createMs = performance.now() - createStart;
  for (let index = 0; index < WARMUP_STEPS; index += 1) {
    physics.step(FIXED_DT);
    physics.drainCollisionEvents();
  }
  const stepTimes: number[] = [];
  let collisionEvents = 0;
  for (let index = 0; index < MEASURED_STEPS; index += 1) {
    const start = performance.now();
    physics.step(FIXED_DT);
    stepTimes.push(performance.now() - start);
    collisionEvents += physics.drainCollisionEvents().length;
  }
  const raycastTimes: number[] = [];
  let raycastHits = 0;
  const ray = { origin: [0, 20, 0] as const, direction: [0, -1, 0] as const, maxDistance: 40 };
  for (let index = 0; index < QUERY_COUNT; index += 1) {
    const start = performance.now();
    if (physics.raycast(ray)) raycastHits += 1;
    raycastTimes.push(performance.now() - start);
  }
  physics.dispose();
  return {
    bodies: bodyCount,
    colliders: bodyCount + 1,
    createMs: Number(createMs.toFixed(2)),
    fixedStep: summarize(stepTimes),
    raycast: summarize(raycastTimes),
    raycastHitRate: raycastHits / QUERY_COUNT,
    collisionEventsDrained: collisionEvents,
  };
}

async function runDenseContactScenario() {
  const bodyCount = 216;
  const side = 6;
  const physics = await createPhysicsWorld({ gravity: [0, -9.81, 0] });
  const runtime = new EngineRuntime();
  addFloor(physics, runtime, 8);
  const createStart = performance.now();
  for (let index = 0; index < bodyCount; index += 1) {
    const entity = runtime.world.createEntity();
    const xIndex = index % side;
    const zIndex = Math.floor(index / side) % side;
    const yIndex = Math.floor(index / (side * side));
    const position: [number, number, number] = [
      (xIndex - (side - 1) / 2) * 0.49,
      0.55 + yIndex * 0.49,
      (zIndex - (side - 1) / 2) * 0.49,
    ];
    const body = physics.createBody(entity, { type: 'dynamic', position, canSleep: false });
    physics.createCollider(body, {
      shape: { type: 'sphere', radius: 0.25 },
      friction: 0.8,
      restitution: 0.05,
    });
  }
  const createMs = performance.now() - createStart;
  for (let index = 0; index < WARMUP_STEPS; index += 1) {
    physics.step(FIXED_DT);
    physics.drainCollisionEvents();
  }
  const stepTimes: number[] = [];
  let collisionEvents = 0;
  let stepsWithEvents = 0;
  let maxEventsPerStep = 0;
  for (let index = 0; index < MEASURED_STEPS; index += 1) {
    const start = performance.now();
    physics.step(FIXED_DT);
    stepTimes.push(performance.now() - start);
    const events = physics.drainCollisionEvents();
    collisionEvents += events.length;
    if (events.length > 0) stepsWithEvents += 1;
    maxEventsPerStep = Math.max(maxEventsPerStep, events.length);
  }
  const queryTimes: number[] = [];
  let totalQueryHits = 0;
  const ray = { origin: [0, 12, 0] as const, direction: [0, -1, 0] as const, maxDistance: 24 };
  for (let index = 0; index < QUERY_COUNT; index += 1) {
    const start = performance.now();
    totalQueryHits += physics.raycastAll(ray).length;
    queryTimes.push(performance.now() - start);
  }
  const disposeStart = performance.now();
  physics.dispose();
  return {
    bodies: bodyCount,
    colliders: bodyCount + 1,
    createMs: Number(createMs.toFixed(2)),
    fixedStep: summarize(stepTimes),
    raycastAll: summarize(queryTimes),
    averageRaycastHits: Number((totalQueryHits / QUERY_COUNT).toFixed(2)),
    collisionEventsDrained: collisionEvents,
    stepsWithCollisionEvents: stepsWithEvents,
    maxCollisionEventsPerStep: maxEventsPerStep,
    disposeMs: Number((performance.now() - disposeStart).toFixed(3)),
  };
}

async function main() {
  const memoryBeforeRapierInit = await captureBrowserMemory();
  const initStart = performance.now();
  const probe = await createPhysicsWorld({ gravity: [0, -9.81, 0] });
  const wasmInitializationMs = Number((performance.now() - initStart).toFixed(2));
  probe.dispose();
  const memoryAfterRapierInitAndDispose = await captureBrowserMemory();
  const results = [];
  for (const count of [100, 500, 1_000]) results.push(await runSparseScenario(count));
  const denseContact = await runDenseContactScenario();
  const memoryAfterScenarios = await captureBrowserMemory();
  const report = {
    runtime: 'Rapier WASM via @engine/physics',
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: 'deviceMemory' in navigator ? navigator.deviceMemory : null,
    wasmInitializationMs,
    fixedDeltaSeconds: FIXED_DT,
    warmupSteps: WARMUP_STEPS,
    measuredSteps: MEASURED_STEPS,
    queryCountPerScenario: QUERY_COUNT,
    memoryDiagnostics: {
      wasmLinearMemoryBytes: null,
      wasmLinearMemoryStatus: 'not-exposed-by-public-rapier-api',
      note: 'The Rapier adapter does not expose WebAssembly.Memory. Whole-page estimate; not attributable to Rapier WASM.',
      snapshots: {
        beforeRapierInit: memoryBeforeRapierInit,
        afterRapierInitAndDispose: memoryAfterRapierInitAndDispose,
        afterScenariosAndDispose: memoryAfterScenarios,
      },
    },
    sparseScenarios: results,
    denseContact,
    limitations: [
      'Headless or foreground browser microbenchmark; not a full rendered frame-time benchmark.',
      'JS heap excludes WASM memory; whole-page memory is not Rapier WASM or GPU memory.',
      'Shared CI/sandbox hardware and browser scheduling are not dedicated benchmark conditions.',
      'Synthetic sphere workloads do not represent every game scene or mesh-collider workload.',
    ],
  };
  output!.textContent = JSON.stringify(report, null, 2);
  status!.dataset.state = 'ready';
  status!.textContent = 'BENCHMARK COMPLETE';
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  status!.dataset.state = 'error';
  status!.textContent = `BENCHMARK FAILED · ${message}`;
  output!.textContent = message;
});
