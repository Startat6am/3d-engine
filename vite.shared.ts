import { gzipSync } from 'node:zlib';
import type { Plugin, UserConfig } from 'vite';

const gzipBudgets = new Map<string, number>([
  ['index', 160 * 1024],
  ['vendor-three', 220 * 1024],
  ['vendor-meshoptimizer', 20 * 1024],
]);

/** Fail production builds when an important browser chunk exceeds its compressed transfer budget. */
export function engineBundleBudgetPlugin(): Plugin {
  return {
    name: 'engine-bundle-gzip-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const budget = gzipBudgets.get(output.name);
        if (budget === undefined) continue;
        const actual = gzipSync(output.code).byteLength;
        if (actual > budget) {
          this.error(
            `Chunk ${output.name} is ${(actual / 1024).toFixed(1)} KiB gzip; budget is ${(budget / 1024).toFixed(0)} KiB`,
          );
        }
      }
    },
  };
}

/** Shared vendor boundaries for browser apps in this workspace. */
export const engineBuildConfig: UserConfig['build'] = {
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes('/node_modules/three/')) return 'vendor-three';
        if (id.includes('/node_modules/meshoptimizer/')) return 'vendor-meshoptimizer';
      },
    },
  },
  // Three.js is ~753 KB minified but ~193 KB gzip. The gzip plugin above is
  // the actual transfer budget; this threshold avoids Vite's raw-size false alarm.
  chunkSizeWarningLimit: 800,
};
