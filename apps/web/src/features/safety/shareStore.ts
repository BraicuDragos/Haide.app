/**
 * The share link is shown once by the server (only its hash is stored there). The person who created it keeps the
 * URL on this device until it expires, so they can copy it again. Keys: `haide.share.<bookingId>`. localStorage may
 * throw or be empty (private mode): every access is guarded and the sheet works without it.
 */
const PREFIX = 'haide.share.';

export interface StoredShare {
  url: string;
  expiresAt: string;
}

export function readShare(bookingId: string, now: number = Date.now()): StoredShare | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + bookingId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredShare>;
    if (typeof v.url !== 'string' || typeof v.expiresAt !== 'string') return null;
    if (Date.parse(v.expiresAt) <= now) {
      window.localStorage.removeItem(PREFIX + bookingId);
      return null;
    }
    return { url: v.url, expiresAt: v.expiresAt };
  } catch {
    return null;
  }
}

export function saveShare(bookingId: string, share: StoredShare): void {
  try {
    window.localStorage.setItem(PREFIX + bookingId, JSON.stringify(share));
  } catch {
    /* not stored: the link is still on screen for this visit */
  }
}

export function clearShare(bookingId: string): void {
  try {
    window.localStorage.removeItem(PREFIX + bookingId);
  } catch {
    /* ignore */
  }
}

/** Sign-out: links belong to the person who made them. */
export function clearAllShares(): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) drop.push(k);
    }
    drop.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
