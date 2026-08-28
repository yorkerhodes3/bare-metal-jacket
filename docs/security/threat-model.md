# Threat model

## Scope and assumptions

This model covers the Phase 1 path from GitHub webhook through build, registry publication, runtime reconciliation, health-gated routing, logs, and rollback on one organization-controlled Linux host.

Human users are trusted members of one organization. Source code, dependencies, Dockerfiles, images, HTTP traffic, and compromised developer accounts are untrusted.

Public multi-tenancy, arbitrary privileged containers, managed databases, and multi-region operation are out of scope.

## Security objectives

- Only an authorized actor or verified repository event can change desired state.
- A build or workload cannot gain control-plane, host, registry-administration, or other tenant credentials.
- Secrets do not appear in API responses, build layers, logs, events, or support artifacts.
- Only a healthy authorized release receives traffic.
- Release artifacts and audit events remain attributable and tamper-evident.
- Platform state and artifacts can be restored without trusting a compromised host.

## Primary assets

| Asset                                   | Security property                                     |
| --------------------------------------- | ----------------------------------------------------- |
| OIDC sessions and API tokens            | Confidentiality, revocation, audience restriction     |
| GitHub App keys and installation tokens | Confidentiality, short lifetime, repository scope     |
| Secret-encryption keys                  | Confidentiality, rotation, separation from ciphertext |
| Runtime secrets                         | Confidentiality and least-privilege service scope     |
| Desired state and release records       | Integrity, ordering, recoverability                   |
| OCI images and provenance               | Integrity, immutable digest identity                  |
| Docker and BuildKit control channels    | Strong authorization and isolation                    |
| TLS and DNS credentials                 | Confidentiality and domain scope                      |
| Audit events                            | Integrity, completeness, retention                    |
| Backups                                 | Confidentiality, integrity, independent availability  |

## Threats and required controls

| Threat                               | Example                                              | Required baseline control                                                                                             | Verification evidence                                                                      |
| ------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Webhook forgery or replay            | Attacker triggers an arbitrary commit                | HMAC validation over raw body, delivery-ID uniqueness, timestamp window, installation/repository/branch checks        | Integration tests with altered body, duplicate delivery, wrong repository, and stale event |
| Authorization bypass                 | Project member performs operator action              | Deny-by-default policy at resource boundary; server-side role checks; scoped service identities                       | Policy unit tests and audit event                                                          |
| Build escape                         | Dockerfile reaches host or control credentials       | Dedicated adapter, no Docker socket in build step, rootless where possible, disposable context, limits, egress policy | Malicious-build test suite and host inspection                                             |
| Credential exfiltration during build | Dockerfile prints repository or registry token       | Short-lived fetch outside build graph; BuildKit secret mounts; log redaction; no secret build args                    | Canary-secret test absent from logs, layers, and image history                             |
| Registry substitution                | Mutable tag points to attacker image                 | Record and pull digest; scoped push/pull credentials; provenance policy                                               | Digest mismatch blocks scheduling                                                          |
| Runtime host escape                  | Workload requests privileged container or host mount | Typed allowlist contract, dropped capabilities, no host namespaces/socket, seccomp/AppArmor, limits                   | Admission tests and runtime inspection                                                     |
| Secret disclosure                    | API returns a secret or log captures it              | Write-only secret values, envelope encryption, reference injection, structured redaction                              | API schema tests and canary-secret scanning                                                |
| Premature traffic switch             | Container starts but is not ready                    | Candidate endpoint, readiness stability window, compare desired generation before atomic activation                   | Slow-start and failing-readiness end-to-end tests                                          |
| Unsafe rollback                      | Old image cannot use migrated schema or volume       | Release compatibility metadata, pre-deploy policy, operator warning, documented forward fix                           | Migration compatibility test                                                               |
| Resource exhaustion                  | Build fills disk or fork bomb runs                   | CPU, memory, PID, disk, duration, concurrency, and log-size quotas                                                    | Quota and cleanup failure tests                                                            |
| Log injection or leakage             | Workload spoofs platform event fields                | Separate trusted metadata from message, encode output, cap lines, redact before transport                             | Structured-log parser tests                                                                |
| Node-agent command forgery           | Network peer starts arbitrary image                  | Mutual identity, narrow signed request, audience and nonce, desired-generation check                                  | Replayed and unauthorized command tests                                                    |
| Control-plane restart duplication    | Lost response causes duplicate release               | Idempotency keys, unique constraints, leased jobs, reconciliation                                                     | Kill-and-restart test at every phase                                                       |
| Backup compromise                    | Host attacker deletes or alters backups              | Off-host immutable/encrypted copies, separate credentials, checksums, restore drills                                  | Scheduled clean-host restore                                                               |
| Supply-chain compromise              | Dependency or base image is malicious                | Pin digests for release infrastructure, scan images and dependencies, generate SBOM/provenance, verify policy         | CI policy and release evidence                                                             |

## Abuse cases

The implementation must explicitly test that a developer cannot:

- select an arbitrary repository outside the GitHub App installation;
- deploy a commit other than the verified event or authorized manual selection;
- mount `/`, `/var/run/docker.sock`, device nodes, or another service's volume;
- request host networking, host PID, privileged mode, or added high-risk capabilities;
- retrieve a secret after creation;
- make a failed candidate replace a healthy active release;
- keep an abandoned build consuming unbounded disk or processes; or
- read another project's logs or configuration.

## Logging and audit

Operational logs may be sampled and have finite retention. Audit events are append-only records for authentication, authorization changes, secret metadata changes, deployment requests, release activation, rollback, domain changes, node administration, and backup/restore operations.

Audit records contain actor, action, resource, result, timestamp, source, correlation identifier, and policy version. They never contain secret values or raw repository credentials.

## Security gates before Phase 2

- Threat-model review by an infrastructure security owner
- Demonstrated malicious-build containment on the selected host configuration
- Image and dependency scanning policy
- Secret canary tests across API, logs, layers, events, and backups
- Restore into a clean host from independently stored artifacts
- Key rotation and credential revocation exercises
- Node-agent protocol authorization and replay tests
- Documented incident response and tenant offboarding
