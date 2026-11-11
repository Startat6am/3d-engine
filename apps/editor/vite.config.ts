import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { engineBuildConfig } from '../../vite.shared';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: engineBuildConfig,
});
