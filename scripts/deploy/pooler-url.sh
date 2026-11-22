#!/usr/bin/env bash
# Prints the session-pooler URL (no password) of the linked Supabase project, e.g.
#   postgresql://postgres.<ref>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
# Primary source: supabase/.temp/pooler-url, written by `supabase link`. Fallback (CLI versions or
# link runs that do not write it): the Management API pooler config. Needs PROJECT_REF,
# SUPABASE_ACCESS_TOKEN and jq. GitHub runners are IPv4 only, so the direct db.<ref> host is no option.
set -euo pipefail
f=supabase/.temp/pooler-url
if [ -s "$f" ]; then
  tr -d '\r\n' < "$f"
  echo
  exit 0
fi
: "${PROJECT_REF:?PROJECT_REF is required}" "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
host="$(curl -fsS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/database/pooler" |
  jq -r '[.[] | .db_host | select(. != null and . != "")][0] // empty')"
[ -n "$host" ] || { echo "pooler host not found for project ${PROJECT_REF}" >&2; exit 1; }
echo "postgresql://postgres.${PROJECT_REF}@${host}:5432/postgres"
