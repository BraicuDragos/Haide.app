import { useCallback } from 'react';
import { useNavigate } from 'react-router';

/** Back button target: one step back inside the app, or `fallback` when this screen was opened directly. */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
