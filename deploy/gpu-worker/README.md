# GPU inference worker

This bundle prepares a private, stateless NVIDIA inference worker:

- Ollama 0.31.1 with one loaded model and one parallel request;
- GPU access through NVIDIA Container Toolkit;
- explicit binding to a Tailscale address;
- a read-only status endpoint without Docker access;
- a reconstructable model-cache volume; and
- systemd boot persistence.

Do not bind `BMJ_BIND_ADDRESS` to `0.0.0.0`, an office LAN address, or a public interface.

Start with [the RTX 3090 runbook](../../docs/operations/add-gpu-worker.md). The node remains scheduling-disabled until the control node verifies it remotely.
