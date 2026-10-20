export type AlertInput = {
  target: string;
  channelId: string;
  selectedChannelId: string;
  muted: boolean;
  windowFocused: boolean;
  mentioned: boolean;
};

// Whether an incoming message should raise a notification/sound. A channel
// needs a mention of our nick; a private message is always for us. The channel
// on screen only stays quiet while the window is actually in front.
export function shouldAlert({ target, channelId, selectedChannelId, muted, windowFocused, mentioned }: AlertInput) {
  if (muted) return false;
  if (channelId === selectedChannelId && windowFocused) return false;
  const isChannel = /^[#&+!]/.test(target);
  return isChannel ? mentioned : true;
}
