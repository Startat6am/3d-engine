import { defineConfig } from 'vite';
import { engineBuildConfig, engineBundleBudgetPlugin } from '../../vite.shared';

export default defineConfig({
  server: { port: 5174 },
  plugins: [engineBundleBudgetPlugin()],
  build: engineBuildConfig,
});
