import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { engineBuildConfig, engineBundleBudgetPlugin } from '../../vite.shared';

const appDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [wasm(), engineBundleBudgetPlugin()],
  build: {
    ...engineBuildConfig,
    target: 'esnext',
    rollupOptions: {
      ...engineBuildConfig.rollupOptions,
      input: {
        index: resolve(appDir, 'index.html'),
        physicsPlayground: resolve(appDir, 'physics-playground.html'),
        skinningTest: resolve(appDir, 'skinning-test.html'),
      },
    },
  },
});
