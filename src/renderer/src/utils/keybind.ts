// Shared by the global shortcut listener (App.tsx) and the recorder in
// PreferencesModal, so "what counts as a combo" only has one definition.
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

// Requires at least one modifier - without that, a rebound combo could just
// be a letter someone types into the message box every day.
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}
