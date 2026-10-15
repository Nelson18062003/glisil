# Les réglages de la pile d'épreuve (lus par monter.sh et eprouver.sh).
IMAGE_DB=public.ecr.aws/supabase/postgres:17.6.1.011
IMAGE_AUTH=public.ecr.aws/supabase/gotrue:v2.180.0
IMAGE_REST=public.ecr.aws/supabase/postgrest:v13.0.7
MDP=essai
SECRET=super-secret-jwt-token-with-at-least-32-characters-long
PORT_DB=55432
PORT_AUTH=59999
PORT_REST=53000
# Des numéros de test : GoTrue n'envoie rien et accepte ce code.
OTP_ESSAI="237677120001:123456,237677120002:123456,237699120003:123456"
export PGPASSWORD=$MDP
psql_admin() { psql -h 127.0.0.1 -p $PORT_DB -U supabase_admin -d postgres "$@"; }
psql_postgres() { psql -h 127.0.0.1 -p $PORT_DB -U postgres -d postgres "$@"; }
