import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url).href);

export default defineConfig({
  resolve: {
    alias: {
      '@soteria/scoring-engine': r('./packages/scoring-engine/src/index.ts'),
      '@': r('./src'),
    },
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'supabase/functions/**/*.test.ts',
    ],
    environment: 'node',
  },
});
