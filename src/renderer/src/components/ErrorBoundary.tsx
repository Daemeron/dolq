import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

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
      <div className="fixed inset-0 z-999 flex items-center justify-center bg-(--dolq-bg) text-(--dolq-text) p-8">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <h1 className="text-[20px] font-bold">Something went wrong</h1>
          <p className="text-(--dolq-text-muted) text-[14px]">
            Dolq hit an unexpected error and couldn't continue. Your history and server connections aren't affected -
            reloading gets you back.
          </p>
          <pre className="w-full text-[11px] text-(--dolq-text-faint) text-left bg-(--dolq-bg-input) rounded p-3 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <button
            type="button"
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
