import { useId } from 'react';
import { tp } from '@/i18n';

const STAR_PATH = 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z';

/**
 * Five native radios: Tab enters the group, the arrow keys choose, a touch on a star chooses it. Each radio has its
 * own text ("3 stars"); the stars up to the chosen one are drawn filled. 56 px tall targets.
 */
export function StarInput({
  value,
  onChange,
  legend,
  error,
}: {
  value: number;
  onChange: (n: number) => void;
  legend: string;
  error?: string | undefined;
}) {
  const name = useId();
  return (
    <fieldset
      aria-describedby={error ? `${name}-err` : undefined}
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend className="type-label mb-1 p-0">{legend}</legend>
      <div className="star-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`star ${value >= n ? 'is-on' : ''}`}>
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={STAR_PATH} />
            </svg>
            <span className="sr-only">{tp('rate.star', n)}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-err`} role="alert" className="text-sm leading-5 font-semibold text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
