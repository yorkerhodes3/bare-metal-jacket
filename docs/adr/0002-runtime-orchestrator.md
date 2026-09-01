# ADR 0002: Use a Docker Engine adapter for the first vertical slice

- Status: Proposed
- Date: 2026-08-28

## Context

The first milestone must deploy one Dockerfile-based service to one Linux host with TLS, readiness-gated activation, logs, and rollback. Adopting a distributed scheduler before those contracts are proven would add operational complexity without exercising a current requirement.

The design must not couple the public API directly to Docker Engine or expose a general-purpose Docker endpoint.

## Decision

Implement a versioned runtime adapter backed by a local node agent and Docker Engine for Phase 1.

The node agent receives a narrow workload specification and supports only these idempotent operations:

- ensure candidate workload;
- inspect workload and health;
- activate or deactivate route membership;
- drain and stop workload;
- stream bounded logs; and
- reconcile desired generation.

Only the node agent accesses the local Docker socket. The API and worker do not. Workloads cannot request privileged mode, host namespaces, arbitrary host mounts, or the Docker socket.

## Consequences

- The smallest production-shaped path can be tested on one host.
- Docker-specific identifiers and behavior remain behind an adapter.
- Multi-node placement, rescheduling, and quorum are deferred.
- The node agent becomes a high-value privileged component requiring a narrow protocol and security review.

## Revisit triggers

Evaluate SwarmKit, Nomad, and Kubernetes when one or more are required:

- placement across multiple failure domains;
- automatic rescheduling after node loss;
- coordinated rolling updates across replicas;
- CSI-backed portable storage;
- mature network policy; or
- capacity-aware scheduling beyond the local agent.

Nomad 1.7 and later are Business Source License software. Any use in a commercial platform that could be considered competitive requires legal review before adoption.

The provisional GPU inference pool does not change this decision. An inference worker exposes a private model endpoint plus read-only health and inventory; it cannot receive general workload specifications or access Docker through the network. Model placement remains explicit and manual until the node-agent protocol and scheduler are implemented.
