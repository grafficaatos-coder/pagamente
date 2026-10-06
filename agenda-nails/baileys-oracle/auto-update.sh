#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/opt/agenda-pro-baileys"
APP_DIR="$REPO_DIR/agenda-nails/baileys-oracle"
LOCK_FILE="/var/lock/agenda-pro-auto-update.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -d "$REPO_DIR/.git" ]; then
  log "Repositório não encontrado em $REPO_DIR"
  exit 1
fi

GIT=(git -c safe.directory="$REPO_DIR" -C "$REPO_DIR")

"${GIT[@]}" fetch origin main --quiet
OLD_COMMIT="$("${GIT[@]}" rev-parse HEAD)"
NEW_COMMIT="$("${GIT[@]}" rev-parse origin/main)"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  exit 0
fi

CHANGED="$("${GIT[@]}" diff --name-only "$OLD_COMMIT" "$NEW_COMMIT")"
log "Nova versão detectada: $(echo "$OLD_COMMIT" | cut -c1-8) -> $(echo "$NEW_COMMIT" | cut -c1-8)"

if ! "${GIT[@]}" pull --ff-only origin main; then
  log "Falha no git pull. Atualização cancelada."
  exit 1
fi

if printf '%s\n' "$CHANGED" | grep -q '^agenda-nails/baileys-oracle/systemd/'; then
  install -m 0644 "$APP_DIR/systemd/agenda-pro-update.service" /etc/systemd/system/agenda-pro-update.service
  install -m 0644 "$APP_DIR/systemd/agenda-pro-update.timer" /etc/systemd/system/agenda-pro-update.timer
  systemctl daemon-reload
  systemctl enable --now agenda-pro-update.timer >/dev/null 2>&1 || true
fi

if ! printf '%s\n' "$CHANGED" | grep -q '^agenda-nails/baileys-oracle/'; then
  log "Atualização não altera o serviço Oracle. Git sincronizado."
  exit 0
fi

cd "$APP_DIR"

rollback(){
  log "Nova versão falhou. Voltando para $(echo "$OLD_COMMIT" | cut -c1-8)."
  "${GIT[@]}" reset --hard "$OLD_COMMIT" >/dev/null
  docker compose build baileys >/dev/null
  docker compose up -d --remove-orphans >/dev/null
}

if ! docker compose build baileys; then
  rollback
  exit 1
fi

if ! docker compose up -d --remove-orphans; then
  rollback
  exit 1
fi

PUBLIC_HOST="$(grep -E '^PUBLIC_HOST=' .env | tail -n1 | cut -d= -f2- || true)"
if [ -z "$PUBLIC_HOST" ]; then
  log "PUBLIC_HOST ausente no .env."
  rollback
  exit 1
fi

for i in $(seq 1 18); do
  if curl -kfsS --max-time 8 "https://$PUBLIC_HOST/health" >/dev/null 2>&1; then
    log "Atualização concluída e serviço saudável."
    exit 0
  fi
  sleep 5
done

log "Health check falhou após atualização."
rollback
exit 1
