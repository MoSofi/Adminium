// SPDX-License-Identifier: AGPL-3.0-only
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface WidgetErrorBoundaryProps {
  children: ReactNode;
  /** Render prop for the caught state; `reset` re-attempts the children. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Render errors additionally log; the audit-trail hookup is not built yet. */
  onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary around the lazy widget component (loaded state). A
 * throwing widget — including a crashing marketplace code widget —
 * degrades to the frame's error state and never breaks sibling widgets.
 */
export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
