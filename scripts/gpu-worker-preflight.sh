#!/usr/bin/env bash
set -euo pipefail

FAILURES=0
WARNINGS=0
CUDA_IMAGE="${BMJ_CUDA_TEST_IMAGE:-nvidia/cuda:12.8.1-base-ubuntu24.04}"
OLLAMA_PORT="${BMJ_OLLAMA_PORT:-11434}"
STATUS_PORT="${BMJ_STATUS_PORT:-9180}"

pass() {
  printf 'PASS  %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN  %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL  %s\n' "$1"
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$1 is installed"
  else
    fail "$1 is required"
  fi
}

printf '%s\n' 'Bare Metal Jacket GPU worker preflight'
printf 'Host: %s %s (%s)\n\n' "$(uname -s)" "$(uname -r)" "$(uname -m)"

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "native Linux is required for a pool worker"
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" =~ ^(22\.04|24\.04|26\.04)$ ]]; then
    pass "supported Ubuntu ${VERSION_ID}"
  else
    fail "use supported Ubuntu 22.04, 24.04, or 26.04 LTS"
  fi
else
  fail "/etc/os-release is unavailable"
fi

for command in nvidia-smi docker nvidia-ctk tailscale curl ss python3; do
  require_command "$command"
done

if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_LINE=$(nvidia-smi \
    --query-gpu=name,memory.total,driver_version \
    --format=csv,noheader,nounits 2>/dev/null | head -1 || true)
  if [[ -n "$GPU_LINE" ]]; then
    GPU_NAME=$(printf '%s' "$GPU_LINE" | cut -d, -f1 | xargs)
    GPU_MEMORY=$(printf '%s' "$GPU_LINE" | cut -d, -f2 | xargs)
    GPU_DRIVER=$(printf '%s' "$GPU_LINE" | cut -d, -f3 | xargs)
    if (( GPU_MEMORY >= 20000 )); then
      pass "$GPU_NAME / ${GPU_MEMORY} MiB / driver $GPU_DRIVER"
    else
      fail "GPU memory ${GPU_MEMORY} MiB is below this profile's 20000 MiB minimum"
    fi
  else
    fail "nvidia-smi could not query the GPU; reboot after driver updates if NVML versions differ"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "Docker Engine is reachable"
  else
    fail "Docker Engine is not reachable; run this preflight with sudo or fix the daemon"
  fi
  if docker compose version >/dev/null 2>&1; then
    pass "Docker Compose is available"
  else
    fail "Docker Compose v2 is required"
  fi
fi

TAILSCALE_IP=""
if command -v tailscale >/dev/null 2>&1; then
  if tailscale status >/dev/null 2>&1; then
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
  fi
  if [[ "$TAILSCALE_IP" =~ ^100\. ]]; then
    pass "Tailscale is connected at $TAILSCALE_IP"
  else
    fail "Tailscale must be authenticated before the worker can join the private pool"
  fi
fi

MEMORY_MIB=$(awk '/MemTotal:/ {printf "%d", $2 / 1024}' /proc/meminfo)
if (( MEMORY_MIB >= 16384 )); then
  pass "system memory ${MEMORY_MIB} MiB"
else
  fail "at least 16384 MiB system memory is required"
fi

DISK_GIB=$(df -Pk "${BMJ_WORKER_DATA_PATH:-/var/lib/docker}" 2>/dev/null |
  awk 'NR==2 {printf "%d", $4 / 1024 / 1024}' || printf 0)
if (( DISK_GIB >= 100 )); then
  pass "at least ${DISK_GIB} GiB free for images and model cache"
else
  warn "only ${DISK_GIB} GiB free; reserve at least 100 GiB for the worker"
fi

HAS_WIFI=0
for interface in /sys/class/net/*; do
  if [[ -d "$interface/wireless" && "$(cat "$interface/carrier" 2>/dev/null || true)" == "1" ]]; then
    HAS_WIFI=1
    break
  fi
done
if (( HAS_WIFI == 1 )); then
  warn "worker is on Wi-Fi; use wired Ethernet before assigning a service-level target"
else
  pass "no active Wi-Fi interface detected"
fi

for target in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
  STATE=$(systemctl is-enabled "$target" 2>/dev/null || true)
  if [[ "$STATE" == "masked" ]]; then
    pass "$target is masked"
  else
    warn "$target is $STATE; an inference worker must not suspend while schedulable"
  fi
done

if [[ -n "$TAILSCALE_IP" ]]; then
  for port in "$OLLAMA_PORT" "$STATUS_PORT"; do
    if ss -ltn | awk '{print $4}' | grep -Eq "(^|\\])${TAILSCALE_IP}:${port}$|^${TAILSCALE_IP}:${port}$"; then
      if [[ "${BMJ_ALLOW_OCCUPIED:-0}" == "1" ]]; then
        warn "$TAILSCALE_IP:$port is occupied; allowed for an in-place worker update"
      else
        fail "$TAILSCALE_IP:$port is already occupied"
      fi
    else
      pass "$TAILSCALE_IP:$port is available"
    fi
  done
fi

if (( FAILURES == 0 )) && [[ "${BMJ_SKIP_GPU_CONTAINER_TEST:-0}" != "1" ]]; then
  if docker run --rm --gpus all "$CUDA_IMAGE" nvidia-smi \
    --query-gpu=name,memory.total \
    --format=csv,noheader >/tmp/bmj-gpu-container-test 2>/dev/null; then
    pass "NVIDIA container runtime: $(head -1 /tmp/bmj-gpu-container-test)"
    rm -f /tmp/bmj-gpu-container-test
  else
    rm -f /tmp/bmj-gpu-container-test
    fail "NVIDIA container runtime test failed with $CUDA_IMAGE"
  fi
fi

printf '\nPreflight complete: %d failure(s), %d warning(s).\n' "$FAILURES" "$WARNINGS"
if (( FAILURES > 0 )); then
  exit 1
fi
