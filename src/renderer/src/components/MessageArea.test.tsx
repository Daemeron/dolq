import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { MessageArea } from './MessageArea';

// jsdom has no layout, so the scroll box's heights are set by hand.
function setHeights(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

function line(id: number): Message {
  return { id, nick: '', text: `line ${id}`, timestamp: new Date(0), isRaw: true };
}

function renderArea(messages: Message[], onLoadOlder: () => void) {
  const props = { isLog: true, timestampFormat: '24h', density: 'cozy' } as const;
  const view = render(<MessageArea {...props} channelId="s:__log__" messages={messages} onLoadOlder={onLoadOlder} />);
  return (next: Message[], channelId = 's:__log__') =>
    view.rerender(<MessageArea {...props} channelId={channelId} messages={next} onLoadOlder={onLoadOlder} />);
}

// Each page that lands is a new messages array, even when it adds nothing shown.
function landPages(rerender: (next: Message[], channelId?: string) => void, count: number, channelId?: string) {
  for (let i = 0; i < count; i++) rerender([line(1)], channelId);
}

describe('MessageArea', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for older history when its lines do not fill the view', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    renderArea([line(1)], onLoadOlder);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('asks again after each page that still does not fill the view', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(2)], onLoadOlder);
    rerender([line(1), line(2)]);
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it('asks again after a page that adds nothing shown', () => {
    setHeights(0, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([], onLoadOlder);
    rerender([]);
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it('leaves older history to scrolling once the view overflows', () => {
    setHeights(1600, 800);
    const onLoadOlder = vi.fn();
    renderArea([line(1)], onLoadOlder);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it('does not ask again when nothing re-renders it', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const messages = [line(1)];
    const rerender = renderArea(messages, onLoadOlder);
    rerender(messages);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('stops asking on its own after 20 pages in a row', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    expect(onLoadOlder).toHaveBeenCalledTimes(20);
  });

  it('asks again after a scroll once it has stopped', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    fireEvent.scroll(document.querySelector('.overflow-y-auto') as Element);
    expect(onLoadOlder).toHaveBeenCalledTimes(21);
    landPages(rerender, 1);
    expect(onLoadOlder).toHaveBeenCalledTimes(22);
  });

  it('starts counting again in another channel', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    landPages(rerender, 1, 's:#foo');
    expect(onLoadOlder).toHaveBeenCalledTimes(21);
  });
});
