import { useRef, useState } from 'react';
import { playLaunch } from '@/motion/launch';
import { Icon } from './Icon';

export type LaunchResult = 'sent' | 'saved';

interface Props {
  /** Label before the action, e.g. "Request seat" or "Publish ride". */
  label: string;
  /** Plain confirmed text, also what screen readers hear: "Seat requested". Never contains the wordmark. */
  confirmed: string;
  /** Plain confirmed text for an offline-queued action ("Request saved"). */
  saved?: string;
  /** The wordmark (copy key launch.haide). Shown only when the action really left, aria-hidden. */
  wordmark: string;
  /** Announced while the request is in flight ("Sending request"). */
  sending: string;
  /** Does the real work. Resolves 'sent' (server accepted) or 'saved' (queued offline); reject to fail. */
  onLaunch: () => Promise<LaunchResult>;
  /** Called after the animation and the response are both done: navigate here. */
  onDone: (result: LaunchResult) => void;
  /** Called when onLaunch rejects: show the error inline (no wordmark). The button is restored. */
  onError?: (error: unknown) => void;
  disabled?: boolean;
  className?: string;
}

type State = 'idle' | 'sending' | 'done';

/**
 * The one primary action that "leaves" (Publish ride, Request seat). Owns the launch moment: see motion/launch.ts.
 * Run the animation after the request is accepted, never make the person wait longer than it, and on failure restore
 * the label and report the error without any wordmark. Double submit is blocked (aria-disabled, clicks ignored).
 * The wordmark is aria-hidden and exists only here (ADR 0020).
 */
export function LaunchButton({
  label,
  confirmed,
  saved,
  wordmark,
  sending,
  onLaunch,
  onDone,
  onError,
  disabled,
  className = '',
}: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>('idle');
  const [result, setResult] = useState<LaunchResult>('sent');

  async function click() {
    if (state !== 'idle' || disabled || !btn.current) return;
    setState('sending');
    try {
      const r = await onLaunch();
      setResult(r);
      setState('done');
      // queued offline: nothing has left yet, so no wordmark
      await playLaunch(btn.current, { haide: r === 'sent' });
      onDone(r);
    } catch (e) {
      setState('idle');
      btn.current?.classList.remove('is-done');
      btn.current?.removeAttribute('aria-disabled');
      onError?.(e);
    }
  }

  const doneText = result === 'saved' && saved ? saved : confirmed;
  return (
    <div className={`cta-wrap ${className}`}>
      <button
        ref={btn}
        type="button"
        onClick={() => void click()}
        aria-disabled={state === 'idle' ? disabled || undefined : true}
        aria-label={state === 'done' ? doneText : label}
        className="btn btn-primary cta"
      >
        <span className="wipe" />
        <span className="dotl" />
        <span className="l l1">{label}</span>
        <span className="l l2">
          <Icon name="check" />
          {doneText}
        </span>
        <span className="l l3" aria-hidden="true">
          {wordmark}
        </span>
      </button>
      <span className="cta-ring" aria-hidden="true" />
      <span role="status" className="sr-only">
        {state === 'sending' ? sending : state === 'done' ? doneText : ''}
      </span>
    </div>
  );
}
