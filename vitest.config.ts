import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/test/**/*.test.ts',
      'apps/editor/src/project/**/*.test.ts',
    ],
    environment: 'node',
    coverage: { reporter: ['text', 'html'] },
  },
});
