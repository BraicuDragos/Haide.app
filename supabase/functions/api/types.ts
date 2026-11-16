import type { ConsentRequired } from '../_shared/contracts/account.ts';
import type { Clock } from '../_shared/domain/clock.ts';
import type { Db } from '../_shared/db.ts';
import type { Env } from '../_shared/env.ts';
import type { Logger } from '../_shared/log.ts';
import type { RoutingProvider } from '../_shared/providers/routing/types.ts';

export type AuthInfo = { userId: string; email: string | null } | null;

/** Verifies a Supabase access token. Throws when invalid. */
export type TokenVerifier = (token: string) => Promise<{ userId: string; email: string | null }>;

/** Avatar object storage (Supabase Storage, written with the secret key). Paths: `avatars/<uuid>.jpg`. */
export type AvatarStorage = {
  upload(path: string, jpeg: Uint8Array): Promise<void>;
  /** Best effort: never throws. */
  remove(path: string): Promise<void>;
};

/** Decodes an upload and re-encodes it as a metadata-free square JPEG. Throws PHOTO_INVALID. */
export type AvatarEncoder = (input: Uint8Array) => Promise<Uint8Array>;

/** Everything the app needs from the outside world, injected so tests need no network. */
export type Deps = {
  env: Env;
  sql: Db;
  clock: Clock;
  log: Logger;
  verifyToken: TokenVerifier;
  storage: AvatarStorage;
  encodeAvatar: AvatarEncoder;
  /** Car routing (openrouteservice, or the fixture provider in dev and CI). */
  routing: RoutingProvider;
};

/** The caller's account, loaded once per request by the gates. */
export type Account = {
  id: string;
  email: string | null;
  firstName: string | null;
  phoneE164: string | null;
  bio: string | null;
  photoPath: string | null;
  status: 'active' | 'suspended' | 'deleted';
  role: 'user' | 'admin';
  createdAt: Date;
  hasVehicle: boolean;
  consentRequired: ConsentRequired[];
};

export type AppBindings = {
  Variables: {
    deps: Deps;
    reqId: string;
    auth: AuthInfo;
    account: Account;
  };
};
