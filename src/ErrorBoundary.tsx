// ─── ErrorBoundary ────────────────────────────────────────────────────
// React error boundary that wraps the widget. A render error INSIDE the
// widget must not take down the host application — this boundary catches
// it, shows a compact fallback, and optionally reports via callback.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Callback fired when an error is caught. Useful for telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Optional custom fallback. Defaults to a small inline error card. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="ll-error-boundary" role="alert">
        <p className="ll-error-boundary__title">Widget crashed</p>
        <p className="ll-error-boundary__message">
          {this.state.error?.message || "Something went wrong."}
        </p>
        <button
          type="button"
          className="ll-error-boundary__retry"
          onClick={this.reset}
        >
          Reload widget
        </button>
      </div>
    );
  }
}
