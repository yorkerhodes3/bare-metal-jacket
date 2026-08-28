# Control-plane API

The control plane will authenticate users, authorize resource operations, store desired state, and enqueue durable work.

Its initial external contract is [the OpenAPI document](../../openapi/control-plane.yaml). Request handlers must not receive Docker, BuildKit, registry administration, or host-level credentials.
