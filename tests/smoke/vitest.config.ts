import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'production-smoke',
    include: ['tests/smoke/**/*.smoke.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 360_000,
    teardownTimeout: 180_000,
  },
});
