# ADR 0003: Isolate builds behind a dedicated BuildKit adapter

- Status: Proposed
- Date: 2026-08-28

## Context

Dockerfiles and build contexts can execute arbitrary commands, consume resources, contact networks, and attempt to access credentials or the host. The control plane also needs reproducible images, streaming logs, cache support, provenance, and cancellation.

Running `docker build` from an API process or mounting the host Docker socket into a build container would violate the privilege model.

## Decision

Use BuildKit through a dedicated build adapter.

For the first internal demonstration, the BuildKit daemon may share a host only if it runs under a separate service identity with rootless mode where supported, bounded CPU, memory, processes, disk, and time, and an explicit egress policy.

The adapter must:

- accept an authorized repository, immutable commit, Dockerfile path, and build policy;
- fetch source with short-lived credentials that are unavailable to Dockerfile steps;
- pass sensitive build inputs through BuildKit secret mounts, never build arguments;
- create a unique, disposable build context;
- publish to the registry and return the immutable image digest;
- record source commit, builder version, timestamps, outcome, and provenance;
- bound and redact streamed logs;
- support cancellation without reporting false success; and
- clean abandoned contexts and cache records through an auditable retention job.

Production use with untrusted contributors requires disposable dedicated workers or stronger sandboxing. Rootless BuildKit alone is not a hostile-code security boundary.

## Consequences

- Builds are decoupled from HTTP request lifetime and control-plane privilege.
- Build completion can be retried without activating a release.
- Cache, registry, and egress policy become explicit operational dependencies.
- The first shared-host demo is not evidence of public multi-tenant safety.
