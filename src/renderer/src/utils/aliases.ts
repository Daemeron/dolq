// Expands "$1".."$9" to individual whitespace-separated args and "$*" to
// the entire args string, in an alias's stored expansion template - e.g.
// template "PRIVMSG $1 :hi" with args "alice" becomes "PRIVMSG alice :hi".
// A token with nothing to substitute (more $N than args given) becomes "".
export function expandAlias(template: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  return template.replace(/\$(\d|\*)/g, (_, token: string) => {
    if (token === '*') return args;
    return parts[Number(token) - 1] ?? '';
  });
}
