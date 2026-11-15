import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/api/telemetry';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';

interface Props {
  /** Route template for telemetry, never the raw URL. */
  route: string;
  /** Changing this resets the boundary (pass the location key). */
  resetKey: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
  resetKey: string;
}

/** Global error boundary: shows a retry screen and posts to /telemetry/error (conventions section 4). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    reportError(error, this.props.route);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-4 p-4 pt-8">
        <h1 className="type-h2">{t('error.boundary.title')}</h1>
        <p className="text-text-muted">{t('error.boundary.body')}</p>
        <Button onClick={() => window.location.reload()}>{t('error.boundary.cta')}</Button>
      </div>
    );
  }
}
