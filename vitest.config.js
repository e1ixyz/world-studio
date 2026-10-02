import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.{js,ts}', 'packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
