-- Legal text 1.2: names the data controller (a private individual running a personal, non-commercial
-- project) and gives one contact email, replacing the launch placeholders. The content ships in apps/web,
-- features/policy/content (terms.v1_2.en.ts, privacy.v1_2.en.ts). Version 1.1 is never edited.
-- It becomes current on the publish date; users on 1.1 are asked to accept again (consent.reaccept on GET /me).
-- Forward-only data change: no new functions, so no new grants.
insert into app.legal_documents (kind, version, published_at, url) values
  ('terms', '1.2', '2026-11-22T00:00:00Z', '/policy/terms'),
  ('privacy', '1.2', '2026-11-22T00:00:00Z', '/policy/privacy');
