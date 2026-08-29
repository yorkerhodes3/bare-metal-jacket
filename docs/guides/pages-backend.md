# Using a real backend from a GitHub Pages application

## When a Pages application needs a backend

GitHub Pages serves static files. It cannot safely hold a provider key, run server-side authorization, write a database, process a queue, or make a private network request.

Add a backend when the application needs any of these:

- secret-bearing calls to an AI, payment, email, or other provider;
- durable shared data;
- user authentication or server-enforced authorization;
- uploads or long-running work;
- rate limits, quotas, audit records, or request validation; or
- access to a local model or another service on the lab network.

Do not add a backend only to serve static JSON or assets that can be versioned with the Pages site.

## Lab request path

```text
Browser
  |
  | HTTPS request, no infrastructure secret
  v
GitHub Pages application
  |
  | fetch stable discovery document
  v
Named Cloudflare Tunnel hostname
  |
  | loopback-only origin
  v
Traefik -> backend container -> PostgreSQL / object storage / local model
```

Only the HTTPS edge is public. PostgreSQL, Redis, the registry, Docker, and administrative endpoints remain on loopback or an internal Docker network.

The current Ethical Tech CoLab `pages-ai-proxy` uses the same shape but is exposed through a Cloudflare **quick tunnel**. That is useful for experiments, not a service-level target: the hostname changes when the tunnel is recreated and Cloudflare provides no uptime guarantee.

## Stable discovery

A Pages application should not hardcode an experimental backend URL in its JavaScript bundle. Publish a small same-origin document:

```json
{
  "apiVersion": "v1",
  "backendUrl": "https://api.lab.example.org",
  "statusUrl": "https://api.lab.example.org/healthz",
  "updatedAt": "2026-08-29T00:00:00Z"
}
```

The app fetches it at startup:

```js
const discoveryResponse = await fetch("./backend.json", {
  cache: "no-store",
});

if (!discoveryResponse.ok) {
  throw new Error(`Backend discovery failed: ${discoveryResponse.status}`);
}

const discovery = await discoveryResponse.json();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);

try {
  const response = await fetch(`${discovery.backendUrl}/v1/example`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "example" }),
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  const result = await response.json();
  console.log(result);
} finally {
  clearTimeout(timeout);
}
```

A named tunnel normally makes the backend URL stable, but discovery remains useful for API-version flags, maintenance state, model catalogs, and emergency migration.

## CORS is not authentication

The backend should allow the exact Pages origin, for example:

```text
https://ethical-tech-colab.github.io
```

Every project under that organization shares the same browser origin; URL paths do not create separate CORS origins.

CORS prevents a conforming browser on another origin from reading a response. It does not prevent scripts, command-line clients, or another server from sending requests.

Choose an authorization model explicitly:

| Use case                | Minimum model                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Public read-only data   | No login; strict validation, cache, and rate limit                                            |
| Anonymous AI demo       | Origin filter plus model allowlist, body limit, global/per-IP rate limit, and spending cap    |
| User-specific data      | OIDC authorization-code flow with PKCE; server validates issuer, audience, expiry, and scopes |
| Administrative action   | OIDC plus role policy and immutable audit event                                               |
| Server-to-provider call | Provider token only in the backend secret store                                               |

Never embed a provider key, database password, long-lived bearer token, or tunnel credential in a Pages repository or browser bundle.

## Health and readiness

Every backend exposes separate endpoints:

- `GET /healthz`: the process event loop is alive;
- `GET /readyz`: the request path's required dependencies are ready; and
- a versioned API path such as `/v1/...`.

Traefik routes only to a backend that passes readiness. Readiness should include required schema compatibility and critical dependencies, but not an optional analytics or notification system.

The Pages application should present three distinct states:

1. **Connecting:** discovery or readiness is still pending.
2. **Temporarily unavailable:** timeout, 429, 502, 503, or network error; offer retry and preserve user input.
3. **Permanent request error:** 400, 401, 403, or 404; explain the corrective action instead of retrying forever.

Use exponential backoff with jitter for idempotent requests. Do not automatically replay a write unless it has an idempotency key.

## Startup and warm-up behavior

The lab service is **always on**. It does not intentionally scale to zero.

Measured observations on 2026-08-29:

| Event                                  | Observation                                       | Application implication                                        |
| -------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Warm HTTP health on B3IQ               | 1-17 ms on-host                                   | A normal API request should not have platform cold-start delay |
| Warm HTTP through local Docker Desktop | 11-145 ms                                         | Suitable for local development, not an availability target     |
| Cached sample-container restart        | About 6 seconds to healthy                        | Readiness must absorb short restarts                           |
| First Windows deployment               | About 6.5 minutes including image pulls and build | Show maintenance state during a cold host bootstrap            |
| Warm `gemma3:12b` request              | About 0.4-3.7 seconds                             | AI UI needs a longer request timeout and visible progress      |
| Earlier model/cold path                | About 4.5 seconds                                 | First inference after model eviction can be slower             |
| Fresh host rebuild                     | Budget up to 4 hours for the lab target           | Serve a clear outage state; there is no single-node failover   |

These are measurements, not guarantees. Large model loading, image pulls, schema migration, registry recovery, disk checks, or a Cloudflare connector restart can extend warm-up.

For AI calls, use a 120-second server timeout and a user-visible cancel control. For ordinary API calls, 10-30 seconds is usually sufficient.

## Ephemeral and durable data

| Data location             | Survives container restart          | Survives host reboot | Survives host loss/rebuild                                                    |
| ------------------------- | ----------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Container writable layer  | Usually until container replacement | Usually              | No                                                                            |
| Docker named volume       | Yes                                 | Yes                  | No, unless restored                                                           |
| PostgreSQL named volume   | Yes                                 | Yes                  | No, unless logical backup is restored                                         |
| Redis named volume/AOF    | Yes                                 | Yes                  | No, unless archived; treat as reconstructable unless explicitly authoritative |
| OCI registry named volume | Yes                                 | Yes                  | No, unless archived or images can be rebuilt                                  |
| Git repository            | Not runtime state                   | Yes                  | Yes, from GitHub                                                              |
| Off-host encrypted backup | N/A                                 | Yes                  | Yes                                                                           |
| Browser local storage     | Per browser only                    | Usually              | Not shared, authoritative, or guaranteed                                      |

The platform does not back up a container. Containers and images are replaceable. It backs up the authoritative data and records needed to recreate them.

Classify every new service:

- **ephemeral:** caches, temporary files, build contexts;
- **reconstructable:** registry images that can be rebuilt from pinned source;
- **durable database:** PostgreSQL or another transactional store;
- **durable objects:** uploads in S3-compatible object storage;
- **secret:** values in a secret manager or separately encrypted recovery record.

Never depend on the container writable layer for durable data.

## Backend release checklist

Before a Pages application points production-like traffic at a backend:

- stable named HTTPS tunnel and DNS;
- exact Pages origin allowlist;
- server-side authorization decision;
- rate and body-size limits;
- `/healthz` and `/readyz`;
- bounded CPU, memory, processes, and log volume;
- named volume or external datastore for declared durable data;
- daily verified backup and off-host copy;
- external probe and alert recipient;
- maintenance message or offline fallback in the Pages UI;
- tested restart and clean-host restore; and
- documented owner, data classification, RPO, and RTO.

See [the lab service level](../operations/lab-service-level.md) and [backup and restore](../operations/backup-and-restore.md).
