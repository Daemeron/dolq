import { useEffect, useRef } from 'react';

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Standard modal-dialog keyboard/focus behavior, shared by every modal in
// the app (7 of them, all the same `fixed inset-0` overlay shape) instead
// of each reimplementing it: moves focus inside on open (the first
// focusable element, or the dialog container itself if there isn't one),
// traps Tab/Shift+Tab so it can't wander into the page behind the overlay,
// and restores focus to whatever had it before the modal opened once this
// unmounts - the button that opened it, normally. Each modal keeps its own
// existing Escape-to-close effect as-is (PreferencesModal's has an extra
// case for cancelling keybind-recording first) - this only adds behavior
// on top, never replaces it.
export function useModalA11y<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusable()[0] ?? dialog)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    dialog?.addEventListener('keydown', onKeyDown);
    return () => {
      dialog?.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}
