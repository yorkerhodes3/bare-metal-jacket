# Add an RTX 3090 inference worker

## Outcome

This runbook prepares a 24 GiB RTX 3090 desktop as a private, replaceable inference worker in the Bare Metal Jacket lab.

It does **not** move PostgreSQL, Redis, the registry, secrets, project uploads, backups, or the control plane onto the desktop.

```text
Pages application
      |
      v
B3IQ shared gateway / model router
      |
      | private Tailscale connection
      v
Office RTX 3090 worker
  |-- Ollama OpenAI-compatible API :11434
  |-- read-only node status         :9180
  `-- reconstructable model cache
```

Only B3IQ/control nodes and operators can reach the worker through the tailnet. Nothing is exposed to the office LAN or public internet.

## Current product boundary

Bare Metal Jacket does not yet have an automatic multi-node scheduler. The 3090 joins a **provisional manual hardware pool**:

- its hardware, endpoints, labels, models, and scheduling state use the versioned [hardware node schema](https://yorkerhodes3.github.io/bare-metal-jacket/schemas/hardware-node.schema.json);
- the status service gives the control node health, inventory, and model discovery without Docker access;
- the gateway can route explicitly configured model aliases to the worker;
- operators enable, drain, or disable it manually; and
- no automatic failover, capacity balancing, or workload rescheduling is claimed.

The future node agent/control plane will consume the same concepts—registration, heartbeat, labels, capacity, draining, and placement—without exposing a remote Docker API.

## Is the RTX 3090 a useful profile?

Yes, for lab inference:

| Workload                    | Fit                                                         |
| --------------------------- | ----------------------------------------------------------- |
| 7–8B Q4 chat model          | Comfortable; limited parallelism possible                   |
| 12–14B Q4 chat/vision model | Recommended; one loaded model and one request at a time     |
| 27B Q4 model                | Possible but tight; context and concurrency must be reduced |
| 70B model fully on GPU      | Not a 24 GiB profile                                        |
| Embeddings/reranking        | Comfortable                                                 |
| Model training              | Not part of this worker profile                             |

Default pool models:

- `qwen3:14b`;
- `gemma3:12b`; and
- `deepseek-r1:8b`.

The bundle sets `OLLAMA_MAX_LOADED_MODELS=1` and `OLLAMA_NUM_PARALLEL=1`. Increase concurrency only after measuring VRAM, latency, temperature, and queue behavior.

## Reliability classification

An office desktop on Wi-Fi is **best effort**, not equivalent to a hosted bare-metal node.

Before it contributes to a service-level target:

- use wired Ethernet;
- reserve its DHCP address even though Tailscale supplies stable addressing;
- disable sleep, hibernate, and automatic user-session shutdown;
- enable “restore on AC power loss” in firmware;
- use a UPS;
- verify sustained cooling and power;
- arrange OS and NVIDIA-driver maintenance windows; and
- monitor it from outside the office network.

Wi-Fi is acceptable for a pilot because requests can remain on B3IQ when the worker is unavailable. Do not make the 3090 the only route for a critical model.

## Recommended operating system

Use native Ubuntu 24.04 LTS. Ubuntu 22.04 and 26.04 are also supported by current Docker guidance.

Windows 11 with WSL 2 and Docker Desktop is useful for evaluation but should not be marked schedulable for the lab service level:

- Docker Desktop depends on user/session lifecycle;
- Windows updates and sleep can interrupt it;
- network binding and GPU behavior add another virtualization layer; and
- host recovery is less deterministic.

If the desktop must remain Windows, run the bundle for qualification only and keep `scheduling.state=disabled`.

## 1. Prepare the host

### Hardware and firmware

Confirm:

- RTX 3090 with 24 GiB VRAM;
- at least 16 GiB system RAM, preferably 32 GiB or more;
- at least 100 GiB free SSD for images and model cache;
- adequate PSU and cooling; and
- virtualization and automatic power recovery enabled in firmware.

An operator may reduce heat and power by setting a tested 280–320 W NVIDIA power limit. This is hardware-specific and intentionally not automated:

```bash
sudo nvidia-smi -pm 1
sudo nvidia-smi -pl 300
```

Run `nvidia-smi -q -d POWER` first and stay within the card's supported limits.

### Install and verify the NVIDIA driver

```bash
sudo apt update
sudo ubuntu-drivers install
sudo reboot
nvidia-smi
```

Do not continue if `nvidia-smi` reports an NVML driver/library mismatch. Reboot after driver or kernel upgrades and correct the driver before installing the worker.

### Prevent suspend

```bash
sudo systemctl mask \
  sleep.target \
  suspend.target \
  hibernate.target \
  hybrid-sleep.target
```

## 2. Install Docker Engine

Use Docker's signed Ubuntu repository, not an unaudited convenience script:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL \
  https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Do not expose the Docker API or add an unrestricted Docker TCP listener.

## 3. Install NVIDIA Container Toolkit

Following the current NVIDIA/Ollama container guidance:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey |
  sudo gpg --dearmor \
    -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -fsSL \
  https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list |
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' |
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify GPU access from a container:

```bash
sudo docker run --rm --gpus all \
  nvidia/cuda:12.8.1-base-ubuntu24.04 \
  nvidia-smi
```

## 4. Join the private tailnet

Install Tailscale from its stable packages or reviewed official installer:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --advertise-tags=tag:bmj-gpu-worker
tailscale ip -4
tailscale status
```

Use a reusable or ephemeral auth key only through the operator's secret-management process. Do not commit it or place it in shell history.

B3IQ must join the same tailnet with `tag:bmj-control`.

Merge rules equivalent to these into the existing tailnet policy:

```json
{
  "tagOwners": {
    "tag:bmj-control": ["group:admin"],
    "tag:bmj-gpu-worker": ["group:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:bmj-control"],
      "dst": ["tag:bmj-gpu-worker:11434,9180"]
    },
    {
      "action": "accept",
      "src": ["group:admin"],
      "dst": ["tag:bmj-gpu-worker:22"]
    }
  ]
}
```

Do not grant all tailnet devices access to Ollama. The API has no application authentication in this profile; the tailnet ACL is the network authorization boundary.

## 5. Clone and preflight

```bash
git clone https://github.com/yorkerhodes3/bare-metal-jacket.git
cd bare-metal-jacket
sudo bash scripts/gpu-worker-preflight.sh
```

Preflight checks:

- supported native Ubuntu;
- NVIDIA driver and at least 20 GiB reported VRAM;
- Docker and Compose;
- NVIDIA Container Toolkit;
- a successful CUDA container GPU query;
- Tailscale authentication and address;
- memory, disk, ports, and suspend policy; and
- whether the host appears to use Wi-Fi.

Warnings do not prevent a pilot. Failures do.

## 6. Install the worker

```bash
sudo bash scripts/install-gpu-worker.sh \
  --node-id office-rtx3090 \
  --display-name "Office RTX 3090"
```

The installer:

1. reruns preflight;
2. generates `/etc/bare-metal-jacket/node.json`;
3. binds ports 11434 and 9180 only to the Tailscale IPv4 address;
4. installs a boot-persistent systemd unit;
5. starts Ollama and the read-only status service;
6. pulls the default model profile; and
7. leaves `scheduling.state=disabled`.

At boot, systemd waits up to three minutes for the recorded Tailscale address before asking Docker to bind the worker ports. Re-running the installer treats the existing worker ports as an update warning, then restarts the unit with the refreshed manifest and configuration.

Model downloads are large. Use `--skip-model-pull` for a staged install, or choose a smaller list:

```bash
sudo bash scripts/install-gpu-worker.sh \
  --node-id office-rtx3090 \
  --display-name "Office RTX 3090" \
  --models qwen3:14b,deepseek-r1:8b
```

## 7. Verify remotely from B3IQ

Copy or clone Bare Metal Jacket on B3IQ, then use the worker's Tailscale address:

```bash
export BMJ_GPU_WORKER_STATUS_URL=http://100.x.y.z:9180
export BMJ_GPU_WORKER_INFERENCE_URL=http://100.x.y.z:11434
node scripts/gpu-worker-smoke.mjs

export BMJ_GPU_WORKER_LIVE=1
export BMJ_GPU_WORKER_MODEL=qwen3:14b
node scripts/gpu-worker-smoke.mjs
```

The remote smoke verifies:

- liveness and Ollama-backed readiness;
- the worker-only inventory contract;
- no durable application data declaration;
- model catalogs through both endpoints; and
- one bounded OpenAI-compatible completion when live mode is enabled.

## 8. Enable provisional scheduling

Only after the B3IQ smoke passes:

1. update `/etc/bare-metal-jacket/node.json` from `disabled` to `enabled`;
2. retain `maxConcurrent: 1`;
3. register the node manifest with the operator inventory;
4. add explicit model aliases to the shared gateway/model router; and
5. run the external model canary.

Recommended aliases identify placement without exposing it to students:

```text
lab/qwen3-14b
lab/gemma3-12b
lab/deepseek-r1-8b
```

Students continue calling the shared browser helper. They do not receive the Tailscale address and do not choose a physical node.

The live `pages-ai-proxy` supports a server-side `MODEL_ROUTES_JSON` mapping for the alias:

```json
{
  "lab/qwen3-14b": {
    "upstream": "http://100.x.y.z:11434/v1/chat/completions",
    "model": "qwen3:14b"
  }
}
```

Keep the worker disabled until the route is deployed on B3IQ and the public alias passes a bounded inference test. Do not replace the B3IQ local upstream globally merely to add one desktop.

## Drain, maintenance, and removal

Before reboot, driver upgrade, office power work, or moving the desktop:

1. set `scheduling.state=draining`;
2. remove its model aliases from new request placement;
3. wait for active requests and queue depth to reach zero;
4. set `scheduling.state=disabled`;
5. stop the unit:

   ```bash
   sudo systemctl stop bare-metal-jacket-gpu-worker
   ```

6. perform maintenance;
7. rerun preflight and remote smoke; and
8. enable scheduling again.

If three heartbeats are missed (90 seconds), the future scheduler must stop assigning work. The provisional manual pool relies on external health checks and operator action.

To remove the node:

```bash
sudo systemctl disable --now bare-metal-jacket-gpu-worker
sudo tailscale logout
```

Revoke the Tailscale machine in the admin console. Delete the model volume only after confirming it contains no authoritative data:

```bash
sudo docker volume rm bare-metal-jacket-gpu-worker_ollama-models
```

## Data and backup policy

The model volume is **reconstructable cache**. It can be repopulated with `ollama pull`; it is not included in the foundation backup.

Never place these on the desktop worker:

- project databases;
- uploads;
- student records;
- provider secrets unrelated to inference;
- the OCI registry;
- platform audit data; or
- the only copy of a custom model.

Custom model weights that cannot be fetched again belong in encrypted, versioned object storage. The worker receives a deployable copy.

## Observability and capacity

Minimum signals:

- status `/readyz` every 30 seconds;
- unavailable after 90 seconds;
- inference request count, errors, queue depth, and latency;
- `nvidia-smi` temperature, power, utilization, and VRAM;
- disk pressure on the model volume; and
- Tailscale connectivity.

Start with one active request and queue length 16. Reject excess work with a retryable response rather than exhausting VRAM.

## Security summary

- No public tunnel to Ollama.
- No office-LAN bind.
- No Docker socket in either container.
- No durable project data.
- No student access to node addresses.
- No scheduling until remote validation and ACL review.
- No hostile multi-tenancy claim.

## Official references

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [NVIDIA Container Toolkit installation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [Ollama Docker and NVIDIA GPU setup](https://docs.ollama.com/docker)
- [Tailscale Linux installation](https://tailscale.com/docs/install/linux)
