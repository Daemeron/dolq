import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageInput } from './MessageInput';

function setup(onSend: (text: string) => void | Promise<void>) {
  render(<MessageInput channelName="linux" isLog={false} onSend={onSend} />);
  const input = screen.getByPlaceholderText('Message #linux') as HTMLInputElement;
  const submit = () => fireEvent.submit(input.closest('form') as HTMLFormElement);
  return { input, submit };
}

describe('MessageInput', () => {
  it('sends the trimmed text and clears the box', async () => {
    const onSend = vi.fn();
    const { input, submit } = setup(onSend);
    fireEvent.change(input, { target: { value: '  hello  ' } });
    submit();
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hello'));
    expect(input.value).toBe('');
  });

  it('ignores an empty message', () => {
    const onSend = vi.fn();
    const { input, submit } = setup(onSend);
    fireEvent.change(input, { target: { value: '   ' } });
    submit();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('puts the text back and says why when the send fails', async () => {
    const { input, submit } = setup(async () => {
      throw new Error('backend not connected');
    });
    fireEvent.change(input, { target: { value: 'hello' } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent: backend not connected');
    expect(input.value).toBe('hello');
  });

  it('clears the error once the user types again', async () => {
    const { input, submit } = setup(async () => {
      throw new Error('nope');
    });
    fireEvent.change(input, { target: { value: 'hello' } });
    submit();
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: 'hello!' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
