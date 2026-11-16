/** The content of a shields.io endpoint file (https://shields.io/badges/endpoint-badge) for one coverage percentage. */
export function coverageBadge(label: string, percent: number) {
  const color =
    percent >= 90
      ? 'brightgreen'
      : percent >= 80
        ? 'green'
        : percent >= 70
          ? 'yellowgreen'
          : percent >= 60
            ? 'yellow'
            : percent >= 50
              ? 'orange'
              : 'red';
  return { schemaVersion: 1, label, message: `${percent.toFixed(1)}%`, color };
}
