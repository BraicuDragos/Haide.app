import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Browser chrome colours come from the tokens file (theme roles: bg), never typed here.
const tokens = JSON.parse(readFileSync(r('../../docs/brand/design-tokens.json'), 'utf8')) as {
  theme: { dark: { bg: string }; light: { bg: string } };
};
const THEME_DARK = tokens.theme.dark.bg;
const THEME_LIGHT = tokens.theme.light.bg;

/** Fills the %THEME_*% placeholders in index.html (theme-color meta tags) from the tokens. */
function themeColour(): Plugin {
  return {
    name: 'theme-colour',
    transformIndexHtml: (html) =>
      html.replaceAll('%THEME_DARK%', THEME_DARK).replaceAll('%THEME_LIGHT%', THEME_LIGHT),
  };
}

/** `vite preview` has no Cloudflare Pages: apply the `/*` block of public/_headers so CSP is exercised locally and in e2e. */
function pagesHeaders(): Plugin {
  const apply = (server: {
    middlewares: {
      use: (fn: (req: unknown, res: ServerResponse, next: () => void) => void) => void;
    };
  }) => {
    const block: Array<[string, string]> = [];
    let inAll = false;
    for (const line of readFileSync(r('./public/_headers'), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('#') || line.trim() === '') continue;
      if (!line.startsWith(' ')) {
        inAll = line.trim() === '/*';
        continue;
      }
      const i = line.indexOf(':');
      if (inAll && i > 0) block.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
    server.middlewares.use((_req, res, next) => {
      // Preview only: allow the local Supabase API (production CSP only lists the project host).
      for (const [k, v] of block) {
        res.setHeader(
          k,
          k === 'Content-Security-Policy'
            ? v
                .replace(
                  "connect-src 'self'",
                  "connect-src 'self' http://127.0.0.1:54321 http://localhost:54321",
                )
                // Avatars come from the local Storage API (public bucket).
                .replace(
                  "img-src 'self'",
                  "img-src 'self' http://127.0.0.1:54321 http://localhost:54321",
                )
            : v,
        );
      }
      next();
    });
  };
  return { name: 'pages-headers', configurePreviewServer: apply };
}

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      '@contracts': r('../../supabase/functions/_shared/contracts'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The map chunk is lazy and large by nature (MapLibre). The 200 KB gzip budget applies to the entry chunks.
    chunkSizeWarningLimit: 1100,
  },
  plugins: [
    react(),
    pagesHeaders(),
    themeColour(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Haide',
        short_name: 'Haide',
        description: 'The neighbourly way across Sibiu.',
        lang: 'en',
        start_url: '/find',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_DARK,
        background_color: THEME_DARK,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,webmanifest}'],
        // The map chunk and the heavy tile assets are runtime-cached by sw.ts, not precached.
        globIgnores: ['**/maplibre*', '**/RouteMap*', 'tiles/**', 'glyphs/**', 'sprites/**'],
      },
      devOptions: { enabled: false },
    }),
  ],
});
