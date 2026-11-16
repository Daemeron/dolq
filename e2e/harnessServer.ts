import path from 'node:path';

/** Serves the pages in src/renderer/harness/ with the app's own build setup, for the browser tests. */
export async function startHarnessServer() {
  // These packages are ES modules, which a test file cannot import statically.
  const { createServer } = await import('vite');
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const react = (await import('@vitejs/plugin-react')).default;
  const server = await createServer({
    // The repo root, so Tailwind scans the components for the classes they use.
    root: path.resolve(__dirname, '..'),
    configFile: false,
    plugins: [tailwindcss(), react()],
    logLevel: 'error',
    server: { port: 0, fs: { strict: false } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: (query = '') => `http://localhost:${port}/src/renderer/harness/index.html${query}`,
    close: () => server.close(),
  };
}
