---
name: ethical-tech-colab-backend
description: Add the minimum safe Ethical Tech CoLab backend to a GitHub Pages project, choosing shared AI/forms capabilities or a reviewed dedicated container without exposing secrets.
---

# Ethical Tech CoLab Backend

Use this skill when a CoLab student says their GitHub Pages project needs AI, a secret API call, form storage, durable data, authentication, uploads, scheduled work, or another server-side feature.

The goal is **not** to add infrastructure by default. Preserve the GitHub Pages workflow and choose the smallest backend tier that satisfies the actual requirement.

## Non-negotiable rules

- Never place provider keys, database credentials, private bearer tokens, tunnel credentials, or `.env` values in a Pages repository or browser JavaScript.
- CORS is not authentication. It only controls which browser origins may read responses.
- A project slug, Pages path, public project key, or `Referer` header is not authentication. All CoLab project pages share one origin, and non-browser clients can supply headers. Use these only for routing and best-effort attribution.
- Never add an unrestricted fetch proxy, SQL endpoint, shell endpoint, Docker socket, privileged container, or arbitrary host mount.
- Never claim data is permanent merely because it uses a Docker volume. Host loss requires a verified off-host backup.
- Never claim the current quick-tunnel AI proxy meets an uptime SLA. Always use discovery so tunnel rotation is transparent.
- Do not collect personal or sensitive data in the shared tier. Route it to dedicated review.
- Do not invent an API that is not live. `ai.chat` is live today; `forms.submit` is a proposed shared capability and requires operator confirmation.

## Step 1: Identify the real need

Inspect the project before editing it. Record:

1. GitHub repository URL and Pages URL.
2. The exact server-side action.
3. Whether data is public, internal, personal, or sensitive.
4. Whether data may be lost.
5. Expected traffic and response time.
6. Whether work must continue after the browser closes.
7. Whether a standard shared capability can satisfy the request.

Ask no infrastructure question the student cannot answer. Translate their product need into the decision below.

## Step 2: Choose the tier

### Tier 0: Pages only

Use no backend for static content, client-side visualization, public read-only files, or browser-local preferences.

Do not add a backend merely to serve JSON or images that can be committed.

### Tier 1: Shared lab backend — default

Use the shared tier when all are true:

- the project stays on GitHub Pages;
- a documented shared capability satisfies the need;
- the project does not handle personal or sensitive data;
- no custom binary, framework, background worker, or private network service is required; and
- lab-level availability and quota are acceptable.

Capabilities:

| Capability     | Status   | Use                                                      |
| -------------- | -------- | -------------------------------------------------------- |
| `ai.chat`      | Live     | Server-side model access without exposing a provider key |
| `forms.submit` | Proposed | Append-only validated form submissions with daily backup |

If only `ai.chat` is needed, integrate immediately. If `forms.submit` is requested, scaffold the manifest and request operator enablement; do not fake persistence in local storage.

### Tier 2: Dedicated container

Use dedicated review when the project needs any of:

- custom API routes or server framework;
- user accounts or server-enforced authorization;
- personal or sensitive data;
- durable relational application state;
- uploads or object storage;
- WebSockets, streaming sessions, or long-running/background jobs;
- custom system libraries or binaries;
- more than the shared quota; or
- independent deploy/restart behavior.

A dedicated container is still on the single lab node unless an operator approves another target. It receives a private Docker network, health-gated Traefik route, explicit CPU/memory limits, declared storage, daily backup, and the same lab service level.

## Step 3: Add the project manifest

Create `.lab/backend.json` using:

```text
https://yorkerhodes3.github.io/bare-metal-jacket/schemas/lab-backend-project.schema.json
```

Minimal shared example:

```json
{
  "$schema": "https://yorkerhodes3.github.io/bare-metal-jacket/schemas/lab-backend-project.schema.json",
  "apiVersion": "baremetaljacket.dev/v1alpha1",
  "kind": "LabBackendProject",
  "metadata": {
    "slug": "my-project",
    "displayName": "My Project",
    "repository": "https://github.com/Ethical-Tech-CoLab/my-project",
    "owner": "github-username"
  },
  "spec": {
    "tier": "shared",
    "pages": {
      "origin": "https://ethical-tech-colab.github.io",
      "path": "/my-project/"
    },
    "capabilities": ["ai.chat"],
    "data": {
      "classification": "public",
      "containsPersonalData": false,
      "durability": "ephemeral"
    },
    "serviceLevel": "lab-99"
  }
}
```

If this repository has Bare Metal Jacket checked out nearby, the operator can scaffold it with:

```bash
npm run scaffold:lab-project -- \
  --slug my-project \
  --name "My Project" \
  --repository https://github.com/Ethical-Tech-CoLab/my-project \
  --owner github-username
```

Validate:

```bash
node scripts/validate-lab-project.mjs .lab/backend.json
```

If the student repository does not contain those scripts, validate against the published JSON Schema through the editor or ask the operator to validate during review.

## Step 4: Integrate the shared browser helper

Import the published ES module:

```js
import {
  createLabBackend,
  LabBackendError,
} from "https://yorkerhodes3.github.io/bare-metal-jacket/sdk/lab-backend.js";

const backend = await createLabBackend({
  project: "my-project",
});
```

The helper reads the current discovery document. Never hardcode the generated `trycloudflare.com` hostname.

The `project` value labels the request and selects registered policy. It is public and must not authorize private data, billable usage without a global cap, or administrative action. Anonymous shared capabilities require global/per-source rate limits and spending limits. Strong project or user identity requires OIDC or a dedicated authenticated design.

The current compatibility discovery supports `ai.chat`. The future v1 discovery contract is:

```json
{
  "$schema": "https://yorkerhodes3.github.io/bare-metal-jacket/schemas/lab-backend-discovery.schema.json",
  "schemaVersion": 1,
  "project": "my-project",
  "mode": "shared",
  "capabilities": ["ai.chat", "forms.submit"],
  "endpoints": {
    "health": "https://api.lab.example.org/healthz",
    "config": "https://api.lab.example.org/v1/projects/my-project/config",
    "models": "https://api.lab.example.org/v1/projects/my-project/ai/models",
    "aiChat": "https://api.lab.example.org/v1/projects/my-project/ai/chat",
    "formSubmissions": "https://api.lab.example.org/v1/projects/{project}/forms/{form}/submissions"
  },
  "updatedAt": "2026-08-29T00:00:00Z"
}
```

`formSubmissions` is a URI template and is v1-only. Do not add it to the legacy AI proxy document.

AI example:

```js
const models = await backend.models();
const result = await backend.chat({
  model: models[0].id,
  messages: [{ role: "user", content: "Summarize this public text." }],
  maxTokens: 300,
  signal: controller.signal,
});

const answer = result.choices[0].message.content;
```

Handle errors:

```js
try {
  // Call the backend.
} catch (error) {
  if (error instanceof LabBackendError && error.retryable) {
    showRetryState();
  } else {
    showActionableError(error.message);
  }
}
```

The UI must include:

- connecting state;
- progress and cancel for AI;
- unavailable state that preserves user input;
- rate-limit state;
- explicit retry;
- no infinite automatic write retry; and
- an offline/non-AI path when the feature is optional.

Create an `AbortController` for each AI request and connect the UI's cancel button to `controller.abort()`. Treat `LabBackendError.kind === "cancelled"` as a user action, not an outage.

## Step 5: Prepare a dedicated container

The project agent owns application code. The lab operator owns host, route, secrets, and backup.

The project repository must include:

1. A Dockerfile that runs as a numeric non-root user.
2. A process that binds to `0.0.0.0:$PORT`.
3. `GET /healthz` for process liveness.
4. `GET /readyz` for required dependencies and schema readiness.
5. API routes under `/v1`.
6. A `.dockerignore`.
7. No secrets or production URLs.
8. Tests for validation, authorization, and failure behavior.
9. `.lab/backend.json` with `tier: dedicated`.
10. Explicit storage declarations. Use no storage if data is ephemeral.

Starter dedicated manifest fragment:

```json
{
  "tier": "dedicated",
  "capabilities": ["custom.api"],
  "data": {
    "classification": "internal",
    "containsPersonalData": false,
    "durability": "daily-backup"
  },
  "dedicated": {
    "dockerfile": "Dockerfile",
    "port": 8080,
    "healthPath": "/healthz",
    "readinessPath": "/readyz",
    "cpuMillis": 500,
    "memoryMiB": 512,
    "storage": []
  }
}
```

Do not request a volume for source code, cache, build output, or dependencies. Request storage only for declared authoritative data that cannot move to PostgreSQL or object storage.

## Step 6: Open the operator request

Use:

```text
https://github.com/yorkerhodes3/bare-metal-jacket/issues/new?template=lab_backend_request.yml
```

Attach or link `.lab/backend.json`. Do not paste secrets into the issue.

The operator:

- validates data class and capability;
- confirms quota and retention;
- registers shared project policy or reviews the Dockerfile;
- provides secret names through the host secret store;
- deploys behind health-gated HTTPS;
- verifies the Pages origin;
- adds external monitoring; and
- confirms backup/restore evidence before durable use.

## Step 7: Verify from the Pages application

For shared AI:

```bash
npm run smoke:b3iq-proxy
```

In the student project, test:

1. Pages origin succeeds.
2. Another origin is rejected.
3. No provider secret appears in source, network requests, logs, or built files.
4. Tunnel rotation does not require a code change.
5. Unavailability preserves user work.
6. Model requests have bounded tokens and a cancel path.

For dedicated services, the operator also tests container restart, host reboot, daily backup, off-host copy, and clean restore.

## What to tell the student

Use plain language:

- “Your website remains free static hosting on GitHub Pages.”
- “The lab backend performs only the small server-side action your browser cannot safely do.”
- “No secret is stored in your website.”
- “The shared service is best-effort lab infrastructure, not commercial hosting.”
- “If you need accounts, sensitive data, uploads, or custom server behavior, your project gets a reviewed container instead.”

## References

- Student guide: `docs/guides/lab-backend-for-students.md`
- Browser backend guide: `docs/guides/pages-backend.md`
- Service level: `docs/operations/lab-service-level.md`
- Backup and restore: `docs/operations/backup-and-restore.md`
- Shared API proposal: `openapi/lab-gateway.yaml`
