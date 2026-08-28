# ADR 0001: Start with trusted single-organization tenancy

- Status: Accepted for MVP
- Date: 2026-08-28

## Context

Container and build isolation that is appropriate for trusted internal users is not automatically safe for hostile public tenants. Public multi-tenancy changes identity, authorization, network egress, kernel isolation, abuse prevention, quotas, incident response, and compliance requirements.

The concept explicitly excludes public multi-tenancy from the first release.

## Decision

The MVP serves one organization whose authenticated users are trusted not to intentionally attack the platform. Project-level roles are still enforced and administrative operations remain distinct from developer operations.

Application source, build steps, images, and runtime processes are treated as untrusted even when their human owners are trusted.

The product must display this tenancy boundary in operator documentation and must not claim public multi-tenant isolation.

## Consequences

- Phase 1 can validate developer workflows without pretending Docker is a hostile-tenant sandbox.
- Authorization resources are retained so moving to multiple organizations does not require removing implicit access.
- Build and runtime isolation remain mandatory because compromised dependencies and accidental unsafe images are credible.
- External tenants require a new ADR, threat-model review, isolation testing, quotas, abuse controls, and likely dedicated execution boundaries.
