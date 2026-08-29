# Minimum lab service level

## Purpose

This is an internal operating target for real backends used by Ethical Tech CoLab Pages applications. It is not a customer SLA and has no financial remedy.

The first service level assumes one B3IQ node. A single node, one network path, and one tunnel cannot provide high availability. The goal is a predictable, observable service that fails clearly and can be recovered from independent data.

## Availability target

| Objective                    | Lab target                                             |
| ---------------------------- | ------------------------------------------------------ |
| Monthly successful readiness | 99.0%                                                  |
| Readiness probe              | HTTPS `GET /readyz`, 2xx within 5 seconds              |
| Probe interval               | 5-15 minutes from outside B3IQ                         |
| Alert threshold              | 3 consecutive failures                                 |
| Container/process RTO        | 15 minutes                                             |
| Host/tunnel RTO              | 4 hours                                                |
| Foundation-data RPO          | 24 hours                                               |
| Backup schedule              | Daily                                                  |
| Restore drill                | Monthly until three consecutive passes, then quarterly |
| Planned maintenance notice   | 24 hours when practical                                |

99.0% permits about 7 hours 18 minutes of unavailability in a 30-day month. If the lab needs a stronger target, add a second independent node and durable external data services before changing the number.

## Service indicators

Track these separately:

1. **Edge availability:** DNS, TLS, tunnel, Traefik, and readiness all succeed.
2. **API success:** valid representative requests return the expected response.
3. **Latency:** p50 and p95 for ordinary and AI requests.
4. **Freshness:** age of the newest verified off-host backup.
5. **Recovery:** elapsed time for actual restart and restore drills.

A green process on the node does not count as available when the public edge is unreachable.

## Minimum topology

```text
GitHub Pages
     |
stable DNS + named Cloudflare Tunnel
     |
Traefik on loopback
     |
backend container
     +---- PostgreSQL named volume
     +---- S3-compatible object storage, when uploads exist
     `---- local model endpoint, when required

External probe ----------> /readyz and representative safe request
Daily backup ------------> independent encrypted storage
```

Requirements:

- B3IQ remains in a mode that preserves SSH and the workload network.
- Docker starts at boot and workloads use `unless-stopped`.
- The tunnel is a pre-created named tunnel with a stable hostname.
- Quick tunnels are restricted to demonstrations.
- All non-edge ports bind to loopback or internal networks.
- The backend has an explicit owner and alert destination.

## Startup and maintenance

The service is always on; there is no scale-to-zero warm-up.

During a normal container restart, the old route should remain until a candidate is ready once the Phase 1 release controller exists. The current Compose foundation cannot provide an overlapping release automatically, so maintenance that recreates the only backend can create a short outage.

During host reboot:

1. Docker starts through systemd.
2. Containers with `unless-stopped` restart.
3. The named tunnel service restarts.
4. External readiness must pass before the incident is closed.
5. AI services may remain unready until the local model runtime and model are loaded.

The Pages UI should preserve input and show a maintenance/unavailable state rather than appearing broken.

## Backup policy

### What is protected

- PostgreSQL through a portable custom-format logical dump;
- Redis persistence through a quiesced named-volume archive;
- the OCI registry through a quiesced named-volume archive;
- a manifest with source revision, runtime versions, file sizes, and SHA-256;
- application object storage through its own versioned bucket policy; and
- secrets through a separate encrypted secret-management process.

### What is rebuilt

- containers;
- Docker networks;
- Traefik;
- application images with reproducible source and Dockerfiles; and
- caches and temporary build data.

### Copies and retention

Use the 3-2-1 principle:

- working data on the B3IQ host;
- one verified backup copy on different media or a different host; and
- one encrypted copy outside the B3IQ failure domain.

For the lab, retain:

- 7 daily backups;
- 5 weekly backups; and
- 3 monthly backups.

Local `/var/backups` is a staging copy, not disaster recovery. A scheduled job must replicate it to an encrypted S3-compatible bucket or another independently administered host. Backup credentials should be able to create new objects but not delete older protected generations.

## Monitoring and response

The repository's `Lab backend monitor` workflow exercises discovery, health, model catalog, CORS, and disallowed-origin behavior from outside B3IQ. GitHub schedules are best-effort, so production monitoring should eventually move to an independent uptime service.

Severity:

| Level | Condition                                                           | Response                                                                             |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| SEV-1 | Data loss, secret disclosure, or unauthorized action                | Disable affected route, preserve evidence, rotate credentials, notify security owner |
| SEV-2 | Backend unavailable for 15 minutes or backup older than 36 hours    | Page service owner and begin recovery                                                |
| SEV-3 | Elevated latency, one failed probe, or degraded optional dependency | Investigate during working hours                                                     |

## Launch gates

The service is minimally usable for a real Pages backend only when all are true:

- named tunnel and stable DNS are active;
- 24 hours of external probes pass;
- a daily backup and an off-host copy have been verified;
- restart recovery passes;
- a clean disposable PostgreSQL restore passes;
- Pages error and maintenance states are tested;
- provider secrets are absent from Git and browser traffic;
- blocked-origin and rate-limit tests pass; and
- owner, alert destination, RPO, and RTO are recorded.

The current quick-tunnel `pages-ai-proxy` is a functional canary, but it does not pass the named-tunnel launch gate and therefore should not be described as a 99.0% service.
