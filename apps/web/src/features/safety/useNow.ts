import { useEffect, useState } from 'react';

/**
 * The current time as a number, refreshed every `intervalMs`. The timer pauses while the tab is hidden and the value
 * catches up the moment it is visible again (a window boundary must not lag behind a sleeping tab). Used to switch
 * the Call 112 button on and off at the server's window edges without a refetch.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      window.clearInterval(id);
      id = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(id);
        id = undefined;
      } else {
        setNow(Date.now());
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
  return now;
}
