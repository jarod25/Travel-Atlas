import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 20_000,
    // Database migration tests share one disposable database; avoid concurrent DDL.
    fileParallelism: false,
  },
});
