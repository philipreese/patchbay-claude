import { defineConfig } from 'vite';

// Relative base: the built site works under any subpath (e.g. /patchbay-claude/)
// because the app is a single index.html and all state lives in the URL fragment.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2020' },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
