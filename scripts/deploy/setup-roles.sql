-- Idempotent role and Vault setup, run by deploy.yml with psql variables (never inline secrets):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v api_pw="$API_DB_PASSWORD" -v cron="$CRON_SECRET" \
--        -v tick_url="$PROD_API_URL/internal/tick" -f scripts/deploy/setup-roles.sql

-- API role password (the role itself is created by the baseline migration).
select format('alter role haide_api with password %L', :'api_pw') \gexec

-- Vault secrets read by the pg_cron jobs that call POST /internal/tick through pg_net.
select vault.create_secret(:'cron', 'cron_secret', 'x-cron-secret for POST /internal/tick')
where not exists (select 1 from vault.secrets where name = 'cron_secret');
select vault.update_secret(id, :'cron') from vault.secrets where name = 'cron_secret';

select vault.create_secret(:'tick_url', 'api_tick_url', 'URL of POST /internal/tick')
where not exists (select 1 from vault.secrets where name = 'api_tick_url');
select vault.update_secret(id, :'tick_url') from vault.secrets where name = 'api_tick_url';
