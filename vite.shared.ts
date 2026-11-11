import type { UserConfig } from 'vite';

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
  // Three.js is ~753 KB minified but ~193 KB gzip. Keep a little headroom;
  // compressed transfer size, not raw minified bytes, is the meaningful budget.
  chunkSizeWarningLimit: 800,
};
