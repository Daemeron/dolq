import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // not *.spec.ts/*.test.ts, so vitest's default include never picks these up
  testMatch: '*.e2e.ts',
  // the first launch compiles dolqd with `go build`, which is slow on a cold cache
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
});
