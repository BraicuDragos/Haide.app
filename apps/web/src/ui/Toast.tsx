import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@/i18n';

interface ToastApi {
  show: (message: string) => void;
}
const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

const DURATION_MS = 5000; // accessibility.md 2.2.1: toasts last 5 s

/**
 * One polite live region stays in the DOM at all times (so screen readers register it) and toasts render inside it.
 * Keep messages at 70 characters or fewer (copy.md section 3): same verb as the button, past tense.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMsg({ id: ++seq.current, text });
    timer.current = window.setTimeout(() => setMsg(null), DURATION_MS);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
      >
        <span className="sr-only">{t('a11y.toasts')}</span>
        {msg && (
          <p
            key={msg.id}
            className="toast pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm font-semibold text-text"
          >
            {msg.text}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
