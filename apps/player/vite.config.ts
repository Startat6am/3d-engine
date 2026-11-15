import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { engineBuildConfig, engineBundleBudgetPlugin } from '../../vite.shared';

export default defineConfig({
  server: { port: 5174 },
  plugins: [wasm(), engineBundleBudgetPlugin()],
  build: { ...engineBuildConfig, target: 'esnext' },
});
