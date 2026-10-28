import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', 'src/**/*.d.ts'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/**/*.test.ts', 'src/preload/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/renderer/test-setup.ts'],
        },
      },
    ],
  },
});
