import type { Settings } from '../shared/ipc';
import type { SecretsStore } from './secrets';

// The remote backend's access token lives in the keychain-backed secrets store
// under this pseudo-server id. Where no keychain exists it falls back to
// settings.json (owner-only), and is never sent to the renderer either way.
export const BACKEND_SECRET_ID = '__backend__';

// What to persist when the renderer saves settings. The renderer never holds
// the token, so an incoming save either carries a new one or means "keep mine".
export function applyIncomingSettings(
  prev: Settings,
  incoming: Settings,
  secrets: Pick<SecretsStore, 'remember' | 'forget'>,
): Settings {
  const { remoteToken, remoteTokenSet: _ignored, ...rest } = incoming;
  const next: Settings = rest;
  const movedAddress = next.remoteUrl !== prev.remoteUrl;
  // A pin belongs to one address: moving to another without a new pin drops it.
  if (movedAddress && next.remoteFingerprint === prev.remoteFingerprint) {
    next.remoteFingerprint = undefined;
  }
  // Likewise a token must not follow a changed URL to a new host.
  if (remoteToken) {
    if (!secrets.remember(BACKEND_SECRET_ID, { remoteToken })) next.remoteToken = remoteToken;
  } else if (movedAddress) {
    secrets.forget(BACKEND_SECRET_ID);
  } else if (prev.remoteToken) {
    next.remoteToken = prev.remoteToken;
  }
  return next;
}
