import { Component, type ReactNode, type ErrorInfo } from 'react';
export class GraphicsBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError(error: Error): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV)
      console.error('Graphics initialization failed', error.message, info.componentStack);
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
