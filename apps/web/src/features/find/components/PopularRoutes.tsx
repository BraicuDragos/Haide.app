import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { keys } from '@/api/keys';
import { getPopularRoutes } from '@/api/popular';
import type { PopularRoute } from '@/api/types';
import { t, tp } from '@/i18n';
import { bucharestToday, dayOptions } from '@/lib/dates';
import { minTimeFor } from '@/lib/timeSlots';
import { ms, reduced as reducedMotion } from '@/motion/core';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { saveSearch, type SearchCriteria } from '../searchState';
import { RouteLaunch } from './RouteLaunch';

/**
 * Search criteria for one tap on a popular route: today, the next free 5 minute slot (Europe/Bucharest), plus or minus
 * one hour. Late in the evening no slot is left today, so the search moves to tomorrow morning. The places are used
 * exactly as the API returned them (gazetteer places, area level).
 */
export function criteriaFor(route: PopularRoute, now: Date = new Date()): SearchCriteria {
  const today = bucharestToday(now);
  const slot = minTimeFor(today, 0, undefined, now);
  const base = { from: route.from, to: route.to, win: '60' } as const;
  if (slot === undefined || slot === '24:00') {
    const tomorrow = dayOptions(2, now)[1]?.value ?? today;
    return { ...base, day: tomorrow, time: '07:00' };
  }
  return { ...base, day: today, time: slot };
}

/** "Popular routes" on the Find screen (E10-4). Public: works signed out. A tap opens the results. */
export function PopularRoutes() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: keys.popularRoutes,
    queryFn: ({ signal }) => getPopularRoutes(signal),
    staleTime: 5 * 60_000,
  });
  const items = q.data?.items ?? [];
  const [launch, setLaunch] = useState<{ key: string; w: number; h: number; said: string } | null>(
    null,
  );
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /**
   * Saves the search and opens the results after a short signature moment on the tapped card (about `reveal`, the
   * results open while the light arrives). With reduced motion: the card is just highlighted for `fast`. Taps while
   * launching are ignored, so there is never a double navigation.
   */
  function open(route: PopularRoute, key: string, said: string, card: HTMLElement) {
    if (busy.current) return;
    busy.current = true;
    const calm = reducedMotion();
    setLaunch({ key, w: calm ? 0 : card.offsetWidth, h: calm ? 0 : card.offsetHeight, said });
    timer.current = window.setTimeout(
      () => {
        saveSearch(criteriaFor(route));
        void navigate('/results');
      },
      ms(calm ? 'fast' : 'reveal'),
    );
  }

  return (
    <section
      aria-labelledby="popular-h"
      aria-busy={q.isPending || undefined}
      className="flex flex-col gap-3 px-4 pb-6"
    >
      <h2 id="popular-h" className="type-h3">
        {t('find.corridors')}
      </h2>
      <p aria-live="polite" className="sr-only">
        {launch?.said}
      </p>
      {q.isPending && <Loader label={t('find.popular.loading')} />}
      {q.isError && (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="error">{t('find.popular.err')}</Notice>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {q.isSuccess && items.length === 0 && (
        <p className="text-text-muted">{t('find.popular.empty')}</p>
      )}
      {q.isSuccess && items.length > 0 && (
        <ul
          className="pr-list m-0 flex list-none flex-col gap-2 p-0"
          data-launching={launch ? '' : undefined}
        >
          {items.map((r) => {
            const name = t('find.popular.route', { from: r.from.name, to: r.to.name });
            const key = `${r.from.id}:${r.to.id}`;
            const picked = launch?.key === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={(e) =>
                    open(
                      r,
                      key,
                      t('find.popular.searching', { from: r.from.name, to: r.to.name }),
                      e.currentTarget,
                    )
                  }
                  className={`card pr-card flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left font-semibold${picked ? ' is-picked' : ''}`}
                >
                  <Icon name="route" className="text-outline" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{name}</span>
                    {r.source === 'data' && r.rides > 0 && (
                      <span className="block text-sm leading-5 font-normal text-text-muted">
                        {tp('find.popular.rides', r.rides)}
                      </span>
                    )}
                  </span>
                  {picked && launch.w > 0 && <RouteLaunch w={launch.w} h={launch.h} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
