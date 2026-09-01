#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_DIR/deploy/gpu-worker"
ENV_FILE="$WORKER_DIR/.env"
NODE_DIR="/etc/bare-metal-jacket"
NODE_MANIFEST="$NODE_DIR/node.json"
UNIT="/etc/systemd/system/bare-metal-jacket-gpu-worker.service"
NODE_ID=""
DISPLAY_NAME=""
OWNER="Ethical Tech CoLab"
MODELS="qwen3:14b,gemma3:12b,deepseek-r1:8b"
SKIP_MODELS=0

usage() {
  cat <<'EOF'
Usage:
  sudo bash scripts/install-gpu-worker.sh \
    --node-id office-rtx3090 \
    --display-name "Office RTX 3090" \
    [--owner "Ethical Tech CoLab"] \
    [--models qwen3:14b,gemma3:12b,deepseek-r1:8b] \
    [--skip-model-pull]

Prerequisites are intentionally separate. Complete docs/operations/add-gpu-worker.md
and run scripts/gpu-worker-preflight.sh before this installer.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-id)
      NODE_ID="${2:-}"
      shift 2
      ;;
    --display-name)
      DISPLAY_NAME="${2:-}"
      shift 2
      ;;
    --owner)
      OWNER="${2:-}"
      shift 2
      ;;
    --models)
      MODELS="${2:-}"
      shift 2
      ;;
    --skip-model-pull)
      SKIP_MODELS=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo so systemd and /etc can be configured." >&2
  exit 1
fi
if [[ ${#NODE_ID} -lt 2 || ! "$NODE_ID" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "--node-id must be a lowercase DNS-style slug." >&2
  exit 1
fi
if [[ -z "$MODELS" ]]; then
  echo "--models must contain at least one model." >&2
  exit 1
fi
DISPLAY_NAME="${DISPLAY_NAME:-$NODE_ID}"

if systemctl is-active --quiet bare-metal-jacket-gpu-worker.service; then
  BMJ_ALLOW_OCCUPIED=1 bash "$SCRIPT_DIR/gpu-worker-preflight.sh"
else
  bash "$SCRIPT_DIR/gpu-worker-preflight.sh"
fi

TAILSCALE_IP=$(tailscale ip -4 | head -1)
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1 | xargs)
GPU_MEMORY=$(nvidia-smi \
  --query-gpu=memory.total \
  --format=csv,noheader,nounits | head -1 | xargs)
CPU_CORES=$(nproc)
MEMORY_MIB=$(awk '/MemTotal:/ {printf "%d", $2 / 1024}' /proc/meminfo)
NETWORK_PROFILE="wired"
for interface in /sys/class/net/*; do
  if [[ -d "$interface/wireless" && "$(cat "$interface/carrier" 2>/dev/null || true)" == "1" ]]; then
    NETWORK_PROFILE="wifi"
    break
  fi
done

install -d -o root -g root -m 0755 "$NODE_DIR"
NODE_ID="$NODE_ID" \
  DISPLAY_NAME="$DISPLAY_NAME" \
  OWNER="$OWNER" \
  TAILSCALE_IP="$TAILSCALE_IP" \
  GPU_NAME="$GPU_NAME" \
  GPU_MEMORY="$GPU_MEMORY" \
  CPU_CORES="$CPU_CORES" \
  MEMORY_MIB="$MEMORY_MIB" \
  NETWORK_PROFILE="$NETWORK_PROFILE" \
  MODELS="$MODELS" \
  python3 - "$NODE_MANIFEST" <<'PY'
import json
import os
import sys

path = sys.argv[1]
node = {
    "$schema": "https://yorkerhodes3.github.io/bare-metal-jacket/schemas/hardware-node.schema.json",
    "apiVersion": "baremetaljacket.dev/v1alpha1",
    "kind": "HardwareNode",
    "metadata": {
        "id": os.environ["NODE_ID"],
        "displayName": os.environ["DISPLAY_NAME"],
        "owner": os.environ["OWNER"],
    },
    "spec": {
        "role": "inference-worker",
        "trust": "lab-internal",
        "endpoints": {
            "inference": f"http://{os.environ['TAILSCALE_IP']}:11434",
            "status": f"http://{os.environ['TAILSCALE_IP']}:9180",
        },
        "network": {
            "transport": "tailscale",
            "profile": os.environ["NETWORK_PROFILE"],
        },
        "capacity": {
            "cpuCores": int(os.environ["CPU_CORES"]),
            "memoryMiB": int(os.environ["MEMORY_MIB"]),
            "gpu": {
                "count": 1,
                "vendor": "NVIDIA",
                "model": os.environ["GPU_NAME"],
                "memoryMiB": int(os.environ["GPU_MEMORY"]),
            },
        },
        "labels": {
            "location": "office",
            "accelerator": "nvidia-rtx-3090",
            "network": os.environ["NETWORK_PROFILE"],
            "reliability": "best-effort",
        },
        "models": [item.strip() for item in os.environ["MODELS"].split(",") if item.strip()],
        "scheduling": {
            "state": "disabled",
            "maxConcurrent": 1,
            "allowedWorkloads": ["ai.chat", "ai.embeddings"],
        },
        "storage": {
            "modelCache": "reconstructable",
            "durableApplicationData": False,
        },
        "heartbeat": {
            "intervalSeconds": 30,
            "unavailableAfterSeconds": 90,
        },
    },
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(node, handle, indent=2)
    handle.write("\n")
PY
chmod 0644 "$NODE_MANIFEST"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$WORKER_DIR/.env.example" "$ENV_FILE"
fi
python3 - "$ENV_FILE" "$TAILSCALE_IP" "$NODE_MANIFEST" "$MODELS" <<'PY'
import re
import sys

path, address, manifest, models = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
replacements = {
    "BMJ_BIND_ADDRESS": address,
    "BMJ_NODE_MANIFEST": manifest,
    "OLLAMA_MODELS": models,
}
for key, value in replacements.items():
    content = re.sub(rf"(?m)^{key}=.*$", f"{key}={value}", content)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
chmod 0600 "$ENV_FILE"

sed \
  -e "s|__APP_DIR__|$WORKER_DIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  -e "s|__COMPOSE_FILE__|$WORKER_DIR/docker-compose.yml|g" \
  -e "s|__WAIT_SCRIPT__|$WORKER_DIR/wait-for-private-address.sh|g" \
  "$WORKER_DIR/systemd/bare-metal-jacket-gpu-worker.service" >"$UNIT"
chmod 0644 "$UNIT"

systemctl daemon-reload
systemctl enable bare-metal-jacket-gpu-worker.service
systemctl restart bare-metal-jacket-gpu-worker.service

if (( SKIP_MODELS == 0 )); then
  IFS=',' read -ra MODEL_LIST <<<"$MODELS"
  for model in "${MODEL_LIST[@]}"; do
    model=$(printf '%s' "$model" | xargs)
    [[ -z "$model" ]] && continue
    echo "==> Pulling $model"
    docker compose \
      --env-file "$ENV_FILE" \
      -f "$WORKER_DIR/docker-compose.yml" \
      exec -T ollama ollama pull "$model"
  done
fi

curl -fsS "http://$TAILSCALE_IP:9180/readyz"
printf '\n'
curl -fsS "http://$TAILSCALE_IP:9180/v1/inventory"
printf '\n'

cat <<EOF

GPU worker is healthy but remains scheduling.state=disabled.

Inference: http://$TAILSCALE_IP:11434
Status:    http://$TAILSCALE_IP:9180
Manifest:  $NODE_MANIFEST

Next:
1. Apply the tailnet ACL in docs/operations/add-gpu-worker.md.
2. Run gpu-worker-smoke.mjs from B3IQ.
3. Change scheduling.state to enabled only after the remote checks pass.
EOF
