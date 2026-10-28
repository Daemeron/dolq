import '@testing-library/jest-dom';

// jsdom has no matchMedia; a dark system with no listeners fires. Tests that care replace it.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
