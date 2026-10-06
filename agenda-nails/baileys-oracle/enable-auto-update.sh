#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/agenda-pro-baileys/agenda-nails/baileys-oracle"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

install -m 0644 "$APP_DIR/systemd/agenda-pro-update.service" /etc/systemd/system/agenda-pro-update.service
install -m 0644 "$APP_DIR/systemd/agenda-pro-update.timer" /etc/systemd/system/agenda-pro-update.timer
systemctl daemon-reload
systemctl enable --now agenda-pro-update.timer

echo
echo "Atualização automática ativada."
echo "O servidor verifica novas versões aproximadamente a cada 1 minuto."
echo
systemctl list-timers agenda-pro-update.timer --no-pager
