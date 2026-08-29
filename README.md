# Bare Metal Jacket

> **Cloud convenience. Bare-metal control.**
> **[Explore the project dashboard](https://yorkerhodes3.github.io/bare-metal-jacket/)** - an interactive view of the architecture, product research, delivery phases, and open-source landscape.

Bare Metal Jacket is a self-hosted developer platform that brings managed-PaaS deployment workflows to organization-controlled bare-metal infrastructure. The working name describes the product's role: a protective deployment layer around hardware you own.

## Purpose

The project aims to let a developer connect a Git repository, select a branch and deployment type, provide configuration, and receive a running HTTPS service without operating the underlying infrastructure by hand.

The first implementation is deliberately Docker-native, bare-metal-first, and single-node. It will validate the complete deployment path before introducing a distributed scheduler or Kubernetes:

```text
Git push
  -> verified webhook
  -> durable build job
  -> isolated BuildKit build
  -> private OCI registry
  -> runtime reconciliation
  -> readiness checks
  -> release activation
  -> HTTPS routing
```

The platform should hide routine infrastructure work while preserving operational control, portable OCI artifacts, transparent costs, and repeatable recovery.

## Project status

This repository is in **Phase 0: product, contract, and threat definition**. It contains the initial architecture, API contract, security model, local infrastructure composition, and a deployable sample workload. It does not yet contain a production control plane.

The original concept is preserved in [CONCEPT-IDEA.md](./CONCEPT-IDEA.md).

## Design principles

1. **Docker-native:** accept a Dockerfile or a prebuilt OCI image.
2. **Bare-metal first:** run on owned or leased Linux servers.
3. **Simple before distributed:** prove one node before adding scheduling and high availability.
4. **Explicit contracts:** version service configuration, health, storage, networking, and release state.
5. **Safe releases:** build immutable images, gate activation on health, retain history, and support rollback.
6. **Strong privilege boundaries:** never expose an unrestricted Docker socket to users or workloads.
7. **Observable by default:** preserve deployment events, logs, metrics, traces, and audit records.
8. **Replaceable infrastructure:** prefer OCI images and components with understood licenses and exit paths.

## MVP

### Included

- One Linux server running Docker Engine
- GitHub webhook integration with signature and replay validation
- Dockerfile builds in an isolated BuildKit worker
- Private OCI registry with digest-addressed releases
- PostgreSQL-backed desired state and durable jobs
- Encrypted configuration and secret references
- Custom domains and automated ACME TLS
- HTTP readiness checks and health-gated activation
- Build logs, runtime logs, deployment history, and rollback
- Basic CPU and memory limits
- Backup, restore, and host-rebuild procedures

### Explicitly deferred

- Public or hostile multi-tenancy
- Autoscaling and multiple regions
- Managed database products
- GPU scheduling
- Usage-based billing
- Buildpacks and arbitrary privileged workloads
- Kubernetes

## Reference architecture

```text
Developers
    |
Console / CLI / API
    |
Control plane -------- PostgreSQL / durable jobs
    |                           |
    |                      audit/events
    |
    +---- Build adapter ---- isolated BuildKit ---- OCI registry
    |
    +---- Runtime adapter -- node agent --------- Docker Engine
                                                     |
                                              Traefik / Caddy
                                                     |
                                                  Internet
```

The control plane owns desired state. Privileged build and runtime operations happen behind narrow adapters, not in request handlers. Building an image and activating a release are separate state transitions.

See [the system context](./docs/architecture/system-context.md), [the threat model](./docs/security/threat-model.md), and [the API contract](./openapi/control-plane.yaml).

## Repository layout

```text
.
|-- apps/                    # Console, API, worker, and node-agent boundaries
|-- packages/                # Shared contracts, auth, events, and telemetry
|-- deploy/compose/          # Local single-node infrastructure and demo
|-- docs/
|   |-- adr/                 # Architecture decisions
|   |-- architecture/        # System design
|   |-- operations/          # Runbooks
|   |-- research/            # Product and repository research
|   `-- security/            # Threat model and security design
|-- examples/hello-docker/   # Minimal Dockerfile workload with health endpoints
|-- openapi/                 # Versioned control-plane contract
|-- tests/                   # Integration, failure, and security test plans
`-- CONCEPT-IDEA.md          # Original product concept
```

Application directories intentionally document boundaries without selecting every framework. The API contract and ADRs should stabilize before code generation or framework-specific scaffolding.

## Quick start

### Validate repository contracts

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run check
```

Run the sample workload test separately:

```bash
python -m unittest discover -s examples/hello-docker -p "test_*.py"
```

### Start the local foundation

Requirements: Docker Engine with Docker Compose v2.

```bash
cp deploy/compose/.env.example deploy/compose/.env
npm run preflight:deployment
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  --profile demo \
  up --build --detach --wait
npm run smoke:deployment
```

The demo is available at <http://localhost:8080>, PostgreSQL and Redis bind only to loopback, and the registry is available at `localhost:5000`.

The example credentials are for isolated local development only. Create a private environment file with generated values before connecting the stack to any shared network.

For the complete local, CI, SSH-tunneled B3IQ, Cloudflare Tunnel, and `pages-ai-proxy` canary procedures, see [deployment testing](./docs/operations/deployment-testing.md).

## Initial delivery sequence

1. Review and accept the three initial ADRs.
2. Finalize resource schemas and state-transition invariants in OpenAPI.
3. Implement GitHub App installation, webhook verification, and repository authorization.
4. Implement an isolated BuildKit adapter that records image digest and provenance.
5. Implement the single-node agent and desired-state reconciliation.
6. Integrate health-gated routing, release activation, and rollback.
7. Add log/event streaming and immutable administrative audit records.
8. Prove backup restoration and clean-host rebuild before adding nodes.

## Research summary

Research performed on 2026-08-28 used the Tavily API with advanced search constrained to official documentation and GitHub, followed by GitHub API metadata checks.

- Render and Railway establish the expected managed-PaaS workflow: repository or image sources, automated builds, managed TLS, health-aware deployments, logs and metrics, persistent storage, preview environments, and configuration as code.
- Coolify and Dokploy are the closest broad self-hosted comparators. Both combine Git and Docker workflows with a dashboard, domains, TLS, logs, storage, backups, and multi-server operation.
- CapRover and Dokku demonstrate mature, lower-complexity Docker PaaS patterns.
- Kamal is a useful deployment primitive but not a control plane or scheduler.
- Docker Engine is the smallest viable first runtime. SwarmKit, Nomad, and Kubernetes remain later-stage options subject to operational and licensing decisions.
- Nomad 1.7+ uses the Business Source License; embedding it in a competitive platform requires legal review.

The full feature matrix, repository activity snapshot, source links, caveats, and build-versus-adopt recommendations are in [the competitive landscape](./docs/research/competitive-landscape.md).

## Security

This project handles untrusted source code, builds, credentials, and privileged container operations. Read [SECURITY.md](./SECURITY.md) before reporting vulnerabilities and [the threat model](./docs/security/threat-model.md) before changing trust boundaries.

The first release is for trusted internal users on organization-controlled infrastructure. It must not be represented as safe for hostile public multi-tenancy.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Architecture-affecting changes should update an ADR, the OpenAPI contract, or both.

## License

No project license has been selected yet. Until the repository owner adds one, no rights are granted beyond those provided by applicable law.
