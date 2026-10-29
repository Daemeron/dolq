import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/ipc';
import { formatHostPort, parsePairingLink } from '../../../shared/pairing';
import type { KeybindAction } from '../store';
import type { Server } from '../types';
import { comboFromEvent } from '../utils/keybind';
import { type XdccSender, xdccSenderKey } from '../utils/xdcc';
import { Button, Card, Field, inputClass, Segmented, Setting, Switch, Tabs } from './ui';
import { ViewPanel } from './ViewPanel';

const KEYBIND_LABELS: Record<KeybindAction, string> = {
  nextChannel: 'Next Channel',
  prevChannel: 'Previous Channel',
  closeChannel: 'Close Current Channel',
  toggleMute: 'Toggle Mute on Current Channel',
  openSearch: 'Search',
};

export type Tab = 'general' | 'appearance' | 'notifications' | 'keybindings' | 'backend';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'backend', label: 'Backend' },
];

const parseWords = (text: string) =>
  text
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);

type Props = {
  initialTab?: Tab;
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  soundAlertsEnabled: boolean;
  onSoundAlertsEnabledChange: (enabled: boolean) => void;
  showMembershipEvents: boolean;
  onShowMembershipEventsChange: (show: boolean) => void;
  timestampFormat: '12h' | '24h';
  onTimestampFormatChange: (format: '12h' | '24h') => void;
  messageDensity: 'cozy' | 'compact';
  onMessageDensityChange: (density: 'cozy' | 'compact') => void;
  fontSize: 'small' | 'medium' | 'large';
  onFontSizeChange: (size: 'small' | 'medium' | 'large') => void;
  fontFamily: 'system' | 'serif' | 'monospace';
  onFontFamilyChange: (family: 'system' | 'serif' | 'monospace') => void;
  theme: 'dark' | 'light' | 'system';
  onThemeChange: (theme: 'dark' | 'light' | 'system') => void;
  highlightWords: string[];
  onHighlightWordsChange: (words: string[]) => void;
  servers: Server[];
  ignoredNicks: Record<string, string[]>;
  onRemoveIgnore: (serverId: string, nick: string) => void;
  xdccTrusted: Record<string, XdccSender[]>;
  onUntrustXdcc: (serverId: string, sender: XdccSender) => void;
  aliases: Record<string, string>;
  onRemoveAlias: (name: string) => void;
  keybindings: Record<KeybindAction, string>;
  onKeybindingChange: (action: KeybindAction, combo: string) => void;
};

export function PreferencesModal({
  initialTab = 'general',
  settings,
  onSave,
  onCancel,
  notificationsEnabled,
  onNotificationsEnabledChange,
  soundAlertsEnabled,
  onSoundAlertsEnabledChange,
  showMembershipEvents,
  onShowMembershipEventsChange,
  timestampFormat,
  onTimestampFormatChange,
  messageDensity,
  onMessageDensityChange,
  fontSize,
  onFontSizeChange,
  fontFamily,
  onFontFamilyChange,
  theme,
  onThemeChange,
  highlightWords,
  onHighlightWordsChange,
  servers,
  ignoredNicks,
  onRemoveIgnore,
  xdccTrusted,
  onUntrustXdcc,
  aliases,
  onRemoveAlias,
  keybindings,
  onKeybindingChange,
}: Props) {
  const [trayEnabled, setTrayEnabled] = useState(settings.trayEnabled ?? false);
  const [remoteEnabled, setRemoteEnabled] = useState(settings.remoteEnabled ?? false);
  const [remoteUrl, setRemoteUrl] = useState(settings.remoteUrl ?? '');
  const [remoteTls, setRemoteTls] = useState(
    // a URL saved before TLS existed stays plain; anything new starts encrypted
    settings.remoteTls ?? (settings.remoteUrl ? Boolean(settings.remoteTokenSet || settings.remoteFingerprint) : true),
  );
  const [remoteFingerprint, setRemoteFingerprint] = useState(settings.remoteFingerprint ?? '');
  const [remoteToken, setRemoteToken] = useState('');
  const [pairingText, setPairingText] = useState('');
  const noToken = !remoteToken && !settings.remoteTokenSet;
  const unprotected = !remoteTls || noToken;
  const pairing = pairingText.trim() ? parsePairingLink(pairingText) : null;
  const pairingInvalid = pairingText.trim() !== '' && !pairing;

  function applyPairing(text: string) {
    setPairingText(text);
    const p = parsePairingLink(text);
    if (!p) return;
    setRemoteUrl(formatHostPort(p.host, p.port));
    setRemoteToken(p.token);
    // The fingerprint arrives with the token, so there is nothing to confirm on first connect.
    setRemoteFingerprint(p.fingerprint ?? '');
    setRemoteTls(p.tls);
  }
  const [retentionDays, setRetentionDays] = useState(String(settings.retentionDays));
  const [xdccAutoAccept, setXdccAutoAccept] = useState(settings.xdccAutoAccept ?? false);
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir ?? '');
  const [dccPortMin, setDccPortMin] = useState(settings.dccPortMin ? String(settings.dccPortMin) : '');
  const [dccPortMax, setDccPortMax] = useState(settings.dccPortMax ? String(settings.dccPortMax) : '');
  const ignoredEntries = Object.entries(ignoredNicks).flatMap(([serverId, nicks]) =>
    nicks.map((nick) => ({ serverId, nick })),
  );
  const trustedEntries = Object.entries(xdccTrusted).flatMap(([serverId, senders]) =>
    senders.map((sender) => ({ serverId, sender })),
  );
  const aliasEntries = Object.entries(aliases);
  const [recording, setRecording] = useState<KeybindAction | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [wordsText, setWordsText] = useState(highlightWords.join(', '));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (recording) {
        setRecording(null);
        return;
      }
      onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, recording]);

  useEffect(() => {
    if (!recording) return;
    const action = recording;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return;
      e.preventDefault();
      const combo = comboFromEvent(e);
      if (!combo) return;
      onKeybindingChange(action, combo);
      setRecording(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onKeybindingChange]);

  async function handleBrowseDownloadDir() {
    const chosen = await window.irc.chooseDirectory(downloadDir || undefined);
    if (chosen) setDownloadDir(chosen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(retentionDays, 10);
    let portMin = parseInt(dccPortMin, 10);
    let portMax = parseInt(dccPortMax, 10);
    if (!Number.isFinite(portMin) || !Number.isFinite(portMax) || portMin <= 0 || portMax < portMin) {
      portMin = 0;
      portMax = 0;
    }
    onSave({
      retentionDays: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
      downloadDir: downloadDir || undefined,
      dccPortMin: portMin || undefined,
      dccPortMax: portMax || undefined,
      xdccAutoAccept,
      trayEnabled,
      remoteEnabled,
      remoteUrl: remoteUrl || undefined,
      remoteTls,
      remoteFingerprint: remoteFingerprint || undefined,
      remoteToken: remoteToken || undefined,
    });
  }

  return (
    <ViewPanel
      title="Preferences"
      description="Applies to every server. Some settings need a restart to take effect."
      onClose={onCancel}
      onSubmit={handleSubmit}
      toolbar={<Tabs tabs={TABS} value={tab} onChange={setTab} />}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save
          </Button>
        </>
      }
    >
      {tab === 'general' && (
        <>
          <Card>
            <Setting title="Show joins, parts, quits and nick changes" description="In channel history.">
              <Switch checked={showMembershipEvents} onChange={(e) => onShowMembershipEventsChange(e.target.checked)} />
            </Setting>
            <Setting title="Show a tray/menu bar icon">
              <Switch checked={trayEnabled} onChange={(e) => setTrayEnabled(e.target.checked)} />
            </Setting>
            <Setting
              title="Auto-accept XDCC downloads"
              description="Start a download without asking when the bot answers a pack you requested from Dolq. Offers you did not ask for still prompt."
            >
              <Switch checked={xdccAutoAccept} onChange={(e) => setXdccAutoAccept(e.target.checked)} />
            </Setting>
            <Setting
              title="Download directory"
              description="Where XDCC downloads are saved. Empty uses the OS Downloads folder."
            >
              <input
                className={`${inputClass} w-56`}
                type="text"
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                placeholder="Downloads (default)"
              />
              <Button onClick={handleBrowseDownloadDir}>Browse…</Button>
            </Setting>
          </Card>
          {ignoredEntries.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-[12px] font-medium tracking-[0.06em] text-(--dolq-text-dim) uppercase">
                Ignored users
              </h2>
              <Card>
                {ignoredEntries.map(({ serverId, nick }) => (
                  <Setting
                    key={`${serverId}:${nick}`}
                    title={nick}
                    description={`on ${servers.find((s) => s.id === serverId)?.name ?? serverId}`}
                  >
                    <Button small variant="danger" onClick={() => onRemoveIgnore(serverId, nick)}>
                      Unignore
                    </Button>
                  </Setting>
                ))}
              </Card>
            </section>
          )}
          {trustedEntries.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-[12px] font-medium tracking-[0.06em] text-(--dolq-text-dim) uppercase">
                Trusted XDCC senders
              </h2>
              <Card>
                {trustedEntries.map(({ serverId, sender }) => (
                  <Setting
                    key={`${serverId}:${xdccSenderKey(sender)}`}
                    title={sender.nick}
                    description={`${sender.account ? `account ${sender.account}` : sender.host} on ${servers.find((s) => s.id === serverId)?.name ?? serverId}`}
                  >
                    <Button small variant="danger" onClick={() => onUntrustXdcc(serverId, sender)}>
                      Remove
                    </Button>
                  </Setting>
                ))}
              </Card>
            </section>
          )}
          {aliasEntries.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-[12px] font-medium tracking-[0.06em] text-(--dolq-text-dim) uppercase">
                Aliases
              </h2>
              <p className="m-0 text-[12px] text-(--dolq-text-dim)">
                Defined with <code>/alias name command</code> (<code>$1</code>, <code>$2</code>... for args,{' '}
                <code>$*</code> for all of them) - typing <code>/name</code> sends the expansion.
              </p>
              <Card>
                {aliasEntries.map(([name, template]) => (
                  <Setting key={name} title={`/${name}`} description={template}>
                    <Button small variant="danger" onClick={() => onRemoveAlias(name)}>
                      Remove
                    </Button>
                  </Setting>
                ))}
              </Card>
            </section>
          )}
        </>
      )}

      {tab === 'appearance' && (
        <Card>
          <Setting title="Theme" description="Light follows Claude's warm ivory; dark uses charcoal.">
            <Segmented
              label="Theme"
              value={theme}
              onChange={onThemeChange}
              options={[
                { id: 'light', label: 'Light' },
                { id: 'dark', label: 'Dark' },
                { id: 'system', label: 'System' },
              ]}
            />
          </Setting>
          <Setting title="Timestamp format">
            <select
              className={`${inputClass} w-52`}
              value={timestampFormat}
              onChange={(e) => onTimestampFormatChange(e.target.value as '12h' | '24h')}
            >
              <option value="12h">12-hour (2:30 PM)</option>
              <option value="24h">24-hour (14:30)</option>
            </select>
          </Setting>
          <Setting title="Compact messages" description="Tighter spacing between messages.">
            <Switch
              checked={messageDensity === 'compact'}
              onChange={(e) => onMessageDensityChange(e.target.checked ? 'compact' : 'cozy')}
            />
          </Setting>
          <Setting title="Font size">
            <select
              className={`${inputClass} w-52`}
              value={fontSize}
              onChange={(e) => onFontSizeChange(e.target.value as 'small' | 'medium' | 'large')}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </Setting>
          <Setting title="Font family" description="Used for messages and interface.">
            <select
              className={`${inputClass} w-52`}
              value={fontFamily}
              onChange={(e) => onFontFamilyChange(e.target.value as 'system' | 'serif' | 'monospace')}
            >
              <option value="system">System Default</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </Setting>
        </Card>
      )}

      {tab === 'notifications' && (
        <Card>
          <Setting title="Desktop notifications" description="When mentioned in a channel you're not viewing.">
            <Switch checked={notificationsEnabled} onChange={(e) => onNotificationsEnabledChange(e.target.checked)} />
          </Setting>
          <Setting title="Play a sound on mentions" description="Independent of the desktop notification.">
            <Switch checked={soundAlertsEnabled} onChange={(e) => onSoundAlertsEnabledChange(e.target.checked)} />
          </Setting>
          <Setting title="Highlight words" description="Also count these as mentions. Comma separated.">
            <input
              className={`${inputClass} w-60`}
              type="text"
              value={wordsText}
              onChange={(e) => {
                setWordsText(e.target.value);
                onHighlightWordsChange(parseWords(e.target.value));
              }}
              placeholder="release, deploy"
              autoComplete="off"
              spellCheck={false}
            />
          </Setting>
        </Card>
      )}

      {tab === 'keybindings' && (
        <Card>
          {(Object.keys(KEYBIND_LABELS) as KeybindAction[]).map((action) => (
            <Setting key={action} title={KEYBIND_LABELS[action]}>
              <Button
                small
                variant={recording === action ? 'primary' : 'secondary'}
                className="font-(family-name:--dolq-font-mono) text-[12px]"
                onClick={() => setRecording(action)}
              >
                {recording === action ? 'Press keys… (Esc to cancel)' : keybindings[action]}
              </Button>
            </Setting>
          ))}
        </Card>
      )}

      {tab === 'backend' && (
        <>
          <Card>
            <Setting
              title="Connect to a remote backend instead of running one locally"
              description="Points at a dolqd already running elsewhere (see docker-compose.yml). Sessions and history live on the remote box. Takes effect the next time Dolq starts."
            >
              <Switch checked={remoteEnabled} onChange={(e) => setRemoteEnabled(e.target.checked)} />
            </Setting>
            {remoteEnabled && (
              <div className="flex flex-col gap-3 px-4 py-3.5">
                <Field label="Pairing Link">
                  <input
                    className={inputClass}
                    type="text"
                    value={pairingText}
                    onChange={(e) => applyPairing(e.target.value)}
                    placeholder="dolq://192.168.1.5:6789?token=…  (printed by dolqd at startup)"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                {pairing && (
                  <p className="m-0 text-[12px] text-(--dolq-text-dim)">
                    Paired with {formatHostPort(pairing.host, pairing.port)}. Save to apply.
                  </p>
                )}
                {pairingInvalid && (
                  <p className="m-0 text-[12px] text-(--dolq-danger)">That is not a valid Dolq pairing link.</p>
                )}
                <Field label="Remote Backend URL">
                  <input
                    className={inputClass}
                    type="text"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="host:6789"
                  />
                </Field>
                <Field label="Access Token (optional)">
                  <input
                    className={inputClass}
                    type="password"
                    value={remoteToken}
                    onChange={(e) => setRemoteToken(e.target.value)}
                    placeholder={
                      settings.remoteTokenSet
                        ? 'Saved - type to replace'
                        : 'From the pairing link; empty if the backend runs with -token=false'
                    }
                    autoComplete="off"
                  />
                </Field>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: the label wraps a Switch, which is a checkbox input */}
                <label className="flex cursor-pointer items-center gap-2.5 text-[14px] select-none">
                  <Switch checked={remoteTls} onChange={(e) => setRemoteTls(e.target.checked)} />
                  Encrypt the connection (TLS)
                </label>
                {unprotected && (
                  <p className="m-0 text-[12px] text-(--dolq-warn)">
                    {!remoteTls && 'Without TLS, passwords and messages cross the network in the clear. '}
                    {noToken && 'Without a token, anyone who can reach the backend can use it. '}
                    Only run like this for a tunnel, a trusted proxy, or a network you fully trust (a backend started
                    with -tls=false and/or -token=false). You will be asked to confirm each time Dolq connects.
                  </p>
                )}
                {remoteTls && remoteFingerprint && (
                  <div className="text-[12px] break-all text-(--dolq-text-dim)">
                    Trusted certificate:{' '}
                    <span className="font-(family-name:--dolq-font-mono)">{remoteFingerprint}</span>{' '}
                    <button
                      type="button"
                      onClick={() => setRemoteFingerprint('')}
                      className="cursor-pointer border-0 bg-transparent p-0 text-(--dolq-accent-text) underline"
                    >
                      Forget
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
          <Card>
            <Setting
              title="History retention (days)"
              description="How long to keep chat history. 0 keeps it forever. Takes effect the next time Dolq starts."
            >
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                placeholder="0"
                min={0}
              />
            </Setting>
            <Setting
              title="DCC port range (min)"
              description="Ports DCC CHAT offers and passive XDCC downloads listen on. Leave both empty to let the OS pick; set a range to forward through a router or firewall."
            >
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={dccPortMin}
                onChange={(e) => setDccPortMin(e.target.value)}
                placeholder="Any"
                min={1}
                max={65535}
              />
            </Setting>
            <Setting title="DCC port range (max)">
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={dccPortMax}
                onChange={(e) => setDccPortMax(e.target.value)}
                placeholder="Any"
                min={1}
                max={65535}
              />
            </Setting>
          </Card>
        </>
      )}
    </ViewPanel>
  );
}
