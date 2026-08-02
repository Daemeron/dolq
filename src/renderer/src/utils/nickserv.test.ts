import { describe, it, expect } from 'vitest';
import { isNickServIdentifyPrompt } from './nickserv';

describe('isNickServIdentifyPrompt', () => {
  it('matches the common atheme-style "registered" wording', () => {
    expect(
      isNickServIdentifyPrompt(
        'NickServ',
        'This nickname is registered. Please choose a different nickname, or identify via /msg NickServ identify <password>.',
      ),
    ).toBe(true);
  });

  it('matches ergo-style "reserved" wording', () => {
    expect(
      isNickServIdentifyPrompt('NickServ', 'This nickname is reserved. Please login using NS IDENTIFY.'),
    ).toBe(true);
  });

  it('is case-insensitive on both nick and text', () => {
    expect(isNickServIdentifyPrompt('nickserv', 'THIS NICK IS REGISTERED, PLEASE IDENTIFY')).toBe(true);
  });

  it('ignores a notice from anyone other than NickServ', () => {
    expect(isNickServIdentifyPrompt('alice', 'This nickname is registered, please identify')).toBe(false);
  });

  it('ignores an unrelated NickServ notice', () => {
    expect(isNickServIdentifyPrompt('NickServ', 'You are now identified for dolq_user.')).toBe(false);
  });
});
