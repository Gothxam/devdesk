import { defineConfig } from 'vitest/config';

// TS-6: tests depend on no wall-clock time, no network, and no real filesystem
// paths outside a temp root. Unit tests are colocated with their subject (RL-12).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
