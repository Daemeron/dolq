import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewPanel } from './ViewPanel';

function setup() {
  const onClose = vi.fn();
  render(
    <ViewPanel title="Preferences" onClose={onClose}>
      <input aria-label="field" />
    </ViewPanel>,
  );
  return onClose;
}

describe('ViewPanel', () => {
  it('floats as a modal dialog named by its title, with a heading', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Preferences' }).getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
  });

  it('moves focus into the dialog', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('closes from the header button and from a backdrop click, but not from a click inside', () => {
    const onClose = setup();
    fireEvent.click(screen.getByLabelText('field'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ViewPanel: layout options', () => {
  it('shows a description, a footer and a leading element', () => {
    render(
      <ViewPanel
        title="T"
        description="About it"
        leading={<i data-testid="lead" />}
        footer={<button type="button">Go</button>}
        onClose={() => {}}
      >
        body
      </ViewPanel>,
    );
    expect(screen.getByText('About it')).toBeTruthy();
    expect(screen.getByTestId('lead')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
  });

  it('wraps the body and footer in one form when given a submit handler', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <ViewPanel title="T" onSubmit={onSubmit} footer={<button type="submit">Save</button>} onClose={() => {}}>
        body
      </ViewPanel>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('can keep the title for screen readers only and open from the top', () => {
    render(
      <ViewPanel title="Search" hideTitle top toolbar={<div>palette</div>} onClose={() => {}}>
        body
      </ViewPanel>,
    );
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy();
    expect(screen.getByText('palette')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
