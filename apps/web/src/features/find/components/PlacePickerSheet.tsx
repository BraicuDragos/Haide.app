import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { reversePlace, searchPlaces } from '@/api/places';
import type { Place } from '@/api/types';
import { t, tError, tp } from '@/i18n';
import { GeolocationFailure, getCurrentPoint } from '@/lib/geolocation';
import { useDebounced } from '@/lib/useDebounced';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';

export type PickerKind = 'from' | 'to';

interface Props {
  open: boolean;
  kind: PickerKind;
  onSelect: (place: Place) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
// Static suggestions: tapping one fills the search box. "Șelimbăr" shows off the diacritics-insensitive search.
const SUGGESTIONS = ['Piața Mare', 'Șelimbăr', 'Cisnădie', 'Hipodrom', 'Gara Sibiu'] as const;

export function PlacePickerSheet({ open, kind, onSelect, onClose }: Props) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(kind === 'from' ? 'place.title.from' : 'place.title.to')}
    >
      {/* Body unmounts with the sheet, so every opening starts with a clean search. */}
      <PickerBody onSelect={onSelect} />
    </Sheet>
  );
}

function PickerBody({ onSelect }: { onSelect: (place: Place) => void }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), DEBOUNCE_MS);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [mapNote, setMapNote] = useState(false);

  // The dialog opens in the parent's effect, which runs after this one: focus on the next tick.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const enabled = debounced.length >= MIN_CHARS;
  const search = useQuery({
    queryKey: keys.places.search(debounced),
    queryFn: ({ signal }) => searchPlaces(debounced, signal),
    enabled,
    staleTime: 5 * 60_000,
  });

  const typing = q.trim() !== debounced; // user typed since the last debounce tick
  const pending = enabled && (search.isPending || typing);
  const items = search.data ?? [];

  async function locateMe() {
    setLocError(null);
    setMapNote(false);
    setLocating(true);
    try {
      const point = await getCurrentPoint();
      onSelect(await reversePlace(point));
    } catch (err) {
      if (err instanceof GeolocationFailure) {
        setLocError(err.reason === 'denied' ? t('place.permissionDenied') : t('error.generic'));
      } else if (err instanceof ApiError && err.status === 404) {
        setLocError(t('place.outside'));
      } else {
        setLocError(err instanceof ApiError ? tError(err.code) : t('error.generic'));
      }
    } finally {
      setLocating(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="sr-only">
          {t('place.search')}
        </label>
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
          />
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            role="searchbox"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('place.search')}
            className="control min-h-12 border border-border-strong py-3 pr-3 pl-11"
          />
        </div>
        <p className="text-sm leading-5 text-text-muted">{t('place.hint')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="tonal"
          block
          loading={locating}
          onClick={() => void locateMe()}
          icon={<Icon name="locate" />}
        >
          {locating ? t('place.locating') : t('place.myLocation')}
        </Button>
        <p className="text-sm leading-5 text-text-muted">{t('place.myLocation.hint')}</p>
        {locError && <Notice tone="error">{locError}</Notice>}
        <Button variant="ghost" block icon={<Icon name="map" />} onClick={() => setMapNote(true)}>
          {t('place.onMap')}
        </Button>
        {mapNote && <Notice tone="info">{t('place.mapSoon')}</Notice>}
      </div>

      <section aria-labelledby={`${inputId}-res`} className="flex flex-col gap-2">
        <h3 id={`${inputId}-res`} className="type-label text-text-muted">
          {enabled && !typing && search.isSuccess && items.length > 0
            ? tp('place.count', items.length)
            : t('place.suggestions')}
        </h3>

        {!enabled && (
          <ul className="flex flex-wrap gap-2" aria-label={t('place.suggestions')}>
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => {
                    setQ(s);
                    inputRef.current?.focus();
                  }}
                  className="min-h-11 rounded-full border border-border-strong px-4 py-2 font-semibold hover:bg-tint"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}

        {pending && !search.isError && (
          <div role="status" aria-busy="true" className="grid place-items-center py-4">
            <MiniLoader label={t('place.searching')} />
          </div>
        )}

        {enabled && !typing && search.isError && (
          <div className="flex flex-col items-start gap-2">
            <Notice tone="error">
              {search.error instanceof ApiError ? tError(search.error.code) : t('place.error')}
            </Notice>
            <Button variant="secondary" onClick={() => void search.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {enabled && !typing && search.isSuccess && (
          <>
            <p role="status" className="sr-only">
              {items.length === 0
                ? t('place.noMatch', { q: debounced })
                : tp('place.count', items.length)}
            </p>
            {items.length === 0 ? (
              <p className="py-2 text-text-muted">{t('place.noMatch', { q: debounced })}</p>
            ) : (
              <ul className="flex flex-col">
                {items.map((p) => (
                  <li key={p.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left hover:bg-surface-subtle"
                    >
                      <Icon name="pin" className="text-link" />
                      <span className="min-w-0">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block text-sm leading-5 text-text-muted">
                          {p.secondary || p.areaName}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}
