import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** If anything in the React tree throws, show a readable fallback instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback">
          <div className="mono ef-title">lostless_ // something crashed</div>
          <div className="mono ef-msg">{this.state.error.message}</div>
          <button className="btn primary" onClick={() => window.location.reload()}>
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
