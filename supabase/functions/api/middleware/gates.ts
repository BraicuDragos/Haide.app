import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '../../_shared/errors.ts';
import { isProfileComplete } from '../../_shared/domain/account.ts';
import { loadAccount } from '../repo/accounts.ts';
import type { Account, AppBindings } from '../types.ts';

/**
 * Server-side gates (architecture §8), in this order:
 * UNAUTHENTICATED 401 -> ACCOUNT_SUSPENDED / ACCOUNT_DELETED 403 -> CONSENT_REQUIRED 403 ->
 * PROFILE_INCOMPLETE 403 -> VEHICLE_REQUIRED 403 -> resource authorization (404, never 403).
 * Each `requireX` runs every earlier gate first, so a route lists only the strictest one.
 * `requireAuth` (401) lives in auth.ts.
 */

/** The caller's account, loaded at most once per request. Throws 401 when anonymous. */
export async function accountOf(c: Context<AppBindings>): Promise<Account> {
  const cached = c.get('account');
  if (cached) return cached;
  const auth = c.get('auth');
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  const deps = c.get('deps');
  const account = await loadAccount(deps.sql, auth.userId, auth.email, deps.clock.now());
  c.set('account', account);
  return account;
}

type Level = 'active' | 'consent' | 'profile' | 'vehicle';
const ORDER: Level[] = ['active', 'consent', 'profile', 'vehicle'];

function check(level: Level, a: Account): void {
  switch (level) {
    case 'active':
      if (a.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'Account suspended.');
      if (a.status === 'deleted') throw new AppError('ACCOUNT_DELETED', 'Account deleted.');
      return;
    case 'consent':
      if (a.consentRequired.length > 0) {
        throw new AppError('CONSENT_REQUIRED', 'Accept the current terms to continue.', {
          fields: Object.fromEntries(a.consentRequired.map((k) => [k, 'required'])),
        });
      }
      return;
    case 'profile':
      if (!isProfileComplete(a)) {
        throw new AppError('PROFILE_INCOMPLETE', 'Complete your profile to continue.');
      }
      return;
    case 'vehicle':
      if (!a.hasVehicle) throw new AppError('VEHICLE_REQUIRED', 'Add your vehicle to continue.');
      return;
  }
}

function gateUpTo(level: Level): MiddlewareHandler<AppBindings> {
  const levels = ORDER.slice(0, ORDER.indexOf(level) + 1);
  return async (c, next) => {
    const account = await accountOf(c);
    for (const l of levels) check(l, account);
    await next();
  };
}

export const requireActive = gateUpTo('active');
export const requireConsent = gateUpTo('consent');
export const requireProfile = gateUpTo('profile');
export const requireVehicle = gateUpTo('vehicle');

/** Active account with role `admin`; everyone else gets FORBIDDEN. */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const account = await accountOf(c);
  check('active', account);
  if (account.role !== 'admin') throw new AppError('FORBIDDEN', 'Admins only.');
  await next();
};

/**
 * E6: an authenticated caller whose account exists, whatever its status or consent. For the routes
 * that must keep working when the account is suspended or has not accepted the new terms
 * (`DELETE /me`). A deleted account is a no-op for them, not an error.
 */
export const requireAccount: MiddlewareHandler<AppBindings> = async (c, next) => {
  await accountOf(c);
  await next();
};

/** Suspended is fine, deleted is `ACCOUNT_DELETED` (`POST /me/data-export-request`). */
export const requireNotDeleted: MiddlewareHandler<AppBindings> = async (c, next) => {
  const account = await accountOf(c);
  if (account.status === 'deleted') throw new AppError('ACCOUNT_DELETED', 'Account deleted.');
  await next();
};
