import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import react from '@vitejs/plugin-react';
import { engineBuildConfig, engineBundleBudgetPlugin } from '../../vite.shared';

export default defineConfig({
  plugins: [wasm(), react(), engineBundleBudgetPlugin()],
  server: { port: 5173 },
  build: { ...engineBuildConfig, target: 'esnext' },
});
