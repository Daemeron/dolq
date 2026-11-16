export type LogTone = 'welcome' | 'info' | 'motd' | 'banner' | 'notice' | 'cap' | 'mode' | 'plain';

export type LogParts = { prefix: string; command: string; params: string; tone: LogTone };

const INFO_NUMERICS = new Set(['002', '003', '004', '005', '251', '252', '253', '254', '255', '265', '266']);

/** A raw server line split into its source, its command and the rest, with the kind of line it is. */
export function logLineParts(line: string): LogParts {
  const m = /^((?:@\S+ )?:?\S+ )?(\S+)(?: (.*))?$/.exec(line);
  // Without a source ("PING :x", "ERROR :x") the command is the first word.
  const hasPrefix = !!m?.[1] && /^(@\S+ )?:/.test(m[1]);
  if (!m || !hasPrefix) {
    const [command = '', ...rest] = line.split(' ');
    return { prefix: '', command, params: rest.join(' '), tone: toneOf(command) };
  }
  return { prefix: m[1].trimEnd(), command: m[2], params: m[3] ?? '', tone: toneOf(m[2]) };
}

function toneOf(command: string): LogTone {
  const c = command.toUpperCase();
  if (c === '001') return 'welcome';
  if (INFO_NUMERICS.has(c)) return 'info';
  if (c === '372') return 'motd';
  if (c === '375' || c === '376') return 'banner';
  if (c === 'NOTICE') return 'notice';
  if (c === 'CAP') return 'cap';
  if (c === 'MODE') return 'mode';
  return 'plain';
}
