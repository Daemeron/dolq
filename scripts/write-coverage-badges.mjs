// Writes the two coverage badges (shields.io endpoint files) into badges/, from the frontend coverage summary that
// `vitest run --coverage` leaves in coverage/ and the backend total that backend/scripts/check-coverage.sh leaves in
// backend-coverage.txt. CI publishes them to the badges branch, and the README shows them from there.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { coverageBadge } from '../src/shared/coverageBadge.ts';

const root = new URL('../', import.meta.url);
const frontend = JSON.parse(readFileSync(new URL('coverage/coverage-summary.json', root), 'utf8')).total.lines.pct;
const backend = Number(readFileSync(new URL('backend-coverage.txt', root), 'utf8'));
if (!Number.isFinite(frontend) || !Number.isFinite(backend)) throw new Error(`no coverage: ${frontend}, ${backend}`);

mkdirSync(new URL('badges/', root), { recursive: true });
for (const [file, label, percent] of [
  ['frontend-coverage.json', 'frontend coverage', frontend],
  ['backend-coverage.json', 'backend coverage', backend],
]) {
  writeFileSync(new URL(`badges/${file}`, root), `${JSON.stringify(coverageBadge(label, percent))}\n`);
}
