import {
  AnimationPlayer,
  createAnimationPose,
  createAnimationSkin,
  createAnimationTrack,
  createAnimationClip,
  evaluateSkinningMatrices,
} from '../dist/index.js';

const jointCount = 24;
const bindPose = createAnimationPose(jointCount);
const parents = Array.from({ length: jointCount }, (_, index) => (index === 0 ? null : index - 1));
const channels = [];
for (let nodeIndex = 0; nodeIndex < jointCount; nodeIndex++) {
  channels.push({
    nodeIndex,
    track: createAnimationTrack({
      path: 'translation',
      times: [0, 0.5, 1],
      values: [0, 0, 0, 0.05, 0.02, 0, 0, 0, 0],
    }),
  });
  channels.push({
    nodeIndex,
    track: createAnimationTrack({
      path: 'rotation',
      times: [0, 0.5, 1],
      values: [0, 0, 0, 1, 0, 0.1, 0, 0.995, 0, 0, 0, 1],
    }),
  });
}
const clip = createAnimationClip('bench', channels, jointCount);
const inverseBindMatrices = new Float32Array(jointCount * 16);
for (let joint = 0; joint < jointCount; joint++) {
  inverseBindMatrices[joint * 16] = 1;
  inverseBindMatrices[joint * 16 + 5] = 1;
  inverseBindMatrices[joint * 16 + 10] = 1;
  inverseBindMatrices[joint * 16 + 15] = 1;
}
const skin = createAnimationSkin({
  name: 'bench-skin',
  joints: Array.from({ length: jointCount }, (_, index) => index),
  inverseBindMatrices,
  nodeCount: jointCount,
});
const player = new AnimationPlayer([clip], bindPose);
player.play('bench');

const iterations = Number(process.env.ITERATIONS ?? 10_000);
for (let index = 0; index < 2_000; index++) {
  player.update(1 / 60);
  evaluateSkinningMatrices(player.pose, parents, skin);
}
const samples = [];
for (let round = 0; round < 5; round++) {
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    player.update(1 / 60);
    evaluateSkinningMatrices(player.pose, parents, skin);
  }
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const medianMs = samples[Math.floor(samples.length / 2)];
process.stdout.write(
  JSON.stringify(
    {
      benchmark: 'animation-pose-evaluation',
      joints: jointCount,
      channels: channels.length,
      iterations,
      rounds: samples.length,
      medianMs: Number(medianMs.toFixed(2)),
      evaluationsPerSecond: Math.round(iterations / (medianMs / 1000)),
      node: process.version,
    },
    null,
    2,
  ) + '\n',
);
