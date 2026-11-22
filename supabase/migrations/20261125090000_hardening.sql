-- Hardening (E7 low finding 4): an admin must not be able to suspend another admin (the API only
-- blocked self). The rule now lives in app.admin_suspend_user itself, so the SQL console path and
-- any future caller obey it too.
-- Forward-only. CREATE OR REPLACE keeps the signature, so the existing grants stay: PUBLIC, anon
-- and authenticated have no EXECUTE (revoked in 20261122090000), haide_api keeps its own. The
-- revoke below is repeated defensively and is a no-op. No new function is added.
create or replace function app.admin_suspend_user(
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
  if exists (select 1 from app.profiles a where a.id = p_user_id and a.role = 'admin') then
    raise exception 'an admin cannot be suspended' using errcode = '42501';
  end if;
  update app.profiles p set status = 'suspended', updated_at = now()
   where p.id = p_user_id and p.status = 'active' and p.role <> 'admin';
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

revoke all on function app.admin_suspend_user(uuid, text, uuid, uuid, text) from public, anon, authenticated;
