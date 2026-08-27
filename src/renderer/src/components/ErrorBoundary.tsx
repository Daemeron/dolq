import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

// Backstop for a render-time crash - without this, any unhandled throw
// anywhere in the tree (a malformed IPC payload, a null deref) unmounts the
// entire app to a blank window with no way back short of force-quitting.
// That's exactly what the nil-privileges bug (see ROADMAP's "Known bugs")
// did before it was fixed at its source; this doesn't fix any specific bug,
// it's insurance against the next unknown one. "Reload" is the recovery
// path rather than a "try again" reset, since a caught render error usually
// means some in-memory state is already inconsistent - a fresh render pass
// over the same state would likely just crash again. Connections/history
// live in the Go backend and SQLite respectively, so a reload loses
// nothing there.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dolq crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-[var(--dolq-bg)] text-[var(--dolq-text)] p-8">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <h1 className="text-[20px] font-bold">Something went wrong</h1>
          <p className="text-[var(--dolq-text-muted)] text-[14px]">
            Dolq hit an unexpected error and couldn't continue. Your history and server
            connections aren't affected - reloading gets you back.
          </p>
          <pre className="w-full text-[11px] text-[var(--dolq-text-faint)] text-left bg-[var(--dolq-bg-input)] rounded p-3 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
