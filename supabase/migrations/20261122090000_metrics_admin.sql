-- E7 metrics and admin (docs/architecture/e7-metrics-admin-spec.md section 1, ADRs 0032 to 0035).
-- Forward-only. No new tables. Adds the analytics props guard (a CHECK on app.analytics_events), the
-- extended admin_actions action list, four indexes, and eight functions:
--   app.event_props_ok          IMMUTABLE guard used by the CHECK
--   app.admin_suspend_user      re-created with a reason code (the 4-argument E5 version is dropped)
--   app.admin_dismiss_report    audited dismissal of an open report
--   app.outbox_recipients       new 2-argument overload that can include suspended users
--   app.metrics_week            counts for one ISO week (Europe/Bucharest), STABLE
--   app.metrics_match_by_corridor, app.metrics_seats_series, app.metrics_high_volume_drivers   STABLE
--   app.admin_cron_runs         last run per pg_cron job (SECURITY DEFINER, haide_api only)
-- Every function pins its search_path and has EXECUTE revoked from PUBLIC (Postgres grants it by default).

-- ---------------------------------------------------------------------------------------------
-- app.event_props_ok: analytics props are flat and short (ADR 0032, conventions section 6).
-- An object with at most 12 keys of at most 40 characters; every value a string (at most 80
-- characters), number, boolean or null; no key that names a location, contact detail or free text.
-- Mirrored by eventPropsOk() in _shared/domain/events.ts.
-- ---------------------------------------------------------------------------------------------
create function app.event_props_ok(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = app, extensions, pg_catalog
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p)) > 12 then
    return false;
  end if;
  return not exists (
    select 1
      from jsonb_each(p) e
     where char_length(e.key) > 40
        or lower(e.key) = any (array[
             'lat', 'lng', 'lon', 'latitude', 'longitude', 'coordinates', 'point', 'geom', 'geometry',
             'origin', 'destination', 'pickup', 'dropoff', 'phone', 'phonee164', 'plate', 'email',
             'details', 'note', 'firstname', 'name'])
        or jsonb_typeof(e.value) not in ('string', 'number', 'boolean', 'null')
        or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') > 80));
end
$$;

-- Validated: every existing row must pass (the E2 to E5 emitters already write flat props).
alter table app.analytics_events
  add constraint analytics_events_props_ok check (app.event_props_ok(props));

-- ---------------------------------------------------------------------------------------------
-- admin_actions: the energy price audit joins the action list (ADR 0035).
-- ---------------------------------------------------------------------------------------------
alter table app.admin_actions drop constraint admin_actions_action_check;
alter table app.admin_actions add constraint admin_actions_action_check
  check (action in ('suspend', 'unsuspend', 'dismiss_report', 'energy_price_added'));

-- ---------------------------------------------------------------------------------------------
-- Indexes: weekly metrics scan rides by departure (every status) and bookings by request time;
-- the 24-month purge scans admin_actions by age; a report's history is read by report id.
-- ---------------------------------------------------------------------------------------------
create index rides_departure_idx on app.rides (departure_at);
create index bookings_requested_idx on app.bookings (requested_at);
create index admin_actions_created_idx on app.admin_actions (created_at);
create index admin_actions_report_idx on app.admin_actions (report_id);

-- ---------------------------------------------------------------------------------------------
-- app.admin_suspend_user: same behaviour as E5, plus the ground (a report_reason label) stored in
-- the audit row for the statement of reasons (DSA Art. 17). The 4-argument version is dropped so
-- that a call with four arguments resolves to this one through the default of the fifth.
-- ---------------------------------------------------------------------------------------------
drop function app.admin_suspend_user(uuid, text, uuid, uuid);

create function app.admin_suspend_user(
  p_user_id uuid,
  p_reason text,
  p_admin_id uuid default null,
  p_report_id uuid default null,
  p_reason_code text default 'other'
)
returns boolean
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_changed integer;
begin
  if p_reason_code is null
     or not (p_reason_code = any (select e::text from unnest(enum_range(null::app.report_reason)) e)) then
    raise exception 'unknown reason code' using errcode = '22023';
  end if;
  update app.profiles p set status = 'suspended', updated_at = now()
   where p.id = p_user_id and p.status = 'active';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return false;
  end if;
  insert into app.admin_actions (admin_id, action, target_user_id, report_id, details)
  values (p_admin_id, 'suspend', p_user_id, p_report_id,
          jsonb_build_object('reason', p_reason, 'reasonCode', p_reason_code));
  if p_report_id is not null then
    update app.reports rp
       set status = 'actioned', resolved_at = now(), resolved_by = p_admin_id
     where rp.id = p_report_id and rp.status = 'open';
  end if;
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.admin_dismiss_report: open -> dismissed, with the audit row, in one statement block.
-- Returns false when the report is not open (unknown, or already resolved).
-- ---------------------------------------------------------------------------------------------
create function app.admin_dismiss_report(
  p_report_id uuid,
  p_admin_id uuid,
  p_note text
)
returns boolean
language plpgsql
volatile
set search_path = app, extensions, pg_catalog
as $$
declare
  v_reported uuid;
begin
  update app.reports rp
     set status = 'dismissed', resolved_at = now(), resolved_by = p_admin_id
   where rp.id = p_report_id and rp.status = 'open'
  returning rp.reported_id into v_reported;
  if not found then
    return false;
  end if;
  insert into app.admin_actions (admin_id, action, target_user_id, report_id, details)
  values (p_admin_id, 'dismiss_report', v_reported, p_report_id, jsonb_build_object('note', p_note));
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- app.outbox_recipients (2 arguments): like the 1-argument version, and with p_include_suspended
-- also suspended users. Never deleted users. The dispatcher uses it for the templates that must
-- reach a suspended user: account_suspended and data_export_ack. A new overload without a default,
-- so a call with one argument stays unambiguous.
-- ---------------------------------------------------------------------------------------------
create function app.outbox_recipients(p_user_ids uuid[], p_include_suspended boolean)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = app, extensions, pg_catalog
as $$
  select p.id, u.email::text
  from app.profiles p
  join auth.users u on u.id = p.id
  where p.id = any (p_user_ids)
    and (p.status = 'active' or (p_include_suspended and p.status = 'suspended'))
    and u.email is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Metrics (ADR 0034): counts only, for one ISO week in Europe/Bucharest (Monday 00:00 local to the
-- next Monday 00:00 local, so a DST week is 167 or 169 hours). The API turns counts into rates.
-- "Accepted" booking = decided_at is not null and status <> 'rejected' (confirmed, completed,
-- no_show, or cancelled after the driver accepted).
-- ---------------------------------------------------------------------------------------------
create function app.metrics_week(p_week date, p_now timestamptz)
returns table (
  completed_seats integer,
  rides_departed integer,
  rides_filled integer,
  requests integer,
  requests_decided integer,
  requests_expired integer,
  median_response_s double precision,
  cohort_size integer,
  cohort_retained integer,
  cohort_closed boolean,
  reports integer,
  rides_completed integer,
  accepted integer,
  cancelled_after_accept integer
)
language plpgsql
stable
set search_path = app, extensions, pg_catalog
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_c_from timestamptz; -- the cohort week W-4
  v_c_to timestamptz;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'p_week must be a Monday' using errcode = '22023';
  end if;
  v_from := p_week::timestamp at time zone 'Europe/Bucharest';
  v_to := (p_week + 7)::timestamp at time zone 'Europe/Bucharest';
  v_c_from := (p_week - 28)::timestamp at time zone 'Europe/Bucharest';
  v_c_to := (p_week - 21)::timestamp at time zone 'Europe/Bucharest';

  return query
  with cohort as (
    -- passengers whose FIRST completed booking departs in W-4
    select f.passenger_id, f.first_at
      from (select b.passenger_id, min(r.departure_at) as first_at
              from app.bookings b
              join app.rides r on r.id = b.ride_id
             where b.status = 'completed'
             group by b.passenger_id) f
     where f.first_at >= v_c_from and f.first_at < v_c_to
  )
  select
    (select count(*)::integer from app.bookings b join app.rides r on r.id = b.ride_id
      where b.status = 'completed' and r.departure_at >= v_from and r.departure_at < v_to),
    (select count(*)::integer from app.rides r
      where r.departure_at >= v_from and r.departure_at < v_to),
    (select count(*)::integer from app.rides r
      where r.departure_at >= v_from and r.departure_at < v_to
        and exists (select 1 from app.bookings b
                     where b.ride_id = r.id and b.decided_at is not null and b.status <> 'rejected')),
    (select count(*)::integer from app.bookings b
      where b.requested_at >= v_from and b.requested_at < v_to),
    (select count(*)::integer from app.bookings b
      where b.requested_at >= v_from and b.requested_at < v_to and b.decided_at is not null),
    (select count(*)::integer from app.bookings b
      where b.requested_at >= v_from and b.requested_at < v_to and b.status = 'expired'),
    (select percentile_cont(0.5) within group (order by (extract(epoch from b.decided_at - b.requested_at))::double precision)
       from app.bookings b
      where b.requested_at >= v_from and b.requested_at < v_to and b.decided_at is not null),
    (select count(*)::integer from cohort),
    (select count(*)::integer from cohort c
      where (select count(*) from app.bookings b2 join app.rides r2 on r2.id = b2.ride_id
              where b2.passenger_id = c.passenger_id and b2.status = 'completed'
                and r2.departure_at >= c.first_at
                and r2.departure_at <= c.first_at + make_interval(hours => 672)) >= 2),
    (p_now >= v_c_to + make_interval(hours => 672)),
    (select count(*)::integer from app.reports rp
      where rp.created_at >= v_from and rp.created_at < v_to),
    (select count(*)::integer from app.rides r
      where r.status = 'completed' and r.departure_at >= v_from and r.departure_at < v_to),
    (select count(*)::integer from app.bookings b join app.rides r on r.id = b.ride_id
      where r.departure_at >= v_from and r.departure_at < v_to
        and b.decided_at is not null and b.status <> 'rejected'),
    (select count(*)::integer from app.bookings b join app.rides r on r.id = b.ride_id
      where r.departure_at >= v_from and r.departure_at < v_to
        and b.decided_at is not null and b.status = 'cancelled'
        and b.cancelled_by in ('passenger', 'driver'));
end
$$;

-- search_performed per corridor for the week. Always four rows (zeros included), in a fixed order.
create function app.metrics_match_by_corridor(p_week date)
returns table (corridor text, searches integer, matched integer)
language plpgsql
stable
set search_path = app, extensions, pg_catalog
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_week is null or extract(isodow from p_week) <> 1 then
    raise exception 'p_week must be a Monday' using errcode = '22023';
  end if;
  v_from := p_week::timestamp at time zone 'Europe/Bucharest';
  v_to := (p_week + 7)::timestamp at time zone 'Europe/Bucharest';

  return query
  select c.name,
         coalesce(s.searches, 0)::integer,
         coalesce(s.matched, 0)::integer
    from (values (1, 'south'), (2, 'west'), (3, 'campus'), (4, 'other')) c(ord, name)
    left join (
      select case when coalesce(e.props ->> 'corridor', 'other') in ('south', 'west', 'campus')
                  then e.props ->> 'corridor' else 'other' end as corridor,
             count(*) as searches,
             -- CASE, not AND: Postgres does not promise to stop at the first false operand, and the cast
             -- raises on a non-number such as "n/a".
             count(*) filter (
               where case when jsonb_typeof(e.props -> 'resultsCount') = 'number'
                          then (e.props ->> 'resultsCount')::numeric >= 1
                          else false end) as matched
        from app.analytics_events e
       where e.name = 'search_performed' and e.occurred_at >= v_from and e.occurred_at < v_to
       group by 1) s on s.corridor = c.name
   order by c.ord;
end
$$;

-- Completed seats per week for the last p_weeks weeks ending at p_last_week, zeros included.
create function app.metrics_seats_series(p_last_week date, p_weeks integer)
returns table (week date, completed_seats integer)
language plpgsql
stable
set search_path = app, extensions, pg_catalog
as $$
begin
  if p_last_week is null or extract(isodow from p_last_week) <> 1 then
    raise exception 'p_last_week must be a Monday' using errcode = '22023';
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then
    raise exception 'p_weeks must be between 1 and 26' using errcode = '22023';
  end if;
  return query
  select w.d,
         (select count(*)::integer
            from app.bookings b join app.rides r on r.id = b.ride_id
           where b.status = 'completed'
             and r.departure_at >= w.d::timestamp at time zone 'Europe/Bucharest'
             and r.departure_at < (w.d + 7)::timestamp at time zone 'Europe/Bucharest')
    from (select (p_last_week - 7 * (p_weeks - 1 - i))::date as d
            from generate_series(0, p_weeks - 1) i) w
   order by w.d;
end
$$;

-- Drivers with MORE than p_min completed bookings on rides departing in (p_until - 7 days, p_until]
-- (pricing section 7: a ToS enforcement flag, not a metric).
create function app.metrics_high_volume_drivers(p_until timestamptz, p_min integer)
returns table (driver_id uuid, completed integer)
language sql
stable
set search_path = app, extensions, pg_catalog
as $$
  select r.driver_id, count(*)::integer
    from app.bookings b
    join app.rides r on r.id = b.ride_id
   where b.status = 'completed'
     and r.departure_at > p_until - make_interval(hours => 168)
     and r.departure_at <= p_until
   group by r.driver_id
  having count(*) > p_min
   order by 2 desc, 1
$$;

-- ---------------------------------------------------------------------------------------------
-- app.admin_cron_runs: the last run of each pg_cron job, for the ops page. SECURITY DEFINER because
-- haide_api cannot read the cron schema. Never returns the command. Empty where pg_cron is absent
-- (a plain Postgres test database).
-- ---------------------------------------------------------------------------------------------
create function app.admin_cron_runs()
returns table (job text, status text, started_at timestamptz)
language plpgsql
stable
security definer
set search_path = app, extensions, pg_catalog
as $$
begin
  return query
  select distinct on (j.jobname) j.jobname::text, d.status::text, d.start_time
    from cron.job j
    join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname is not null
   order by j.jobname, d.start_time desc;
exception
  when undefined_table or invalid_schema_name then
    return;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Postgres grants EXECUTE to PUBLIC on every new function unless revoked. haide_api keeps
-- EXECUTE through the default privileges; admin_cron_runs says so explicitly.
-- ---------------------------------------------------------------------------------------------
revoke all on function app.event_props_ok(jsonb) from public, anon, authenticated;
revoke all on function app.admin_suspend_user(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.admin_dismiss_report(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.outbox_recipients(uuid[], boolean) from public, anon, authenticated;
revoke all on function app.metrics_week(date, timestamptz) from public, anon, authenticated;
revoke all on function app.metrics_match_by_corridor(date) from public, anon, authenticated;
revoke all on function app.metrics_seats_series(date, integer) from public, anon, authenticated;
revoke all on function app.metrics_high_volume_drivers(timestamptz, integer) from public, anon, authenticated;
revoke all on function app.admin_cron_runs() from public, anon, authenticated;
grant execute on function app.admin_cron_runs() to haide_api;

revoke all on all tables in schema app from anon, authenticated;
revoke all on all sequences in schema app from anon, authenticated;
