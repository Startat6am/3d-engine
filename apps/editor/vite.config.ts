import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { engineBuildConfig, engineBundleBudgetPlugin } from '../../vite.shared';

export default defineConfig({
  plugins: [react(), engineBundleBudgetPlugin()],
  server: { port: 5173 },
  build: engineBuildConfig,
});
