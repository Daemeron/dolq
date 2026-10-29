import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <p>the app</p> }));
vi.mock('./index.css', () => ({}));
vi.mock('@fontsource-variable/inter/wght.css', () => ({}));
vi.mock('@fontsource-variable/newsreader/wght.css', () => ({}));
vi.mock('@fontsource/jetbrains-mono/400.css', () => ({}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('renderer entry', () => {
  it('mounts the app into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import('./main');
    });
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
  });

  it('fails loudly when the page has no #root', async () => {
    await expect(import('./main')).rejects.toThrow('#root element not found');
  });
});
