export type SendResult = { ok: true } | { ok: false; error: string };

// onSend may be sync or async; either way a failure becomes a result the
// input can act on (restore the text, show why) instead of an unhandled rejection.
export async function trySend(text: string, send: (text: string) => void | Promise<void>): Promise<SendResult> {
  try {
    await send(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// After a failed send the draft comes back, unless the user already started typing something new.
export function restoreDraft(current: string, failed: string): string {
  return current === '' ? failed : current;
}
