# Deployment assets

- [compose/](./compose/) is the single-node development foundation.
- `systemd/` and scheduler-specific deployment assets will be added only after the runtime ADR is accepted.

Production deployment must use generated secrets, authenticated registry access, encrypted transport, host hardening, and an external backup destination.
