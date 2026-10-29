// Regenerates every icon in resources/ from resources/icon.svg. Run after changing the accent colour or the mark:
//   node scripts/build-icons.mjs        (macOS only: the .icns comes from iconutil)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const res = new URL('../resources/', import.meta.url).pathname;
const svg = readFileSync(`${res}icon.svg`, 'utf8');
// The macOS menu bar wants a monochrome template image: the dagger alone, black on transparent.
const dagger = svg.slice(svg.indexOf('<polygon'), svg.indexOf('</g>'));
const template = (w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${256 - (w * (319 / h)) / 2} 72 ${w * (319 / h)} 319"><g fill="#000">${dagger}</g></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(markup, w, h = w) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${markup}`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// One page renders every size, so they must not overlap.
const png = {};
for (const s of sizes) png[s] = await render(svg, s);
mkdirSync(`${res}icons`, { recursive: true });
for (const s of sizes) writeFileSync(`${res}icons/${s}x${s}.png`, png[s]);
writeFileSync(`${res}icon.png`, png[512]);

// A PNG-compressed .ico: a header, one 16-byte directory entry per image, then the images.
const ico = [16, 24, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = head.length;
ico.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, e);
  head.writeUInt8(s === 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png[s].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(`${res}icon.ico`, Buffer.concat([head, ...ico.map((s) => png[s])]));

const set = join(tmpdir(), 'dolq.iconset');
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(set, `icon_${s}x${s}.png`), png[s]);
  writeFileSync(join(set, `icon_${s}x${s}@2x.png`), png[s * 2]);
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', `${res}icon.icns`]);
rmSync(set, { recursive: true });

writeFileSync(`${res}trayIconTemplate.png`, await render(template(11, 22), 11, 22));
writeFileSync(`${res}trayIconTemplate@2x.png`, await render(template(22, 44), 22, 44));
await browser.close();
