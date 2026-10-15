#!/bin/sh
# Monte une VRAIE pile Supabase (les images que Supabase fait tourner en
# production : Postgres de Supabase, GoTrue, PostgREST), sans la CLI — la
# CLI exige Realtime, qui exige l'IPv6. Ordre de la production : la base,
# puis GoTrue qui migre « auth », puis NOS migrations, puis PostgREST.
#
#   sh supabase/epreuve/monter.sh       (démonter : sh supabase/epreuve/demonter.sh)
#
# Ports : base 55432, GoTrue 59999, PostgREST 53000. Mot de passe et secret
# JWT d'essai, écrits ici exprès : cette pile ne sert qu'à l'épreuve.
set -eu
ICI=$(cd "$(dirname "$0")/../.." && pwd)
. "$ICI/supabase/epreuve/reglages.sh"

docker info >/dev/null 2>&1 || { echo "✗ Docker ne répond pas (dockerd lancé ?)"; exit 1; }
sh "$ICI/supabase/epreuve/demonter.sh" >/dev/null 2>&1 || true
docker network create xafe-epreuve >/dev/null

docker run -d --name xafe-db --network xafe-epreuve -e POSTGRES_PASSWORD=$MDP -e JWT_SECRET=$SECRET -e JWT_EXP=3600 \
  -p 127.0.0.1:$PORT_DB:5432 $IMAGE_DB >/dev/null
for i in $(seq 1 60); do psql_admin -Atc "select 1" >/dev/null 2>&1 && break; sleep 2; done
psql_admin -Atc "select 1" >/dev/null || { docker logs xafe-db | tail -20; echo "✗ la base ne démarre pas"; exit 1; }
psql_admin -qc "alter role authenticator with password '$MDP'; alter role supabase_auth_admin with password '$MDP';"
echo "· base Supabase $IMAGE_DB"

docker run -d --name xafe-auth --network xafe-epreuve \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:$PORT_AUTH \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$MDP@xafe-db:5432/postgres" \
  -e GOTRUE_SITE_URL=http://localhost -e GOTRUE_JWT_SECRET=$SECRET -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=true -e GOTRUE_SMS_PROVIDER=twilio -e GOTRUE_SMS_TWILIO_ACCOUNT_SID=essai \
  -e GOTRUE_SMS_TWILIO_AUTH_TOKEN=essai -e GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID=essai -e GOTRUE_SMS_AUTOCONFIRM=false \
  -e GOTRUE_SMS_TEST_OTP="$OTP_ESSAI" -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_RATE_LIMIT_SMS_SENT=1000 -e GOTRUE_RATE_LIMIT_VERIFY=1000 -e GOTRUE_RATE_LIMIT_OTP=1000 \
  -p 127.0.0.1:$PORT_AUTH:9999 $IMAGE_AUTH >/dev/null
for i in $(seq 1 60); do curl -sf http://127.0.0.1:$PORT_AUTH/health >/dev/null 2>&1 && break; sleep 2; done
curl -sf http://127.0.0.1:$PORT_AUTH/health >/dev/null || { docker logs xafe-auth | tail -20; echo "✗ GoTrue ne démarre pas"; exit 1; }
echo "· GoTrue $IMAGE_AUTH (le schéma auth migré par lui, comme en production)"

for m in "${MIGRATIONS:-$ICI/supabase/migrations}"/*.sql; do
  psql_postgres -v ON_ERROR_STOP=1 -q -f "$m" >/tmp/xafe-migration.log 2>&1 || { cat /tmp/xafe-migration.log; echo "✗ $(basename "$m") ne passe pas sur la vraie base"; exit 1; }
  echo "· migration $(basename "$m") (en postgres, qui n'est PAS superutilisateur chez Supabase)"
done

docker run -d --name xafe-rest --network xafe-epreuve -e PGRST_DB_URI="postgres://authenticator:$MDP@xafe-db:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET -e PGRST_DB_USE_LEGACY_GUCS=false \
  -e PGRST_SERVER_PORT=3000 -p 127.0.0.1:$PORT_REST:3000 $IMAGE_REST >/dev/null
for i in $(seq 1 30); do curl -sf http://127.0.0.1:$PORT_REST/ >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://127.0.0.1:$PORT_REST/ >/dev/null || { docker logs xafe-rest | tail -20; echo "✗ PostgREST ne démarre pas"; exit 1; }
echo "· PostgREST $IMAGE_REST"
