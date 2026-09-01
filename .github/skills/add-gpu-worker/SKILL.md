---
name: add-gpu-worker
description: Prepare and enroll a private NVIDIA desktop as a stateless Bare Metal Jacket inference worker without exposing Ollama, Docker, or durable project data.
---

# Add a Bare Metal Jacket GPU Worker

Use this skill when an operator wants to add an NVIDIA desktop or server to the Ethical Tech CoLab inference pool.

The current pool is provisional and manually routed. Do not claim automatic scheduling, failover, or high availability.

## Safety rules

- Prefer native Ubuntu 24.04 LTS. Treat Windows/WSL as qualification-only.
- Never publish Ollama or the status service to the office LAN or public internet.
- Bind both endpoints to the Tailscale IPv4 address and enforce tailnet ACLs.
- Never expose the Docker socket or Docker TCP API.
- Never put project databases, uploads, secrets, registry state, or the only copy of a model on a worker.
- Keep a new node `scheduling.state=disabled` until it passes remote B3IQ smoke tests.
- Stop if `nvidia-smi` reports an NVML/driver mismatch.
- Do not automate a GPU power limit; inspect the card's supported range and test it first.

## Required input

Collect:

- hardware owner and physical location;
- operating system;
- NVIDIA GPU model and VRAM;
- system RAM and free SSD;
- wired or Wi-Fi network;
- intended model list;
- whether firmware can restore power automatically; and
- a maintenance contact.

Do not ask a student for tailnet, Docker, or host credentials. This is an operator workflow.

## Procedure

1. Read the canonical runbook:

   <https://github.com/yorkerhodes3/bare-metal-jacket/blob/main/docs/operations/add-gpu-worker.md>

2. Prepare native Ubuntu, NVIDIA drivers, Docker Engine, NVIDIA Container Toolkit, and Tailscale using the official sources in that runbook.

3. Ensure B3IQ and the worker share a tailnet. Apply least-privilege ACLs:

   - `tag:bmj-control` may reach `tag:bmj-gpu-worker` on 11434 and 9180;
   - operators may reach SSH; and
   - no other tailnet devices receive worker access.

4. Run preflight from a fresh Bare Metal Jacket checkout:

   ```bash
   sudo bash scripts/gpu-worker-preflight.sh
   ```

   Resolve every failure. Document Wi-Fi, sleep, disk, or power warnings.

5. Install with a stable DNS-style node id:

   ```bash
   sudo bash scripts/install-gpu-worker.sh \
     --node-id office-rtx3090 \
     --display-name "Office RTX 3090"
   ```

6. Inspect `/etc/bare-metal-jacket/node.json`. Confirm:

   - private `100.x` or MagicDNS endpoints;
   - correct GPU and VRAM;
   - `role: inference-worker`;
   - `durableApplicationData: false`;
   - `maxConcurrent: 1` for a 24 GiB desktop; and
   - `scheduling.state: disabled`.

7. From B3IQ, run:

   ```bash
   export BMJ_GPU_WORKER_STATUS_URL=http://100.x.y.z:9180
   export BMJ_GPU_WORKER_INFERENCE_URL=http://100.x.y.z:11434
   node scripts/gpu-worker-smoke.mjs

   export BMJ_GPU_WORKER_LIVE=1
   export BMJ_GPU_WORKER_MODEL=qwen3:14b
   node scripts/gpu-worker-smoke.mjs
   ```

8. Add explicit server-controlled model aliases to the gateway. Use a mapping such as:

   ```json
   {
     "lab/qwen3-14b": {
       "upstream": "http://100.x.y.z:11434/v1/chat/completions",
       "model": "qwen3:14b"
     }
   }
   ```

   Never expose the private worker address to student code.

9. Test the alias through the public Pages helper with bounded tokens.

10. Change the node state to `enabled` only after every private and public test passes.

## RTX 3090 defaults

- Models: `qwen3:14b`, `gemma3:12b`, `deepseek-r1:8b`
- Loaded models: 1
- Parallel requests: 1
- Queue: 16
- Heartbeat: 30 seconds
- Unavailable after: 90 seconds
- Reliability on Wi-Fi: best effort
- Durable data: prohibited

## Drain procedure

Before maintenance:

1. set the node to `draining`;
2. remove it from new alias placement;
3. wait for active requests to finish;
4. set it to `disabled`;
5. stop `bare-metal-jacket-gpu-worker`;
6. perform maintenance;
7. rerun local preflight and B3IQ smoke; and
8. re-enable only after verification.

If the node misses three heartbeats, stop sending it traffic. The current manual pool requires operator action.

## Student-facing explanation

Tell students:

> Your Pages application still calls the shared lab backend. The lab may run an approved model on the office GPU, but your code does not know the machine address and needs no new secret or setup.

## Definition of done

- Native GPU container test passes.
- Tailscale-only endpoints are confirmed.
- Office LAN and public scans cannot reach ports 11434 or 9180.
- Hardware manifest validates.
- B3IQ readiness, inventory, catalog, and live inference pass.
- Public alias works through the shared helper.
- Node is labeled best-effort when using Wi-Fi.
- Drain and power-recovery behavior are recorded.
