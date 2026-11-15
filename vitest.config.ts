import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['supabase/functions/**/*.test.ts', 'scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      'apps/*/vitest.config.ts',
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_shared/domain/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90 },
    },
  },
});
