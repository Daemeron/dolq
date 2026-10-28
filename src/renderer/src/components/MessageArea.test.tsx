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

  it('asks again after a wheel up once it has stopped', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    fireEvent.wheel(document.querySelector('.overflow-y-auto') as Element, { deltaY: -100 });
    expect(onLoadOlder).toHaveBeenCalledTimes(21);
    landPages(rerender, 1);
    expect(onLoadOlder).toHaveBeenCalledTimes(22);
  });

  it('does not ask after a wheel down once it has stopped', () => {
    setHeights(200, 800);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    fireEvent.wheel(document.querySelector('.overflow-y-auto') as Element, { deltaY: 100 });
    landPages(rerender, 1);
    expect(onLoadOlder).toHaveBeenCalledTimes(20);
  });

  it('does not ask after a wheel up in the middle of the history', () => {
    setHeights(200, 800);
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(500);
    const onLoadOlder = vi.fn();
    const rerender = renderArea([line(1)], onLoadOlder);
    landPages(rerender, 30);
    fireEvent.wheel(document.querySelector('.overflow-y-auto') as Element, { deltaY: -100 });
    landPages(rerender, 1);
    expect(onLoadOlder).toHaveBeenCalledTimes(20);
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

describe('MessageArea grouping', () => {
  afterEach(() => vi.restoreAllMocks());

  // jsdom has no layout, so give every element a size for the virtualizer to place rows.
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  const chat = (id: number, nick: string, minute: number): Message => ({
    id,
    nick,
    text: `text ${id}`,
    timestamp: new Date(minute * 60_000),
  });

  it('shows the name once for a run of messages from one person, and again after a gap or another speaker', () => {
    withLayout();
    const messages = [chat(1, 'mira', 0), chat(2, 'mira', 1), chat(3, 'tomas', 2), chat(4, 'mira', 30)];
    const { container } = render(
      <MessageArea
        isLog={false}
        timestampFormat="24h"
        density="cozy"
        channelId="s:#c"
        messages={messages}
        onLoadOlder={() => {}}
      />,
    );
    const names = [...container.querySelectorAll('span[style*="color"].font-semibold')].map((n) => n.textContent);
    expect(names).toEqual(['mira', 'tomas', 'mira']);
    expect(container.textContent).toContain('text 2');
  });
});
