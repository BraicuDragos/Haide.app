import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Tone = 'info' | 'error' | 'warning' | 'success';

const TONE: Record<Tone, { box: string; icon: IconName }> = {
  info: { box: 'bg-info-bg text-info', icon: 'info' },
  error: { box: 'bg-error-bg text-error', icon: 'alert' },
  warning: { box: 'bg-warning-bg text-warning', icon: 'alert' },
  success: { box: 'bg-success-bg text-success', icon: 'check' },
};

/** Inline banner. Colour is never the only cue: icon plus words. Errors use role=alert, the rest role=status. */
export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { box, icon } = TONE[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm leading-5 font-semibold ${box}`}
    >
      <Icon name={icon} small className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}
