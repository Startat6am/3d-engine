import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { EngineRuntime } from '../../engine-core/dist/index.js';
import { RapierPhysicsWorld, setRapierModuleLoaderForTests } from '../dist/rapier-world.js';

setRapierModuleLoaderForTests(async () => {
  const rapier = await import('@dimforge/rapier3d-compat');
  await rapier.init();
  return rapier;
});

const FIXED_DT = 1 / 60;
const WARMUP_STEPS = 120;
const MEASURED_STEPS = 600;
const QUERY_COUNT = 3000;
const SIZES = [100, 500, 1000];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function summarize(values) {
  return {
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    medianMs: Number(percentile(values, 0.5).toFixed(4)),
    p95Ms: Number(percentile(values, 0.95).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4)),
  };
}

async function runScenario(bodyCount) {
  const physics = await RapierPhysicsWorld.create({ gravity: [0, -9.81, 0] });
  const runtime = new EngineRuntime();
  const world = runtime.world;
  const floorEntity = world.createEntity();
  const floor = physics.createBody(floorEntity, { type: 'static', position: [0, -0.5, 0] });
  physics.createCollider(floor, { shape: { type: 'box', halfExtents: [30, 0.5, 30] } });

  const createStart = performance.now();
  for (let index = 0; index < bodyCount; index += 1) {
    const entity = world.createEntity();
    const x = (index % 32) * 0.7 - 10.85;
    const z = Math.floor(index / 32) * 0.7 - 10.85;
    const y = 1 + (index % 3) * 0.55;
    const body = physics.createBody(entity, {
      type: 'dynamic',
      position: [x, y, z],
      canSleep: false,
    });
    physics.createCollider(body, { shape: { type: 'sphere', radius: 0.25 } });
  }
  const createMs = performance.now() - createStart;

  for (let index = 0; index < WARMUP_STEPS; index += 1) {
    physics.step(FIXED_DT);
    physics.drainCollisionEvents();
  }

  const stepTimes = [];
  let collisionEvents = 0;
  for (let index = 0; index < MEASURED_STEPS; index += 1) {
    const start = performance.now();
    physics.step(FIXED_DT);
    stepTimes.push(performance.now() - start);
    collisionEvents += physics.drainCollisionEvents().length;
  }

  const queryTimes = [];
  let queryHits = 0;
  const ray = { origin: [0, 20, 0], direction: [0, -1, 0], maxDistance: 40 };
  for (let index = 0; index < QUERY_COUNT; index += 1) {
    const start = performance.now();
    if (physics.raycast(ray)) queryHits += 1;
    queryTimes.push(performance.now() - start);
  }

  const memory = process.memoryUsage();
  const result = {
    bodies: bodyCount,
    colliders: bodyCount + 1,
    createMs: Number(createMs.toFixed(2)),
    fixedStep: summarize(stepTimes),
    raycast: summarize(queryTimes),
    raycastHitRate: queryHits / QUERY_COUNT,
    collisionEventsDrained: collisionEvents,
    memoryAfterScenarioBytes: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
  };
  physics.dispose();
  return result;
}

async function runCollisionEventScenario() {
  const physics = await RapierPhysicsWorld.create({ gravity: [0, 0, 0] });
  const runtime = new EngineRuntime();
  const world = runtime.world;
  for (let index = 0; index < 25; index += 1) {
    const dynamicEntity = world.createEntity();
    const dynamicBody = physics.createBody(dynamicEntity, {
      type: 'dynamic',
      position: [0, 0, 0],
      canSleep: false,
    });
    physics.createCollider(dynamicBody, { shape: { type: 'sphere', radius: 1 } });
    const staticEntity = world.createEntity();
    const staticBody = physics.createBody(staticEntity, { type: 'static', position: [0, 0, 0] });
    physics.createCollider(staticBody, { shape: { type: 'sphere', radius: 1 } });
  }
  const stepStart = performance.now();
  physics.step(FIXED_DT);
  const stepMs = performance.now() - stepStart;
  const drainStart = performance.now();
  const events = physics.drainCollisionEvents();
  const drainMs = performance.now() - drainStart;
  physics.dispose();
  return {
    bodies: 50,
    colliders: 50,
    stepMs: Number(stepMs.toFixed(4)),
    drainMs: Number(drainMs.toFixed(4)),
    eventsDrained: events.length,
  };
}

const results = [];
for (const size of SIZES) results.push(await runScenario(size));
const collisionEventStress = await runCollisionEventScenario();
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      v8: process.versions.v8,
      platform: process.platform + '-' + process.arch,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      totalMemoryBytes: os.totalmem(),
      fixedDeltaSeconds: FIXED_DT,
      warmupSteps: WARMUP_STEPS,
      measuredSteps: MEASURED_STEPS,
      queryCountPerScenario: QUERY_COUNT,
      results,
      collisionEventStress,
      limitations: [
        'Node.js/Rapier adapter microbenchmark; not a browser frame-time or end-user workload benchmark.',
        'Shared Vercel sandbox hardware is virtualized and not a stable dedicated benchmark host.',
        'heapUsed excludes WASM linear memory and does not represent total process RSS or GPU memory.',
        'Collision-event count measures drained events, not allocation volume.',
      ],
    },
    null,
    2,
  ),
);
