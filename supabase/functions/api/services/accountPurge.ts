import { nextPurgeAttemptAt } from '../../_shared/domain/privacy.ts';
import { PURGE_BATCH } from '../../_shared/domain/rules.ts';
import { scrubText } from '../../_shared/scrub.ts';
import {
  markAuthDone,
  markStorageDone,
  recordPurgeFailure,
  selectDeletion,
  selectDueDeletions,
} from '../repo/privacy.ts';
import type { Deps } from '../types.ts';

/**
 * The part of an account deletion that happens after the database transaction (E6, ADR 0029): remove
 * the avatar object from Storage and the auth user from Supabase Auth. Each side is its own step with
 * its own `*_done_at`; the step that finishes the second side sets `completed_at` in the same UPDATE
 * (the table check forbids both sides done with completed_at null). A failed step records the error
 * (scrubbed, 200 characters) and the next attempt: 1 min, 5 min, 30 min, 2 h, 12 h, then daily.
 * A step that already succeeded is not repeated. Never throws for an outside failure.
 */

const ERROR_MAX = 200;

/** A reason that is safe to log: an HTTP status when the message ends in one, else the error class. */
function safeReason(e: unknown): string {
  const status = e instanceof Error ? /:\s(\d{3})$/.exec(e.message)?.[1] : undefined;
  if (status) return `http_${status}`;
  return e instanceof Error && /^\w{1,40}$/.test(e.name) ? e.name : 'unknown';
}

type PurgeDeps = Pick<Deps, 'sql' | 'storage' | 'authAdmin' | 'clock' | 'log'>;

/** Runs the open steps of one deletion. Returns true when the deletion is now complete. */
export async function purgeAccount(deps: PurgeDeps, userId: string): Promise<boolean> {
  const { sql, storage, authAdmin, clock, log } = deps;
  const row = await selectDeletion(sql, userId);
  if (!row) return false; // unknown or already completed

  const failures: string[] = [];
  const steps: string[] = [];
  const reasons: string[] = [];
  let completed = false; // set by the mark* statement that closes the row

  if (!row.storage_done_at) {
    try {
      if (row.photo_path) await storage.removeStrict(row.photo_path);
      completed = (await markStorageDone(sql, userId, clock.now())) || completed;
    } catch (e) {
      failures.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
      steps.push('storage');
      reasons.push(safeReason(e));
    }
  }

  if (!row.auth_done_at) {
    try {
      await authAdmin.deleteUser(userId);
      completed = (await markAuthDone(sql, userId, clock.now())) || completed;
    } catch (e) {
      failures.push(`auth: ${e instanceof Error ? e.message : String(e)}`);
      steps.push('auth');
      reasons.push(safeReason(e));
    }
  }

  if (failures.length > 0) {
    const now = clock.now();
    // attempts is the count before this failure; the delay follows the new total.
    await recordPurgeFailure(
      sql,
      userId,
      nextPurgeAttemptAt(now, row.attempts + 1),
      scrubText(failures.join('; '), ERROR_MAX),
    );
    log('warn', 'account_purge_step_failed', {
      attempts: row.attempts + 1,
      steps: steps.join(','),
      reasons: reasons.join(','),
    });
    return false;
  }
  return completed;
}

/** Tick step 7: the due deletions, at most PURGE_BATCH per tick. Returns how many were completed. */
export async function runAccountPurges(deps: PurgeDeps): Promise<number> {
  const due = await selectDueDeletions(deps.sql, deps.clock.now(), PURGE_BATCH);
  let completed = 0;
  for (const { user_id } of due) {
    if (await purgeAccount(deps, user_id)) completed++;
  }
  return completed;
}
