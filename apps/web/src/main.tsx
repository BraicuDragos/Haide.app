import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { reportError } from '@/api/telemetry';
import { Providers } from '@/app/providers';
import { router } from '@/app/router';
import './styles/globals.css';

// Uncaught errors outside React (event handlers, promises) also go to /telemetry/error.
window.addEventListener('error', (e) => reportError(e.error ?? e.message, '/:window'));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, '/:window'));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Registered after load so it never competes with the first paint. Update prompt UI arrives with E1.
  window.addEventListener('load', () => {
    void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  });
}
