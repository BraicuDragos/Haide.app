import type { AdminMetricsResponse } from '../../_shared/contracts/admin.ts';
import {
  addDays,
  buildMetrics,
  formatIsoWeek,
  resolveWeek,
  weekBounds,
} from '../../_shared/domain/metrics.ts';
import {
  HIGH_VOLUME_COMPLETED_7D,
  METRICS_SERIES_WEEKS,
  RELIABILITY_WINDOW_DAYS,
} from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import { selectAdminUsers } from '../repo/admin.ts';
import {
  selectCorridorCounts,
  selectHighVolumeDrivers,
  selectSeatsSeries,
  selectWeekCounts,
} from '../repo/metrics.ts';
import { toAdminUserRef } from '../serializers/admin.ts';
import type { Deps } from '../types.ts';

const DAY_MS = 86_400_000;

/**
 * GET /admin/metrics (E7-2, ADR 0034). The database returns counts for one ISO week; the pure module
 * turns them into rates and statuses. `week` defaults to the current week and must lie between
 * 2026-W46 and the current week, else `400 fields.week`. `partial` is true while the week runs.
 */
export async function getMetrics(
  deps: Deps,
  rawWeek: string | undefined,
): Promise<AdminMetricsResponse> {
  const now = deps.clock.now();
  const resolved = resolveWeek(rawWeek, now);
  if (!resolved.ok) {
    throw new AppError('VALIDATION_FAILED', 'Pick a week from the launch up to this week.', {
      fields: { week: resolved.reason },
    });
  }
  const { monday, week } = resolved;
  const { from, to } = weekBounds(monday);

  const counts = await selectWeekCounts(deps.sql, monday, now);
  const corridors = await selectCorridorCounts(deps.sql, monday);
  const series = await selectSeatsSeries(deps.sql, monday, METRICS_SERIES_WEEKS);
  // The 7 days that end now, or at the end of a past week.
  const until = now.getTime() < to.getTime() ? now : to;
  const drivers = await selectHighVolumeDrivers(deps.sql, until, HIGH_VOLUME_COMPLETED_7D);

  const people = new Map<string, Awaited<ReturnType<typeof selectAdminUsers>>[number]>();
  if (drivers.length > 0) {
    const since = new Date(now.getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
    for (const u of await selectAdminUsers(
      deps.sql,
      drivers.map((d) => d.driver_id),
      since,
    )) {
      people.set(u.id, u);
    }
  }

  return {
    week,
    from: from.toISOString(),
    to: to.toISOString(),
    partial: now.getTime() < to.getTime(),
    ...buildMetrics(counts, corridors, formatIsoWeek(addDays(monday, -28))),
    series: series.map((s) => ({
      week: formatIsoWeek(s.week),
      completedSeats: s.completed_seats,
    })),
    flags: {
      highVolumeDrivers: drivers.flatMap((d) => {
        const u = people.get(d.driver_id);
        return u ? [{ user: toAdminUserRef(u, deps.env), completed7d: d.completed }] : [];
      }),
    },
  };
}
