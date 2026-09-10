import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'smoke-catalog',
          include: ['tests/smoke/meta/**/*.spec.ts'],
        },
      },
    ],
  },
});
