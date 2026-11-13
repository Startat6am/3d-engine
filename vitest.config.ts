import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/editor/src/project/**/*.test.ts'],
    environment: 'node',
    coverage: { reporter: ['text', 'html'] },
  },
});
