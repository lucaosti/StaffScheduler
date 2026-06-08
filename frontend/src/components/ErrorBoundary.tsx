/**
 * ErrorBoundary component.
 *
 * Catches uncaught render-time errors anywhere in the React tree and
 * displays a friendly fallback instead of a blank screen.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (process.env.NODE_ENV !== 'production') {
      // console.error is intentional here: this is a class-based error boundary and
      // React's error lifecycle methods have no hook equivalent, so the Winston logger
      // (a module-level singleton) cannot be reached from this context.
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="d-flex align-items-center justify-content-center min-vh-100">
          <div className="text-center p-4">
            <i className="bi bi-exclamation-triangle text-danger" style={{ fontSize: '3rem' }}></i>
            <h2 className="mt-3">Something went wrong.</h2>
            <p className="text-muted">Please reload the page and try again.</p>
            <button className="btn btn-primary mt-2" onClick={this.handleReload}>
              <i className="bi bi-arrow-clockwise me-2"></i>
              Reload the page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
