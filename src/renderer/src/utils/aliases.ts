export function expandAlias(template: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  return template.replace(/\$(\d|\*)/g, (_, token: string) => {
    if (token === '*') return args;
    return parts[Number(token) - 1] ?? '';
  });
}
