-- Address search accepts any house number (ADR 0042). When the picked place was a synthetic address (its
-- point is estimated from the neighbouring numbers of the street, not a surveyed point), the preview and the
-- ride remember it, so the owner view can say "approximate position". Forward-only and additive: two flags per
-- table, default false, no backfill (every existing row is a surveyed or reverse-geocoded point), no new
-- function (nothing to revoke).
alter table app.route_previews
  add column origin_approximate boolean not null default false,
  add column destination_approximate boolean not null default false;

alter table app.rides
  add column origin_approximate boolean not null default false,
  add column destination_approximate boolean not null default false;
