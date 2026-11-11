import { defineConfig } from 'vite';
import { engineBuildConfig } from '../../vite.shared';

export default defineConfig({
  server: { port: 5174 },
  build: engineBuildConfig,
});
