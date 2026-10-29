import { describe, expect, it } from 'vitest';
import { JOKES, pickJoke } from './splashJokes';

describe('JOKES', () => {
  it('are narrow and short enough to sit under the name on the splash', () => {
    for (const joke of JOKES) {
      const lines = joke.split('\n');
      expect(lines.length).toBeLessThanOrEqual(6);
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(52);
    }
  });

  it('are all different', () => {
    expect(new Set(JOKES).size).toBe(JOKES.length);
  });
});

describe('pickJoke', () => {
  it('picks by the random number, from the first joke to the last', () => {
    expect(pickJoke(() => 0)).toBe(JOKES[0]);
    expect(pickJoke(() => 0.999999)).toBe(JOKES[JOKES.length - 1]);
    expect(pickJoke(() => 1)).toBe(JOKES[JOKES.length - 1]);
  });

  it('is random by default', () => {
    const seen = new Set(Array.from({ length: 300 }, () => pickJoke()));
    expect(seen.size).toBeGreaterThan(1);
  });
});
