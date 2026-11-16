import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { LOG_LINE_HEIGHT, SUMMARY_HEIGHT } from '../src/renderer/src/utils/rowSize';

// The message list starts every row at a guessed height and stacks the rows by the heights it holds. These are the
// heights it guesses for a folded run's summary and for a log line: a guess that is off leaves the rows after it
// drawn over their text until it is corrected. jsdom has no layout, so they are measured in a real browser: the one Electron brings, since CI has no other.
test('the heights the message list assumes match what is drawn', async () => {
  // These packages are ES modules, which this file cannot import statically.
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
  const app = await electron.launch({ args: [path.resolve(__dirname, 'blankWindow.cjs')] });
  try {
    const page = await app.firstWindow();
    for (const view of ['', '?log']) {
      await page.goto(`http://localhost:${port}/src/renderer/rows-harness/index.html${view}`);
      await page.waitForSelector('[data-index="4"]');
      await page.evaluate(() => document.fonts.ready);
      const height = (index: number) =>
        page.evaluate((i) => document.querySelector(`[data-index="${i}"]`)?.getBoundingClientRect().height, index);

      expect(await height(1), `${view || 'chat'} view: the summary of a folded run`).toBeCloseTo(SUMMARY_HEIGHT, -0.5);
      expect(await height(2), `${view || 'chat'} view: a line folded away`).toBe(0);
      // Whatever the list holds, no row is drawn over the one before it.
      const overlap = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-index]')].map((row) => row.getBoundingClientRect());
        return rows.findIndex((r, i) => i + 1 < rows.length && r.bottom > rows[i + 1].top + 1);
      });
      expect(overlap, `${view || 'chat'} view: the row drawn over the next one`).toBe(-1);
      if (view) expect(await height(4), 'log view: one line').toBeCloseTo(LOG_LINE_HEIGHT, -0.5);
    }
  } finally {
    await app.close();
    await server.close();
  }
});
