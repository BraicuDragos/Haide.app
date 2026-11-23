import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { t } from '@/i18n';
import { cropToBlob, PhotoError, type PhotoProblem } from '@/lib/image';
import { useSize } from '@/lib/useSize';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  cropRect,
  initialState,
  panBy,
  zoomTo,
  type CropState,
} from './cropMath';

interface Props {
  /** The decoded photo; the dialog is open while this is set. */
  bitmap: ImageBitmap | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  onError: (problem: PhotoProblem) => void;
}

const ZOOM_STEP = 0.25;
const KEY_PAN_PX = 16;

/**
 * Square photo cropper in the Sheet. A hand-written canvas component instead of a library (react-easy-crop and the
 * like add roughly 10 to 30 KB gzip plus their own CSS for one dialog; this adds about 2 KB and lives in the lazy
 * profile chunk). Touch and mouse go through pointer events (one pointer drags, two pinch); keyboard users get arrow
 * keys to move and + / - to zoom; the slider and the two buttons cover everything else. No licence to track.
 * The round mask only previews how Avatar will crop it: the uploaded file is the full square.
 */
export function PhotoCropper({ bitmap, onCancel, onConfirm, onError }: Props) {
  return (
    <Sheet open={bitmap !== null} title={t('profile.crop.title')} onClose={onCancel}>
      {bitmap && (
        <Stage bitmap={bitmap} onCancel={onCancel} onConfirm={onConfirm} onError={onError} />
      )}
    </Sheet>
  );
}

function Stage({
  bitmap,
  onCancel,
  onConfirm,
  onError,
}: Omit<Props, 'bitmap'> & { bitmap: ImageBitmap }) {
  const iw = bitmap.width;
  const ih = bitmap.height;
  const [state, setState] = useState<CropState>(() => initialState(iw, ih));
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { w: view } = useSize(box);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !view) return;
    const px = Math.round(view * Math.min(window.devicePixelRatio || 1, 2));
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    const r = cropRect(state, iw, ih);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, r.sx, r.sy, r.side, r.side, 0, 0, px, px);
  }, [state, view, bitmap, iw, ih]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function down(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: dist(), zoom: state.zoom };
  }
  function move(e: ReactPointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current && pinch.current.dist > 0) {
      // Read the ref now: `up()` may clear it before React runs the updater.
      const z = pinch.current.zoom * (dist() / pinch.current.dist);
      setState((s) => zoomTo(s, z, iw, ih));
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setState((s) => panBy(s, dx, dy, view, iw, ih));
    }
  }
  function up(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }

  function key(e: KeyboardEvent) {
    const v = view || 1;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_PX, 0],
      ArrowRight: [-KEY_PAN_PX, 0],
      ArrowUp: [0, KEY_PAN_PX],
      ArrowDown: [0, -KEY_PAN_PX],
    };
    const d = pan[e.key];
    if (d) setState((s) => panBy(s, d[0], d[1], v, iw, ih));
    else if (e.key === '+' || e.key === '=') setState((s) => zoomTo(s, s.zoom + ZOOM_STEP, iw, ih));
    else if (e.key === '-') setState((s) => zoomTo(s, s.zoom - ZOOM_STEP, iw, ih));
    else return;
    e.preventDefault();
  }

  // False once the dialog is gone (Esc or backdrop while cropping): a late result must not apply, and the
  // bitmap closed by the parent must not surface as a false "couldn't read photo" error.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function confirm() {
    setBusy(true);
    try {
      const blob = await cropToBlob(bitmap, cropRect(state, iw, ih));
      if (alive.current) onConfirm(blob);
    } catch (err) {
      if (!alive.current) return;
      setBusy(false);
      onError(err instanceof PhotoError ? err.problem : 'invalid');
    }
  }

  const zoom = (z: number) => setState((s) => zoomTo(s, z, iw, ih));

  return (
    <>
      <p className="text-sm leading-5 text-text-muted">{t('profile.crop.hint')}</p>
      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-label={t('profile.crop.area')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        data-testid="crop-area"
        className="relative mx-auto aspect-square w-full max-w-80 cursor-grab touch-none overflow-hidden rounded-(--tk-radius-md) bg-bg-deep select-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--theme-focus-ring) active:cursor-grabbing"
      >
        <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden="true" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_var(--theme-scrim)] outline-2 -outline-offset-2 outline-outline"
        />
      </div>
      <div className="mx-auto flex w-full max-w-80 items-center gap-2">
        <button
          type="button"
          aria-label={t('profile.crop.zoomOut')}
          disabled={state.zoom <= MIN_ZOOM}
          onClick={() => zoom(state.zoom - ZOOM_STEP)}
          className="chip size-12 justify-center px-0 text-xl disabled:opacity-40"
        >
          <span aria-hidden="true">−</span>
        </button>
        <input
          type="range"
          aria-label={t('profile.crop.zoom')}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={clampZoom(state.zoom)}
          onChange={(e) => zoom(Number(e.target.value))}
          className="h-12 min-w-0 flex-1 accent-(--theme-outline)"
        />
        <button
          type="button"
          aria-label={t('profile.crop.zoomIn')}
          disabled={state.zoom >= MAX_ZOOM}
          onClick={() => zoom(state.zoom + ZOOM_STEP)}
          className="chip size-12 justify-center px-0 text-xl disabled:opacity-40"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('profile.crop.cancel')}
        </Button>
        <Button onClick={() => void confirm()} loading={busy}>
          {t('profile.crop.confirm')}
        </Button>
      </div>
    </>
  );
}
