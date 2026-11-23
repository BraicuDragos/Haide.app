import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { reversePlace } from '@/api/places';
import type { LatLng, Place } from '@/api/types';
import { t } from '@/i18n';
import { GeolocationFailure, getCurrentPoint } from '@/lib/geolocation';
import { reducedMotion } from '@/lib/prefs';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import type { CreateMap, MapHandle } from './mapAdapter';
import {
  CHOSEN_ZOOM,
  createLookup,
  DEFAULT_CENTRE,
  DEFAULT_ZOOM,
  inCoverage,
  pinLabel,
  pinPlace,
  roundPoint,
  type Lookup,
  type LabelText,
  type LookupState,
} from './mapPick';

export interface MapPickerProps {
  kind: 'from' | 'to';
  /** Where to start: the value already chosen in this field, if any. */
  initial?: LatLng | undefined;
  onPick: (place: Place) => void;
  onClose: () => void;
  /** Map factory. Defaults to the MapLibre adapter (its own lazy chunk); tests pass a fake. */
  createMap?: CreateMap;
}

const LOOKUP_DELAY_MS = 350;

/** Real lookup: a 404 means "nothing known here", not a failure. */
async function lookupPlace(point: LatLng, signal: AbortSignal): Promise<Place | null> {
  try {
    return await reversePlace(point, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

type Phase = 'loading' | 'ready' | 'unavailable';
type Lk = LookupState<Place | null> | { status: 'waiting' };

const loadMapLibre: CreateMap = async (host, options, events) =>
  (await import('./maplibreAdapter')).createMapLibre(host, options, events);

/**
 * Full-screen "choose on map": a fixed centre pin while the map moves under it, a live address card from the reverse
 * lookup, Confirm / Cancel. A native modal dialog (focus trap, Esc, focus returns to the opener). Rendered only while
 * open; lazy-loaded by PlacePickerSheet so MapLibre never reaches the entry chunk.
 */
export default function MapPicker({
  kind,
  initial,
  onPick,
  onClose,
  createMap = loadMapLibre,
}: MapPickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const lookup = useRef<Lookup | null>(null);
  const titleId = useId();
  const regionId = useId();

  const [phase, setPhase] = useState<Phase>('loading');
  const [moving, setMoving] = useState(false);
  const [outside, setOutside] = useState(false);
  const [lk, setLk] = useState<Lk>({ status: 'idle' });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const text: LabelText = useMemo(
    () => ({
      near: (name) => t('mapPick.near', { name }),
      inArea: (area) => t('mapPick.inArea', { area }),
      pinned: t('mapPick.pinned'),
    }),
    [],
  );

  // The native dialog: open on mount, forward Esc / close to the parent.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      // The dialog is already out of the DOM here, so the browser cannot return focus by itself.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Lookup controller (debounced, abortable).
  useEffect(() => {
    const l = createLookup<Place | null>({
      delayMs: LOOKUP_DELAY_MS,
      fetch: lookupPlace,
      onState: setLk,
    });
    lookup.current = l;
    return () => {
      l.cancel();
      lookup.current = null;
    };
  }, []);

  // The map itself.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let mine: MapHandle | null = null;
    const settle = (c: LatLng) => {
      const inside = inCoverage(c);
      setOutside(!inside);
      setMoving(false);
      if (inside) {
        setLk({ status: 'waiting' });
        lookup.current?.schedule(roundPoint(c));
      } else {
        lookup.current?.cancel();
        setLk({ status: 'idle' });
      }
    };
    createMap(
      el,
      { centre: initial ?? DEFAULT_CENTRE, zoom: initial ? CHOSEN_ZOOM : DEFAULT_ZOOM },
      {
        onMoveStart: () => {
          lookup.current?.cancel();
          setMoving(true);
          setLk({ status: 'idle' });
        },
        onMove: (c) => setOutside(!inCoverage(c)),
        onMoveEnd: settle,
        onReady: () => {
          if (cancelled) return;
          setPhase('ready');
          settle(mine ? mine.getCenter() : (initial ?? DEFAULT_CENTRE));
        },
      },
    ).then(
      (h) => {
        if (cancelled) {
          h.destroy();
          return;
        }
        mine = h;
        handle.current = h;
      },
      () => {
        if (!cancelled) setPhase('unavailable');
      },
    );
    return () => {
      cancelled = true;
      lookup.current?.cancel();
      mine?.destroy();
      handle.current = null;
    };
    // `initial` is read once per attempt: moving the field's value later must not rebuild the map.
  }, [attempt, createMap]);

  const centre = lk.status === 'done' || lk.status === 'failed' ? lk.point : null;
  const found = lk.status === 'done' ? lk.value : null;
  const label = centre ? pinLabel(centre, found, text) : '';
  const canConfirm =
    !outside && !moving && centre !== null && (lk.status === 'done' || lk.status === 'failed');

  const confirm = useCallback(() => {
    if (!centre) return;
    onPick(pinPlace(centre, lk.status === 'done' ? lk.value : null, text));
  }, [centre, lk, onPick, text]);

  const retry = () => {
    const h = handle.current;
    if (!h) return;
    const c = h.getCenter();
    setLk({ status: 'waiting' });
    lookup.current?.schedule(roundPoint(c));
  };

  async function locateMe() {
    setLocError(null);
    setLocating(true);
    try {
      const p = await getCurrentPoint();
      if (!inCoverage(p)) {
        setLocError(t('place.outside'));
      } else {
        handle.current?.jumpTo(p, CHOSEN_ZOOM);
      }
    } catch (err) {
      setLocError(
        err instanceof GeolocationFailure && err.reason === 'denied'
          ? t('place.permissionDenied')
          : t('error.generic'),
      );
    } finally {
      setLocating(false);
    }
  }

  const tone = outside ? 'outside' : 'ok';

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-bg p-0 text-text open:flex open:flex-col"
    >
      <header className="flex flex-none items-center gap-2 py-1 pr-2 pl-5">
        <h2 id={titleId} className="type-h2 flex-1">
          {t(kind === 'from' ? 'mapPick.title.from' : 'mapPick.title.to')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="grid size-12 flex-none place-items-center rounded-full hover:bg-surface-subtle"
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-map-bg" data-no-swipe>
        {phase !== 'unavailable' && (
          <div
            ref={host}
            role="region"
            aria-label={t('mapPick.region')}
            id={regionId}
            className="size-full"
          />
        )}

        {phase === 'ready' && (
          <>
            {/* The pin: its tip is the exact centre of the map. Grey when outside the area. */}
            <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 z-10">
              <svg
                data-testid="map-pin"
                data-state={tone}
                viewBox="0 0 36 48"
                width="36"
                height="48"
                className={[
                  'absolute top-0 left-0 drop-shadow-lg transition-transform duration-200 motion-reduce:transition-none',
                  outside ? 'text-text-subtle' : 'text-action',
                ].join(' ')}
                style={{ transform: `translate(-50%, calc(-100% - ${moving ? 8 : 0}px))` }}
              >
                <path
                  d="M18 46 C18 46 3 29 3 18 a15 15 0 0 1 30 0 C33 29 18 46 18 46Z"
                  fill="currentColor"
                  style={{ stroke: 'var(--theme-bg)', strokeWidth: 2.5 }}
                />
                <circle cx="18" cy="18" r="5.5" style={{ fill: 'var(--theme-bg)' }} />
              </svg>
              <span
                className={[
                  'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg',
                  outside ? 'bg-text-subtle' : 'bg-action',
                ].join(' ')}
              />
            </div>

            <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handle.current?.zoomBy(1, !reducedMotion())}
                aria-label={t('mapPick.zoomIn')}
                className="glass grid size-11 place-items-center rounded-full text-xl font-semibold"
              >
                <span aria-hidden="true">+</span>
              </button>
              <button
                type="button"
                onClick={() => handle.current?.zoomBy(-1, !reducedMotion())}
                aria-label={t('mapPick.zoomOut')}
                className="glass grid size-11 place-items-center rounded-full text-xl font-semibold"
              >
                <span aria-hidden="true">−</span>
              </button>
            </div>

            <a
              className="map-attribution glass"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('map.attribution')}
            </a>
          </>
        )}

        {phase === 'loading' && (
          <div role="status" className="absolute inset-0 grid place-items-center">
            <MiniLoader label={t('mapPick.loading')} />
          </div>
        )}

        {phase === 'unavailable' && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="flex max-w-sm flex-col items-start gap-3">
              <Notice tone="error">{t('mapPick.unavailable')}</Notice>
              <Button variant="primary" icon={<Icon name="search" />} onClick={onClose}>
                {t('mapPick.search')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => (setPhase('loading'), setAttempt((a) => a + 1))}
              >
                {t('common.retry')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {phase !== 'unavailable' && (
        <section
          aria-label={t('mapPick.pin')}
          className="flex flex-none flex-col gap-3 border-t border-border bg-surface px-5 pt-4 pb-5"
        >
          <div className="flex min-h-14 items-start gap-3">
            <Icon name={outside ? 'alert' : 'pin'} className="mt-0.5 text-link" />
            <div role="status" aria-live="polite" className="min-w-0 flex-1">
              {outside ? (
                <>
                  <p className="font-semibold">{t('mapPick.outside')}</p>
                  <p className="text-sm leading-5 text-text-muted">{t('mapPick.outside.hint')}</p>
                </>
              ) : moving ? (
                <p className="font-semibold text-text-muted">{t('mapPick.moving')}</p>
              ) : lk.status === 'done' ? (
                <>
                  <p className="font-semibold break-words" data-testid="map-label">
                    {label}
                  </p>
                  {found?.secondary && (
                    <p className="text-sm leading-5 text-text-muted">{found.secondary}</p>
                  )}
                </>
              ) : lk.status === 'failed' ? (
                <>
                  <p className="font-semibold">{t('mapPick.failed')}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="mt-1 min-h-11 text-sm font-semibold text-link underline"
                  >
                    {t('common.retry')}
                  </button>
                </>
              ) : (
                <p className="font-semibold text-text-muted">
                  {phase === 'ready' ? t('mapPick.finding') : t('mapPick.loading')}
                </p>
              )}
            </div>
          </div>

          {locError && <Notice tone="error">{locError}</Notice>}
          <p className="text-sm leading-5 text-text-muted">{t('mapPick.privacy')}</p>

          <div className="flex flex-col gap-2">
            <Button variant="primary" block disabled={!canConfirm} onClick={confirm}>
              {lk.status === 'failed' ? t('mapPick.useAnyway') : t('mapPick.confirm')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="tonal"
                loading={locating}
                disabled={phase !== 'ready'}
                icon={<Icon name="locate" />}
                onClick={() => void locateMe()}
              >
                {t('mapPick.myLocation')}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                {t('mapPick.cancel')}
              </Button>
            </div>
          </div>
        </section>
      )}
    </dialog>
  );
}
