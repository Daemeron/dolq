import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { startHarnessServer } from './harnessServer';

// The legend labels of the bandwidth chart sit beside swatches of different shapes, and were lined up by their text
// baseline relative to those, so "Upload" was drawn lower than "Download".
test('the legend labels of the bandwidth chart are on one line', async () => {
  const harness = await startHarnessServer();
  const app = await electron.launch({ args: [path.resolve(__dirname, 'blankWindow.cjs')] });
  try {
    const page = await app.firstWindow();
    await page.goto(harness.url('?chart'));
    await page.waitForSelector('svg');
    await page.evaluate(() => document.fonts.ready);
    const middle = (text: string) =>
      page.evaluate((label) => {
        const node = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === label);
        const range = document.createRange();
        if (node) range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        return box.top + box.height / 2;
      }, text);
    const download = await middle('Download');
    const upload = await middle('Upload');
    expect(download).toBeGreaterThan(0);
    expect(Math.abs(download - upload)).toBeLessThan(0.5);
  } finally {
    await app.close();
    await harness.close();
  }
});
