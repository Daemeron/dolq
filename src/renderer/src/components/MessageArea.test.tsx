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

describe('MessageArea: pack lines', () => {
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
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
  const pack: Message = {
    id: 1,
    nick: 'bot',
    text: '#7 · 3x sent',
    timestamp: new Date(0),
    xdccPack: true,
    xdccPackNumber: 7,
  };

  it('requests a pack from the keyboard as well as the mouse', () => {
    withLayout();
    const onGetPack = vi.fn();
    const { getByTitle } = render(
      <MessageArea
        isLog={false}
        timestampFormat="24h"
        density="cozy"
        channelId="s:#c"
        messages={[pack]}
        onGetPack={onGetPack}
      />,
    );
    const row = getByTitle('Click to request this pack');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: 'a' });
    fireEvent.click(row);
    expect(onGetPack).toHaveBeenCalledTimes(2);
    expect(onGetPack).toHaveBeenCalledWith('bot', 7);
  });

  it('shows a pack line as plain text when nothing can request it', () => {
    withLayout();
    const { queryByTitle, getByText } = render(
      <MessageArea isLog={false} timestampFormat="24h" density="cozy" channelId="s:#c" messages={[pack]} />,
    );
    expect(queryByTitle('Click to request this pack')).toBeNull();
    expect(getByText(/#7/)).toBeTruthy();
  });
});

describe('MessageArea: day dividers and mentions', () => {
  afterEach(() => vi.restoreAllMocks());

  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
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

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  const msg = (id: number, nick: string, text: string, timestamp: Date): Message => ({ id, nick, text, timestamp });

  function renderChat(messages: Message[], selfNick?: string) {
    return render(
      <MessageArea
        isLog={false}
        timestampFormat="24h"
        density="cozy"
        channelId="s:#c"
        messages={messages}
        selfNick={selfNick}
      />,
    );
  }

  it('labels each new day once', () => {
    withLayout();
    const { getAllByText, getByText } = renderChat([
      msg(1, 'mira', 'one', yesterday),
      msg(2, 'mira', 'two', now),
      msg(3, 'tomas', 'three', now),
    ]);
    expect(getByText('Yesterday')).toBeTruthy();
    expect(getAllByText('Today')).toHaveLength(1);
  });

  it('highlights a line from someone else that names me, but not my own', () => {
    withLayout();
    const { getByText } = renderChat(
      [msg(1, 'tomas', 'me: can you cut the release?', now), msg(2, 'me', 'me: talking to myself', now)],
      'me',
    );
    const rowOf = (text: string) => getByText(text).closest('[data-index]') as HTMLElement;
    expect(rowOf('me: can you cut the release?').className).toContain('accent-soft');
    expect(rowOf('me: talking to myself').className).not.toContain('accent-soft');
  });
});

describe('MessageArea: sessions in the server log', () => {
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
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
  const raw = (id: number, text: string): Message => ({
    id,
    nick: '',
    text,
    timestamp: new Date(id * 1000),
    isRaw: true,
  });
  const area = (isLog: boolean, messages: Message[]) =>
    render(
      <MessageArea
        isLog={isLog}
        timestampFormat="24h"
        density="cozy"
        channelId="s:x"
        messages={messages}
        onLoadOlder={() => {}}
      />,
    );

  it('sets a new connection apart from the one before with a divider', () => {
    withLayout();
    const { container } = area(true, [
      raw(1, ':srv 001 me :Welcome'),
      raw(2, '*** Disconnected'),
      raw(3, ':srv 001 me :Welcome'),
      raw(4, '*** Connection lost - reconnecting...'),
      raw(5, '*** Reconnected'),
    ]);
    expect([...container.querySelectorAll('span')].filter((s) => s.textContent === 'New session')).toHaveLength(2);
  });

  it('has no divider before the first session, and none in a conversation', () => {
    withLayout();
    expect(
      area(true, [raw(1, ':srv 001 me :Welcome'), raw(2, ':srv 372 me :motd')]).container.textContent,
    ).not.toContain('New session');
    expect(area(false, [raw(1, '*** Disconnected'), raw(2, 'hello')]).container.textContent).not.toContain(
      'New session',
    );
  });
});
