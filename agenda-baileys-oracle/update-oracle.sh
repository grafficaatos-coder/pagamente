#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/grafficaatos-coder/pagamente.git"
BASE="${HOME}/pagamente"
APP="${BASE}/agenda-baileys-oracle"

echo "[1/5] Atualizando código..."
if [ -d "${BASE}/.git" ]; then
  git -C "${BASE}" fetch origin main
  git -C "${BASE}" reset --hard origin/main
else
  git clone "${REPO_URL}" "${BASE}"
fi

cd "${APP}"

echo "[2/5] Reaproveitando configuração existente..."
if [ ! -f .env ]; then
  if docker inspect agenda-pro-baileys >/dev/null 2>&1; then
    docker inspect agenda-pro-baileys --format '{{range .Config.Env}}{{println .}}{{end}}'       | grep -E '^(PUBLIC_HOST|SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|DATA_DIR|WHATSAPP_LOG_LEVEL|AGENT_NAME|RUNTIME_LEASE_SECONDS)='       > .env || true
  fi
fi

touch .env
grep -q '^PUBLIC_HOST=' .env || echo 'PUBLIC_HOST=129.148.54.231.sslip.io' >> .env
grep -q '^DATA_DIR=' .env || echo 'DATA_DIR=/data/sessions' >> .env
grep -q '^WHATSAPP_LOG_LEVEL=' .env || echo 'WHATSAPP_LOG_LEVEL=info' >> .env
grep -q '^AGENT_NAME=' .env || echo 'AGENT_NAME=agenda-pro-oracle-v2' >> .env
grep -q '^RUNTIME_LEASE_SECONDS=' .env || echo 'RUNTIME_LEASE_SECONDS=20' >> .env

if ! grep -q '^SUPABASE_URL=' .env || ! grep -q '^SUPABASE_SERVICE_ROLE_KEY=' .env; then
  echo
  echo "Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env."
  echo "Abra: ${APP}/.env"
  exit 2
fi

echo "[3/5] Parando versão antiga..."
docker rm -f agenda-pro-baileys agenda-pro-caddy >/dev/null 2>&1 || true

echo "[4/5] Construindo versão corrigida..."
docker compose up -d --build

echo "[5/5] Testando..."
sleep 5
docker compose ps
echo
curl -fsS "https://129.148.54.231.sslip.io/ready" || {
  echo
  echo "HTTPS ainda não respondeu. Veja os logs:"
  echo "cd ${APP} && docker compose logs --tail=120"
  exit 3
}
echo
echo "Atualização concluída."
