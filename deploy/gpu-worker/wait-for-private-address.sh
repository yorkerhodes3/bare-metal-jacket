#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:?Pass the GPU worker environment file}"
TIMEOUT_SECONDS="${BMJ_TAILSCALE_WAIT_SECONDS:-180}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Cannot read $ENV_FILE" >&2
  exit 1
fi

BIND_ADDRESS=$(sed -n 's/^BMJ_BIND_ADDRESS=//p' "$ENV_FILE" | tail -1)
if [[ ! "$BIND_ADDRESS" =~ ^100\. ]]; then
  echo "BMJ_BIND_ADDRESS must be a Tailscale 100.x address, got: $BIND_ADDRESS" >&2
  exit 1
fi

for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if tailscale ip -4 2>/dev/null | grep -Fxq "$BIND_ADDRESS"; then
    echo "Tailscale address is ready: $BIND_ADDRESS"
    exit 0
  fi
  sleep 1
done

echo "Tailscale address $BIND_ADDRESS was not ready within $TIMEOUT_SECONDS seconds" >&2
exit 1
