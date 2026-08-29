#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${BMJ_APP_DIR:-$HOME/bare-metal-jacket}"
BACKUP_DIR="${BMJ_BACKUP_DIR:-/var/backups/bare-metal-jacket}"
BACKUP_GROUP="${BMJ_BACKUP_GROUP:-${SUDO_USER:-$USER}}"
SERVICE_SOURCE="$APP_DIR/deploy/systemd/bare-metal-jacket-backup.service"
TIMER_SOURCE="$APP_DIR/deploy/systemd/bare-metal-jacket-backup.timer"
SERVICE_TARGET="/etc/systemd/system/bare-metal-jacket-backup.service"
TIMER_TARGET="/etc/systemd/system/bare-metal-jacket-backup.timer"

if [[ ! -f "$SERVICE_SOURCE" || ! -f "$TIMER_SOURCE" ]]; then
  echo "Run this script from a complete Bare Metal Jacket checkout." >&2
  exit 1
fi

sudo install -d -o root -g "$BACKUP_GROUP" -m 2750 "$BACKUP_DIR"
sudo sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__BACKUP_DIR__|$BACKUP_DIR|g" \
  "$SERVICE_SOURCE" |
  sudo tee "$SERVICE_TARGET" >/dev/null
sudo install -o root -g root -m 0644 "$TIMER_SOURCE" "$TIMER_TARGET"
sudo systemctl daemon-reload
sudo systemctl enable --now bare-metal-jacket-backup.timer
sudo systemctl start bare-metal-jacket-backup.service
sudo systemctl --no-pager status bare-metal-jacket-backup.timer
sudo systemctl --no-pager status bare-metal-jacket-backup.service

echo
echo "Backups: $BACKUP_DIR"
echo "Next run: $(systemctl show bare-metal-jacket-backup.timer --property=NextElapseUSecRealtime --value)"
