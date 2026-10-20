import type { ChildProcess } from 'node:child_process';

// Resolves once the child is gone. A child that already exited never emits
// 'exit' again, so waiting on the event alone would hang forever.
export function stopChild(child: ChildProcess, killAfterMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
