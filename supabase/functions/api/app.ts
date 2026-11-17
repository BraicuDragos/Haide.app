import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.ts';
import { requestBodyLimit } from './middleware/bodyLimit.ts';
import { corsMiddleware } from './middleware/cors.ts';
import { onError, onNotFound } from './middleware/errors.ts';
import { requestLogging } from './middleware/logging.ts';
import { adminRoutes } from './routes/admin.ts';
import { accountRoutes } from './routes/account.ts';
import { bookingRoutes } from './routes/bookings.ts';
import { placesRoutes } from './routes/places.ts';
import { privacyRoutes } from './routes/privacy.ts';
import { rideRoutes } from './routes/rides.ts';
import { safetyRoutes } from './routes/safety.ts';
import { searchRoutes } from './routes/search.ts';
import { shareRoutes } from './routes/share.ts';
import { systemRoutes } from './routes/system.ts';
import type { AppBindings, Deps } from './types.ts';

/** Supabase mounts the function at /<name>: the function sees /api/v1/... */
export const BASE_PATH = '/api/v1';

/** Builds the Hono app. Pure wiring: all I/O comes through `deps` so tests can inject fakes. */
export function createApp(deps: Deps) {
  const app = new Hono<AppBindings>().basePath(BASE_PATH);

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requestLogging);
  app.use('*', corsMiddleware);
  app.use('*', requestBodyLimit);
  app.use('*', authMiddleware);

  app.route('/', systemRoutes);
  app.route('/', placesRoutes);
  app.route('/', accountRoutes);
  app.route('/', rideRoutes);
  app.route('/', searchRoutes);
  app.route('/', bookingRoutes);
  app.route('/', safetyRoutes);
  app.route('/', shareRoutes);
  app.route('/', privacyRoutes);
  app.route('/', adminRoutes);

  app.onError(onError);
  app.notFound(onNotFound);
  return app;
}

export type App = ReturnType<typeof createApp>;
