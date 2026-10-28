import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { Settings } from '../../../shared/ipc';
import { PreferencesModal } from './PreferencesModal';

const FP = Array.from({ length: 32 }, () => 'AB').join(':');

function setup(settings: Partial<Settings> = {}, extra: Partial<Parameters<typeof PreferencesModal>[0]> = {}) {
  const props = {
    settings: { retentionDays: 30, ...settings } as Settings,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    notificationsEnabled: true,
    onNotificationsEnabledChange: vi.fn(),
    soundAlertsEnabled: false,
    onSoundAlertsEnabledChange: vi.fn(),
    showMembershipEvents: true,
    onShowMembershipEventsChange: vi.fn(),
    timestampFormat: '24h' as const,
    onTimestampFormatChange: vi.fn(),
    messageDensity: 'cozy' as const,
    onMessageDensityChange: vi.fn(),
    fontSize: 'medium' as const,
    onFontSizeChange: vi.fn(),
    fontFamily: 'system' as const,
    onFontFamilyChange: vi.fn(),
    theme: 'dark' as const,
    onThemeChange: vi.fn(),
    servers: [{ id: 's1', name: 'Libera', initial: 'L', host: 'h', port: 1 }] as never,
    ignoredNicks: {},
    onRemoveIgnore: vi.fn(),
    xdccTrusted: {},
    onUntrustXdcc: vi.fn(),
    aliases: {},
    onRemoveAlias: vi.fn(),
    keybindings: {
      nextChannel: 'Alt+ArrowDown',
      prevChannel: 'Alt+ArrowUp',
      closeChannel: 'Ctrl+W',
      toggleMute: 'Ctrl+M',
      openSearch: 'Ctrl+K',
    },
    highlightWords: [] as string[],
    onHighlightWordsChange: vi.fn(),
    onKeybindingChange: vi.fn(),
    ...extra,
  };
  render(<PreferencesModal {...props} />);
  return props;
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

// Submit the form directly: jsdom's constraint validation would otherwise block out-of-range values the app clamps itself.
const save = () => fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement);
const saved = (p: { onSave: unknown }): Settings => (p.onSave as Mock).mock.calls[0][0];

describe('PreferencesModal: display settings', () => {
  it('reports each display preference change', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText(/Show joins/));
    expect(p.onShowMembershipEventsChange).toHaveBeenCalledWith(false);

    tab('Notifications');
    fireEvent.click(screen.getByLabelText(/Desktop notifications/));
    expect(p.onNotificationsEnabledChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText(/Play a sound/));
    expect(p.onSoundAlertsEnabledChange).toHaveBeenCalledWith(true);

    tab('Appearance');
    fireEvent.change(screen.getByLabelText('Timestamp format'), { target: { value: '12h' } });
    expect(p.onTimestampFormatChange).toHaveBeenCalledWith('12h');
    fireEvent.click(screen.getByLabelText('Compact messages'));
    expect(p.onMessageDensityChange).toHaveBeenCalledWith('compact');
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: 'large' } });
    expect(p.onFontSizeChange).toHaveBeenCalledWith('large');
    fireEvent.change(screen.getByLabelText('Font family'), { target: { value: 'serif' } });
    expect(p.onFontFamilyChange).toHaveBeenCalledWith('serif');
  });

  it('offers light, dark and system themes and marks the current one', () => {
    const p = setup();
    tab('Appearance');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(p.onThemeChange).toHaveBeenCalledWith('system');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(p.onThemeChange).toHaveBeenCalledWith('light');
  });

  it('turns comma separated highlight words into a list as they are typed', () => {
    const p = setup({}, { highlightWords: ['deploy'] });
    tab('Notifications');
    const input = screen.getByLabelText('Highlight words') as HTMLInputElement;
    expect(input.value).toBe('deploy');
    fireEvent.change(input, { target: { value: 'release, deploy,  ,ship it' } });
    expect(p.onHighlightWordsChange).toHaveBeenLastCalledWith(['release', 'deploy', 'ship it']);
  });

  it('moves between tabs and keeps what was typed on the others', () => {
    const p = setup();
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
    tab('Backend');
    fireEvent.change(screen.getByLabelText('History retention (days)'), { target: { value: '9' } });
    tab('General');
    tab('Backend');
    expect((screen.getByLabelText('History retention (days)') as HTMLInputElement).value).toBe('9');
    save();
    expect(saved(p).retentionDays).toBe(9);
  });
});

describe('PreferencesModal: saving', () => {
  it('saves the loaded settings unchanged', () => {
    const p = setup({ retentionDays: 14, downloadDir: '/dl', xdccAutoAccept: true });
    save();
    expect(saved(p)).toMatchObject({
      retentionDays: 14,
      downloadDir: '/dl',
      xdccAutoAccept: true,
      remoteEnabled: false,
    });
  });

  it('turns a bad retention into 0 (keep forever)', () => {
    const p = setup();
    tab('Backend');
    fireEvent.change(screen.getByLabelText('History retention (days)'), { target: { value: '-5' } });
    save();
    expect(saved(p).retentionDays).toBe(0);
  });

  it('keeps a valid DCC port range', () => {
    const p = setup();
    tab('Backend');
    fireEvent.change(screen.getByLabelText('DCC port range (min)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('DCC port range (max)'), { target: { value: '5010' } });
    save();
    expect(saved(p)).toMatchObject({ dccPortMin: 5000, dccPortMax: 5010 });
  });

  it('drops an inverted or half-filled DCC port range', () => {
    const p = setup();
    tab('Backend');
    fireEvent.change(screen.getByLabelText('DCC port range (min)'), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText('DCC port range (max)'), { target: { value: '5000' } });
    save();
    expect(saved(p).dccPortMin).toBeUndefined();
    expect(saved(p).dccPortMax).toBeUndefined();
  });

  it('saves the tray and auto-accept toggles', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Show a tray/menu bar icon'));
    fireEvent.click(screen.getByLabelText('Auto-accept XDCC downloads'));
    save();
    expect(saved(p)).toMatchObject({ trayEnabled: true, xdccAutoAccept: true });
  });

  it('cancels from the button and from Escape', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('PreferencesModal: download directory', () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    delete (window as any).irc;
  });

  it('fills the folder chosen in the picker and ignores a cancelled one', async () => {
    const chooseDirectory = vi.fn().mockResolvedValueOnce('/picked').mockResolvedValueOnce(null);
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    (window as any).irc = { chooseDirectory };
    setup();
    const input = screen.getByPlaceholderText('Downloads (default)') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(input.value).toBe('/picked'));
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(2));
    expect(input.value).toBe('/picked');
  });
});

describe('PreferencesModal: remote backend', () => {
  const enable = () => {
    tab('Backend');
    fireEvent.click(screen.getByLabelText(/Connect to a remote backend/));
  };

  it('fills the form from a valid pairing link', () => {
    const p = setup();
    enable();
    fireEvent.change(screen.getByLabelText('Pairing Link'), {
      target: { value: `dolq://10.0.0.5:6789?token=sekret&fp=${FP}` },
    });
    expect(screen.getByText(/Paired with 10\.0\.0\.5:6789/)).toBeTruthy();
    save();
    expect(saved(p)).toMatchObject({
      remoteEnabled: true,
      remoteUrl: '10.0.0.5:6789',
      remoteToken: 'sekret',
      remoteFingerprint: FP,
      remoteTls: true,
    });
  });

  it('rejects a bad pairing link without touching the form', () => {
    setup();
    enable();
    fireEvent.change(screen.getByLabelText('Pairing Link'), { target: { value: 'not a link' } });
    expect(screen.getByText(/not a valid Dolq pairing link/)).toBeTruthy();
    expect((screen.getByLabelText('Remote Backend URL') as HTMLInputElement).value).toBe('');
  });

  it('warns when the connection is unprotected and explains why', () => {
    setup();
    enable();
    expect(screen.getByText(/Without a token/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Encrypt the connection (TLS)'));
    expect(screen.getByText(/Without TLS/)).toBeTruthy();
  });

  it('is silent about protection once TLS and a token are set', () => {
    setup({ remoteEnabled: true, remoteUrl: 'h:1', remoteTokenSet: true });
    tab('Backend');
    expect(screen.queryByText(/Without/)).toBeNull();
    expect((screen.getByPlaceholderText('Saved - type to replace') as HTMLInputElement).value).toBe('');
  });

  it('keeps a pre-TLS saved URL plain, and lets the user forget a trusted certificate', () => {
    const p = setup({
      remoteEnabled: true,
      remoteUrl: 'h:1',
      remoteTls: true,
      remoteTokenSet: true,
      remoteFingerprint: FP,
    });
    tab('Backend');
    expect(screen.getByText(FP)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(screen.queryByText(FP)).toBeNull();
    save();
    expect(saved(p).remoteFingerprint).toBeUndefined();
  });

  it('treats a saved URL with no TLS setting and no credentials as plain', () => {
    setup({ remoteEnabled: true, remoteUrl: 'h:1' });
    tab('Backend');
    expect((screen.getByLabelText('Encrypt the connection (TLS)') as HTMLInputElement).checked).toBe(false);
  });
});

describe('PreferencesModal: typed remote fields', () => {
  it('saves a URL, token and download folder typed by hand', () => {
    const p = setup();
    tab('Backend');
    fireEvent.click(screen.getByLabelText(/Connect to a remote backend/));
    fireEvent.change(screen.getByLabelText('Remote Backend URL'), { target: { value: 'box.example:6789' } });
    fireEvent.change(screen.getByLabelText(/Access Token/), { target: { value: 'sekret' } });
    tab('General');
    fireEvent.change(screen.getByPlaceholderText('Downloads (default)'), { target: { value: '/srv/dl' } });
    save();
    expect(saved(p)).toMatchObject({
      remoteEnabled: true,
      remoteUrl: 'box.example:6789',
      remoteToken: 'sekret',
      downloadDir: '/srv/dl',
    });
  });
});

describe('PreferencesModal: lists', () => {
  it('unignores, untrusts and removes aliases', () => {
    const sender = { nick: 'bot', account: 'botacct' };
    const p = setup(
      {},
      {
        ignoredNicks: { s1: ['troll'], gone: ['x'] },
        xdccTrusted: { s1: [sender, { nick: 'b2', host: 'h.example' }] },
        aliases: { j: '/join $1' },
      },
    );
    expect(screen.getByText('on Libera')).toBeTruthy();
    expect(screen.getByText('on gone')).toBeTruthy();
    expect(screen.getByText(/account botacct/)).toBeTruthy();
    expect(screen.getByText(/h\.example/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Unignore' })[0]);
    expect(p.onRemoveIgnore).toHaveBeenCalledWith('s1', 'troll');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(p.onUntrustXdcc).toHaveBeenCalledWith('s1', sender);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1) as HTMLElement);
    expect(p.onRemoveAlias).toHaveBeenCalledWith('j');
  });

  it('hides the lists when they are empty', () => {
    setup();
    expect(screen.queryByText('Ignored users')).toBeNull();
    expect(screen.queryByText('Trusted XDCC senders')).toBeNull();
    expect(screen.queryByText('Aliases')).toBeNull();
  });
});

describe('PreferencesModal: keybindings', () => {
  it('records a new combo, ignoring bare keys and modifiers alone', () => {
    const p = setup();
    tab('Keybindings');
    expect(screen.getByText('Search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+W' }));
    expect(screen.getByText(/Press keys/)).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'a' });
      fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    });
    expect(p.onKeybindingChange).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(p.onKeybindingChange).toHaveBeenCalledWith('closeChannel', 'Ctrl+K');
    expect(screen.queryByText(/Press keys/)).toBeNull();
  });

  it('cancels recording on Escape without closing the preferences', () => {
    const p = setup();
    tab('Keybindings');
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+W' }));
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByText(/Press keys/)).toBeNull();
    expect(p.onCancel).not.toHaveBeenCalled();
  });
});
