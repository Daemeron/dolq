import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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
    expect(rowOf('me: can you cut the release?').className).toContain('brand-soft');
    expect(rowOf('me: talking to myself').className).not.toContain('brand-soft');
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

describe('MessageArea: folded membership runs', () => {
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(900);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 900,
      top: 0,
      left: 0,
      right: 800,
      bottom: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }
  const at = (id: number, text: string, membership?: 'join' | 'part' | 'quit'): Message => ({
    id,
    nick: membership ? '' : 'mira',
    text,
    timestamp: new Date(2026, 9, 29, 13, id),
    system: !!membership,
    membership,
  });
  const messages = [
    at(1, 'hello there'),
    at(2, 'nolden joined', 'join'),
    at(3, 'warrior left (bye)', 'part'),
    at(4, 'seeker24 quit (Ping timeout)', 'quit'),
    at(5, 'see you'),
  ];
  const area = (msgs: Message[], channelId = 's:#c') =>
    render(
      <MessageArea
        isLog={false}
        timestampFormat="24h"
        density="cozy"
        channelId={channelId}
        messages={msgs}
        onLoadOlder={() => {}}
      />,
    );

  it('folds a run of joins, leaves and quits into one line between the messages around it', () => {
    withLayout();
    const { container, getByRole } = area(messages);
    expect(container.textContent).toContain('hello there');
    expect(container.textContent).toContain('see you');
    const summary = getByRole('button', { name: /nolden joined · warrior left · seeker24 quit/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(container.textContent).toContain('3 events · until 13:04');
    expect(container.textContent).not.toContain('seeker24 quit (Ping timeout)');
    expect(container.textContent).not.toContain('warrior left (bye)');
  });

  it('shows every line of the run when opened, and folds it again', () => {
    withLayout();
    const { container, getByRole } = area(messages);
    fireEvent.click(getByRole('button', { name: /nolden joined/ }));
    expect(getByRole('button', { name: /nolden joined/ })).toHaveAttribute('aria-expanded', 'true');
    expect(container.textContent).toContain('warrior left (bye)');
    expect(container.textContent).toContain('seeker24 quit (Ping timeout)');
    fireEvent.click(getByRole('button', { name: /nolden joined/ }));
    expect(container.textContent).not.toContain('warrior left (bye)');
  });

  it('keeps an opened run open in its own channel only', () => {
    withLayout();
    const first = area(messages, 's:#a');
    fireEvent.click(first.getByRole('button', { name: /nolden joined/ }));
    first.rerender(
      <MessageArea
        isLog={false}
        timestampFormat="24h"
        density="cozy"
        channelId="s:#b"
        messages={messages}
        onLoadOlder={() => {}}
      />,
    );
    expect(first.getByRole('button', { name: /nolden joined/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves one or two membership lines as they are', () => {
    withLayout();
    const { container, queryByRole } = area([at(1, 'hello'), at(2, 'a joined', 'join'), at(3, 'b left', 'part')]);
    expect(container.textContent).toContain('a joined');
    expect(container.textContent).toContain('b left');
    expect(queryByRole('button', { name: /events/ })).toBeNull();
  });

  it('reads the real height of a folded run head again when the lines change', () => {
    setHeights(800, 800);
    // The head of a folded run is a button; its height is what the page says it is, which can differ from what the list holds.
    let summaryHeight = 20;
    const heightOf = (el: HTMLElement) =>
      el.querySelector('button[aria-expanded]') ? summaryHeight : el.textContent ? 20 : 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.dataset.index === undefined ? 800 : heightOf(this);
      return { top: 0, left: 0, right: 1000, bottom: height, width: 1000, height, x: 0, y: 0, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.index === undefined ? 800 : heightOf(this);
    });
    const join = (id: number): Message => ({
      id,
      nick: '',
      text: `user${id} joined`,
      timestamp: new Date(0),
      system: true,
      membership: 'join',
    });
    const lines = (): Message[] => [
      join(1),
      join(2),
      join(3),
      { id: 4, nick: 'mira', text: 'hi', timestamp: new Date(0) },
    ];
    const props = { isLog: false, timestampFormat: '24h', density: 'cozy', channelId: 'c' } as const;
    const view = render(<MessageArea {...props} messages={lines()} />);
    const chatTop = () => {
      const row = view.container.querySelector<HTMLElement>('[data-index="3"]');
      return Number(row?.style.transform.match(/translateY\((-?[\d.]+)px\)/)?.[1]);
    };
    expect(chatTop()).toBe(20);

    summaryHeight = 28;
    view.rerender(<MessageArea {...props} messages={lines()} />);
    expect(chatTop()).toBe(28);
  });

  describe('jumping to the latest line', () => {
    const many = (): Message[] => Array.from({ length: 50 }, (_, i) => line(i + 1));
    const scrollTo = (view: ReturnType<typeof render>, top: number) => {
      const box = view.container.querySelector('.overflow-y-auto') as HTMLElement;
      box.scrollTop = top;
      fireEvent.scroll(box);
    };

    it('offers it once scrolled well up, and not near the bottom', () => {
      setHeights(2000, 800);
      const view = render(<MessageArea isLog timestampFormat="24h" density="cozy" channelId="c" messages={many()} />);
      scrollTo(view, 1200);
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
      scrollTo(view, 200);
      expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
      scrollTo(view, 1150);
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    });

    it('scrolls to the newest line when clicked', () => {
      setHeights(2000, 800);
      const scrolled = vi.fn();
      const original = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = scrolled;
      onTestFinished(() => {
        HTMLElement.prototype.scrollTo = original;
      });
      const view = render(<MessageArea isLog timestampFormat="24h" density="cozy" channelId="c" messages={many()} />);
      scrollTo(view, 0);
      fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
      expect(scrolled).toHaveBeenCalled();
    });

    it('is not offered when everything fits', () => {
      setHeights(500, 800);
      render(<MessageArea isLog timestampFormat="24h" density="cozy" channelId="c" messages={[line(1)]} />);
      expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    });
  });

  describe('nicks and copying', () => {
    const chat = (id: number, nick: string, text: string): Message => ({ id, nick, text, timestamp: new Date(0) });
    const actions = () => ({
      canAsk: true,
      currentNick: 'me',
      onOpenQuery: vi.fn(),
      onWhois: vi.fn(),
      ignoredNicks: [] as string[],
      onToggleIgnore: vi.fn(),
      onDCCOffer: vi.fn(),
      onSendFile: vi.fn(),
    });
    const mount = (messages: Message[], nickActions?: ReturnType<typeof actions>) => {
      setHeights(800, 800);
      return render(
        <MessageArea
          isLog={false}
          timestampFormat="24h"
          density="cozy"
          channelId="c"
          messages={messages}
          nickActions={nickActions}
        />,
      );
    };

    it('opens a conversation when a nick is clicked, as the member list does', () => {
      const a = actions();
      mount([chat(1, 'mira', 'hello')], a);
      fireEvent.click(screen.getByRole('button', { name: 'mira' }));
      expect(a.onOpenQuery).toHaveBeenCalledWith('mira');
    });

    it('does not open a conversation with oneself or while disconnected', () => {
      const a = { ...actions(), currentNick: 'mira' };
      mount([chat(1, 'mira', 'hello')], a);
      fireEvent.click(screen.getByRole('button', { name: 'mira' }));
      expect(a.onOpenQuery).not.toHaveBeenCalled();
    });

    it('opens the nick menu on a right click, on the nick and on the avatar alike', () => {
      const a = actions();
      const view = mount([chat(1, 'mira', 'hello')], a);
      fireEvent.contextMenu(screen.getByRole('button', { name: 'mira' }));
      fireEvent.click(screen.getByText('WHOIS'));
      expect(a.onWhois).toHaveBeenCalledWith('mira');
      expect(screen.queryByText('WHOIS')).toBeNull();

      fireEvent.contextMenu(view.container.querySelector('button[aria-hidden="true"]') as HTMLElement);
      fireEvent.click(screen.getByText('Ignore'));
      expect(a.onToggleIgnore).toHaveBeenCalledWith('mira');
    });

    it('underlines a nick on hover, but not the avatar next to it', () => {
      const view = mount([chat(1, 'mira', 'hello')], actions());
      expect(screen.getByRole('button', { name: 'mira' }).className).toContain('hover:underline');
      const avatar = view.container.querySelector('button[aria-hidden="true"]') as HTMLElement;
      expect(avatar.className).not.toContain('underline');
    });

    it('leaves nicks as plain text without actions', () => {
      mount([chat(1, 'mira', 'hello')]);
      expect(screen.queryByRole('button', { name: 'mira' })).toBeNull();
      expect(screen.getByText('mira')).toBeTruthy();
    });

    it('copies a message without its formatting', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      mount([chat(1, 'mira', '\x02hello\x02 \x0304there')]);
      fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
      expect(writeText).toHaveBeenCalledWith('hello there');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    });

    it('copies the whole run from one person, a line each, as well as a single line', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const at = (minute: number) => new Date(minute * 60_000);
      mount([
        { id: 1, nick: 'mira', text: 'before', timestamp: at(0) },
        { id: 2, nick: 'jon', text: 'first', timestamp: at(1) },
        { id: 3, nick: 'jon', text: '\x02second\x02', timestamp: at(2) },
        { id: 4, nick: 'jon', text: 'third', timestamp: at(3) },
        { id: 5, nick: 'mira', text: 'after', timestamp: at(4) },
      ]);
      // Only the three lines of the run offer it: the lines of the others stand alone.
      const all = screen.getAllByRole('button', { name: 'Copy all 3 lines' });
      expect(all).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(5);
      fireEvent.click(all[1]);
      expect(writeText).toHaveBeenCalledWith('first\nsecond\nthird');
    });

    it('offers no copy button on a membership line', () => {
      mount([{ id: 1, nick: '', text: 'mira joined', timestamp: new Date(0), system: true }]);
      expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
    });
  });
});
