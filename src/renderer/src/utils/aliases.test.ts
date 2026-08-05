import { describe, it, expect } from 'vitest';
import { expandAlias } from './aliases';

describe('expandAlias', () => {
  it('substitutes $1/$2 with individual whitespace-separated args', () => {
    expect(expandAlias('PRIVMSG $1 :$2', 'alice hello there')).toBe('PRIVMSG alice :hello');
  });

  it('substitutes $* with the entire args string, untouched', () => {
    expect(expandAlias('PRIVMSG #general :$*', 'hello there, everyone')).toBe(
      'PRIVMSG #general :hello there, everyone',
    );
  });

  it('substitutes a missing positional arg with an empty string', () => {
    expect(expandAlias('PRIVMSG $1 :$2', 'alice')).toBe('PRIVMSG alice :');
  });

  it('leaves a template with no $ tokens untouched', () => {
    expect(expandAlias('PRIVMSG #general :hello', 'ignored')).toBe('PRIVMSG #general :hello');
  });

  it('treats extra whitespace between args the same as a single space', () => {
    expect(expandAlias('$1 $2', 'alice   bob')).toBe('alice bob');
  });
});
