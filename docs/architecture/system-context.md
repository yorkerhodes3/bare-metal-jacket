# System context

## Scope

The platform turns an authorized Git commit or OCI image reference into a health-checked HTTPS workload on organization-controlled Linux servers.

The Phase 1 architecture supports one trusted organization and one Docker node. Component boundaries are designed so builds and runtime scheduling can move to dedicated nodes later without changing the developer-facing resource model.

## People and external systems

| Actor or system        | Relationship                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Developer              | Creates projects and services, configures deployments, views logs, and initiates rollback. |
| Platform operator      | Manages hosts, policy, recovery, registry retention, and privileged credentials.           |
| GitHub                 | Provides repository authorization, immutable commit content, and signed webhook events.    |
| OIDC provider          | Authenticates developers and operators.                                                    |
| DNS and ACME providers | Prove domain control and issue TLS certificates.                                           |
| Backup target          | Stores encrypted database, registry, and configuration backups outside the platform host.  |

## Logical components

### Console

Presents project, environment, service, deployment, domain, and log workflows. It has no direct database or infrastructure access.

### Control-plane API

Authenticates and authorizes requests, validates contracts, stores desired state, records audit events, and creates durable jobs. It never performs an unbounded Docker operation.

### Worker

Claims leased jobs and coordinates state transitions. It calls build and runtime adapters with idempotency keys, resumes interrupted operations, and records diagnostic output.

### Build adapter and BuildKit worker

Fetch an authorized commit, build it in an isolated context, publish the image, and return its digest and provenance. Build completion cannot activate a release.

### OCI registry

Stores immutable release images by digest. Tag mutation must not change a recorded release.

### Node agent

Receives an authorized workload specification, reconciles Docker resources, performs health observations, and reports actual state. It is the only project component with local Docker Engine access.

### Edge proxy

Routes only to active, healthy release endpoints and manages the ACME certificate lifecycle. The initial local demo uses Traefik's file provider rather than mounting the Docker socket.

### PostgreSQL and durable jobs

PostgreSQL is the source of truth for resources, releases, job leases, state transitions, and audit events. Redis can support short-lived coordination but must not be the only copy of durable state.

### Observability pipeline

OpenTelemetry-compatible instrumentation emits correlated logs, metrics, and traces. Audit records are separate from mutable operational logs.

## Deployment flow

1. GitHub sends a signed webhook for a configured repository and branch.
2. The API verifies signature, installation, repository, branch, delivery identifier, and commit identity.
3. A transaction creates a deployment and durable build job.
4. A worker leases the job and asks the build adapter to build the authorized commit.
5. BuildKit publishes an image; the adapter records its digest, source commit, timestamps, and provenance.
6. A release candidate is created separately from the build record.
7. The runtime adapter asks the node agent to start the digest-addressed candidate with declared limits.
8. The node agent and edge proxy observe readiness for the configured stability window.
9. A transaction activates the candidate, updates routing, and records an audit event.
10. The previous release drains but remains available for the configured rollback window.

Every transition is monotonic, attributable, and safe to retry. A failed candidate leaves the previous healthy release active.

## Deployment state

```text
queued
  -> cloning
  -> building
  -> scanning
  -> publishing
  -> scheduling
  -> starting
  -> health_checking
  -> active
```

Terminal failures preserve the phase, normalized reason, and diagnostic reference. Cancellation is a requested state until the responsible adapter confirms it.

## Trust boundaries

1. Browser to API: untrusted network; OIDC session, CSRF protection, authorization, and rate limits.
2. GitHub to webhook: public network; HMAC signature, replay prevention, installation and repository checks.
3. API to data stores: service identity and encrypted transport on non-local networks.
4. Worker to build adapter: untrusted source enters an execution environment; strict resource and network policy.
5. Worker to node agent: privileged operation boundary; mutual authentication, authorization, replay protection, and narrow verbs.
6. Workload to host: untrusted process; no Docker socket, no host PID or network namespace, minimized capabilities, and enforced limits.
7. Edge to workload: only declared ports of active releases are routable.
8. Platform to backup target: encrypted, scoped credentials and restore-tested artifacts.

## Single-node physical model

For the first demonstration, the control plane, backing services, build worker, and runtime share one host but run as separate service identities and containers. This validates workflow, not hostile isolation. Before external tenants or untrusted build users are admitted, builds must move to dedicated disposable workers and the isolation model must be reassessed.

## Invariants

- User input cannot select an arbitrary host path, Docker socket, privileged mode, or capability.
- Runtime images are pulled and recorded by digest.
- Secrets are referenced, not returned after creation, and are redacted before logging.
- Release activation requires readiness and an unchanged desired generation.
- Rollback creates an auditable transition to a retained immutable release.
- The worker may retry an operation without creating duplicate workloads or activations.
- Restarting the control plane converges actual state toward desired state.

## Open design questions

- OIDC provider and organization-to-role mapping
- Durable job implementation within PostgreSQL
- Secret envelope-encryption key ownership and rotation
- Build network egress policy and cache architecture
- Registry authentication, retention, garbage collection, and backup consistency
- Persistent volume ownership and release compatibility
- Domain verification and DNS automation
- Runtime adapter protocol and multi-node scheduler threshold
