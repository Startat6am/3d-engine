import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'pnpm-lock.yaml', 'playwright-report/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2022 } },
    rules: { 'no-console': ['warn', { allow: ['warn', 'error'] }] },
  },
);
