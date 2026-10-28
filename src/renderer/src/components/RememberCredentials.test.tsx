import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RememberCredentials } from './RememberCredentials';

function setup(secretsAvailable: () => Promise<boolean>) {
  (window as unknown as { irc: unknown }).irc = { secretsAvailable };
  const onChange = vi.fn();
  render(<RememberCredentials checked={false} onChange={onChange} />);
  return onChange;
}

describe('RememberCredentials', () => {
  it('lets the user opt in when the OS keystore is available', async () => {
    const onChange = setup(() => Promise.resolve(true));
    const box = screen.getByRole('checkbox');
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disables the option when there is no keystore', async () => {
    setup(() => Promise.resolve(false));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled());
  });

  it('disables the option when asking the keystore fails', async () => {
    setup(() => Promise.reject(new Error('boom')));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled());
  });
});
