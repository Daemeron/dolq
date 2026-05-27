import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default [
  defineProject({
    test: {
      name: 'main',
      include: ['src/main/**/*.test.ts'],
      environment: 'node',
    },
  }),
  defineProject({
    plugins: [react()],
    test: {
      name: 'renderer',
      include: ['src/renderer/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/renderer/test-setup.ts'],
    },
  }),
];
