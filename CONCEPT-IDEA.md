# Concept: Self-Hosted Developer Platform on Bare Metal

## Purpose

Build a developer platform with the simplicity of Render or Railway while running Docker workloads on organization-controlled bare-metal infrastructure. The platform should provide Git-based deployments, managed application configuration, domains and TLS, logs, health checks, persistent storage, and repeatable operations without forcing the build team to begin with Kubernetes.

## Product Vision

A developer connects a repository, selects a branch and deployment type, supplies configuration, and receives a running HTTPS service. The platform hides routine infrastructure work while preserving operational control, portability, and transparent costs.

```text
Git push
  -> webhook
  -> build queue
  -> BuildKit image build
  -> private container registry
  -> scheduler
  -> health checks
  -> release activation
  -> HTTPS routing
```

## Design Principles

1. **Docker-native:** Accept a Dockerfile or a prebuilt OCI image.
2. **Bare-metal first:** Run on owned or leased Linux servers without requiring a hyperscaler.
3. **Simple before distributed:** Validate the product on one node, then add scheduling and high availability.
4. **Explicit contracts:** Treat application configuration, health checks, storage, networking, and release state as versioned contracts.
5. **Safe releases:** Build immutable images, retain release history, verify health, and support rollback.
6. **Strong tenant boundaries:** Never expose an unrestricted Docker socket to users or application containers.
7. **Observable by default:** Centralize deployment events, logs, metrics, traces, and audit records.
8. **Portable components:** Prefer OCI images and replaceable open-source infrastructure.

## Platform Model

The service consists of five layers:

### 1. Developer Experience

- GitHub or GitLab repository connection
- Project and environment dashboard
- Dockerfile and image deployments
- Environment variables and secret references
- Custom domains
- Deployment logs and runtime logs
- Manual deploy, redeploy, rollback, restart, and cancel controls
- CLI and API after the dashboard workflow is stable

### 2. Control Plane

The control plane stores desired state and coordinates all operations.

Core resources:

```text
User
Organization
Project
Service
Environment
Deployment
Release
Domain
Secret
Volume
Node
Build
AuditEvent
```

Suggested implementation:

- Web UI: Next.js
- API: Go, NestJS, or another strongly supported service framework
- System database: PostgreSQL
- Queue and short-lived coordination: Redis, NATS, or PostgreSQL-backed jobs
- Authentication: OIDC-compatible identity provider

### 3. Build Plane

Responsibilities:

- Clone an authorized commit
- Build with BuildKit in an isolated worker
- Stream build output
- Tag the image with an immutable release identifier
- Push to a private registry
- Record source commit, image digest, timestamps, and build outcome
- Apply dependency and image scanning policies before promotion

The initial version should support Dockerfile builds only. Native buildpacks can be added later.

### 4. Runtime Plane

Responsibilities:

- Pull images by digest
- Start workloads with declared CPU and memory limits
- Inject configuration securely
- attach networks and persistent volumes
- Run health checks
- Report actual state to the control plane
- Drain, stop, replace, and roll back releases

Start with Docker Engine on a single Linux node. For multiple nodes, evaluate Nomad, Docker Swarm, or Kubernetes against concrete scheduling, isolation, networking, and operational requirements rather than adopting Kubernetes by default.

### 5. Edge and Observability

- Reverse proxy and ingress: Traefik or Caddy
- Automatic TLS: ACME-compatible certificate workflow
- Metrics: Prometheus-compatible collection
- Dashboards: Grafana
- Logs: Loki or another centralized log store
- Tracing: OpenTelemetry
- Object storage: MinIO or compatible S3 storage
- Alerts: node health, failed deployments, certificate renewal, storage pressure, and error-rate thresholds

## Reference Architecture

```text
                     Developers
                         |
                  Web UI / CLI / API
                         |
              +----------+----------+
              |     Control Plane   |
              | PostgreSQL + Queue  |
              +----+-----------+----+
                   |           |
              Build jobs   Runtime jobs
                   |           |
             BuildKit pool  Scheduler/agent
                   |           |
             OCI registry   Docker nodes
                               |
                         Traefik/Caddy
                               |
                            Internet

Shared services: secrets, object storage, logs, metrics, traces, audit records
```

## Deployment State Machine

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

Failure states should identify the failed phase and preserve diagnostic output. Activating a release must be separate from successfully building it.

## Zero-Downtime Release Strategy

1. Build and publish a new immutable image.
2. Start the candidate container on a new internal endpoint.
3. Wait for readiness and stability checks.
4. Add the candidate to the proxy route.
5. Drain the previous release.
6. Retain the prior release for immediate rollback.
7. Stop it after the configured rollback window.

Do not advertise zero downtime for workloads that cannot run concurrently, use incompatible database migrations, or depend on exclusive volumes.

## Security Baseline

- Separate control-plane, build, and runtime privileges.
- Do not mount the host Docker socket into customer workloads.
- Use rootless containers where practical and remove unnecessary Linux capabilities.
- Enforce CPU, memory, process, storage, and network limits.
- Encrypt secrets at rest and prevent their appearance in logs.
- Use short-lived repository credentials and scoped registry credentials.
- Sign or attest release artifacts and store the image digest.
- Scan dependencies and container images.
- Maintain immutable audit events for administrative and deployment actions.
- Define backup, restore, host rebuild, and tenant offboarding procedures.
- Treat multi-tenant isolation as a dedicated security workstream, not an incidental Docker configuration.

## MVP Scope

### Include

- One Ubuntu or equivalent Linux server
- Docker Engine
- Traefik or Caddy
- BuildKit
- Private OCI registry
- PostgreSQL
- Repository webhook integration
- Dockerfile-based deploys
- Environment variables and encrypted secrets
- Custom domains and automatic TLS
- HTTP health checks
- Build and application logs
- Deployment history and one-click rollback
- Basic CPU and memory limits
- Backup and restore runbook

### Exclude Initially

- Public multi-tenancy
- Autoscaling
- Multiple geographic regions
- Managed database products
- GPU scheduling
- Kubernetes
- Usage-based billing
- Organization-wide marketplace templates
- Complex buildpacks
- Arbitrary privileged containers

## Delivery Phases

### Phase 0: Product and Threat Definition

- Define target users and trust boundaries.
- Decide whether the first release is internal, single-tenant, or multi-tenant.
- Write the service resource schema and deployment state machine.
- Define recovery objectives, supported workloads, and explicit non-goals.
- Produce a threat model and abuse cases.

### Phase 1: Single-Node Vertical Slice

- Connect a repository.
- Receive a webhook.
- Build an image.
- Publish it to the registry.
- Run it with limits.
- Route an HTTPS hostname.
- Display logs and deployment status.
- Roll back to the preceding release.

### Phase 2: Production Foundations

- Harden authentication and authorization.
- Add encrypted secret handling.
- Centralize metrics, logs, and audit events.
- Automate backups and test restoration.
- Add vulnerability policies and release attestations.
- Implement node reconciliation and orphan cleanup.

### Phase 3: Multi-Node Operation

- Introduce scheduler abstraction.
- Add node registration, heartbeats, labels, capacity, draining, and placement.
- Replicate or externalize control-plane dependencies.
- Test node loss, network partitions, registry failure, and storage recovery.

### Phase 4: Platform Services

- Database and cache templates
- Scheduled jobs and background workers
- Preview environments
- Autoscaling where metrics and workload behavior support it
- Quotas, metering, and chargeback
- Policy-driven regional or hardware placement

## Build Versus Adopt

Before writing the full platform, deploy representative workloads with Coolify, Dokploy, CapRover, and Kamal. Record where each tool satisfies or blocks requirements.

Adopt commodity infrastructure for proxying, certificates, registries, telemetry, and scheduling. Build the differentiating control plane, policy system, workflow, and user experience only where existing projects do not meet the product goal.

## Suggested Repository Layout

```text
platform/
├── apps/
│   ├── console/
│   ├── api/
│   ├── worker/
│   └── node-agent/
├── packages/
│   ├── contracts/
│   ├── auth/
│   ├── events/
│   └── observability/
├── deploy/
│   ├── compose/
│   ├── nomad/
│   └── systemd/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── operations/
│   ├── security/
│   └── api/
├── examples/
│   ├── hello-docker/
│   ├── background-worker/
│   └── persistent-service/
├── tests/
│   ├── integration/
│   ├── failure/
│   └── security/
└── CONCEPT-IDEA.md
```

## Initial Engineering Epics

1. Identity, organizations, projects, and RBAC
2. Repository integration and webhook validation
3. Build worker isolation and BuildKit execution
4. Registry publication and release provenance
5. Runtime node agent and desired-state reconciliation
6. Ingress, domain ownership, and TLS
7. Secrets and runtime configuration
8. Deployment state machine, health checks, and rollback
9. Logs, metrics, traces, events, and audit history
10. Volumes, backups, restoration, and disaster recovery
11. Resource quotas and workload isolation
12. Security testing and operational readiness

## Acceptance Criteria for the First Demonstration

- A developer can connect a sample repository without host-level access.
- A commit triggers a reproducible Docker build.
- The resulting image is stored and referenced by digest.
- A candidate release does not receive production traffic before passing readiness checks.
- The application is reachable through a generated HTTPS hostname.
- Build and runtime logs are visible from the project view.
- Secrets are not displayed in the UI or deployment logs after creation.
- A failed release leaves the prior healthy release active.
- The operator can roll back through the UI or API.
- Restarting the control plane causes reconciliation rather than duplicated workloads.
- Backups can be restored into a clean environment using a documented procedure.

## Key Decisions to Record as ADRs

- Single-tenant versus multi-tenant security model
- Docker Engine API access pattern
- Scheduler selection and abstraction boundary
- Build isolation strategy
- Registry selection and retention policy
- Secret encryption and key ownership
- Persistent storage model
- Network isolation and outbound traffic policy
- Release migration and rollback policy
- Backup and recovery objectives
- Licensing implications of incorporated open-source components

## Risks

- Docker isolation alone may not satisfy hostile public multi-tenancy.
- Persistent workloads complicate scheduling, rollback, and node evacuation.
- Untrusted builds can consume resources or attack the build environment.
- Automated TLS and DNS workflows can become operational dependencies.
- Database migrations can invalidate otherwise safe application rollback.
- Supporting too many runtimes early will dilute reliability.
- Building managed databases is a separate product and operations commitment.
- A polished dashboard can hide unresolved recovery and security weaknesses.

## Recommended Starting Point

Use an existing self-hosted platform to learn the operational shape, then build a narrow vertical slice around a custom control-plane API. The first milestone should deploy one Dockerfile-based web service safely on one bare-metal node with TLS, health-gated activation, observable state, and rollback. Expand only after failure recovery and host rebuilds are repeatable.

## Research Basis

- Render documentation describes Dockerfile and prebuilt-image deployments, BuildKit builds, private image storage, and zero-downtime deployment support.
- Railway positions its product around infrastructure provisioning, local development, cloud deployment, GitHub integration, Docker, and application lifecycle management.
- Relevant self-hosted patterns include Coolify, Dokploy, CapRover, Kamal, Nomad, Docker Swarm, and Kubernetes.
- Internal architecture material surfaced in research emphasizes explicit provisioning, deletion, reimaging, maintenance, sanitization, telemetry, registry, packaging, and recovery scenarios for bare-metal systems. These materials may inform enterprise-grade design but should not be copied into a public repository.

## Immediate Handoff

The build team should begin with these artifacts:

1. `docs/architecture/system-context.md`
2. `docs/security/threat-model.md`
3. `docs/adr/0001-tenancy-model.md`
4. `docs/adr/0002-runtime-orchestrator.md`
5. `docs/adr/0003-build-isolation.md`
6. `openapi/control-plane.yaml`
7. `deploy/compose/docker-compose.yml`
8. `examples/hello-docker/`
9. End-to-end deployment and rollback test
10. Bare-metal rebuild and restore runbook
