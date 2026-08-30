# The CoLab backend: a student guide

## The short version

Keep your project on GitHub Pages.

When your browser cannot safely or reliably do one small thing—such as call an AI model without exposing a secret—ask the lab backend to do that thing.

Most projects should **not** create a server. They use the shared lab helper:

```js
import { createLabBackend } from "https://yorkerhodes3.github.io/bare-metal-jacket/sdk/lab-backend.js";

const backend = await createLabBackend({ project: "my-project" });
```

If your project needs its own server behavior, an agent prepares a Docker container and the lab operator deploys it. You do not need to learn Docker or administer B3IQ to request it.

## Think in three tiers

| Your project needs                                                 | Choose              | What you manage                                             |
| ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------- |
| Static pages, charts, maps, public files, browser-local settings   | Pages only          | Your repository                                             |
| AI with a hidden key or another approved small lab capability      | Shared backend      | A small manifest and browser helper                         |
| Accounts, private data, custom API, uploads, jobs, or special code | Dedicated container | Application code and tests; operator manages infrastructure |

Start at the top. Move down only when the simpler tier cannot solve the problem.

## What “minimal infrastructure” means

The lab runs shared infrastructure once:

```text
GitHub Pages projects
        |
        | one documented browser helper
        v
Shared Lab Gateway
  |-- AI chat proxy and model catalog
  |-- validated public form intake (proposed)
  |-- global/per-source limits and best-effort project attribution
  `-- no arbitrary code or arbitrary database access

Shared foundation
  |-- HTTPS ingress
  |-- PostgreSQL for declared durable data
  |-- Redis for reconstructable coordination
  |-- local B3IQ models
  |-- daily verified backups
  `-- external health monitoring
```

The student sees a small API. The lab maintains containers, networking, model credentials, backups, and host recovery.

This is deliberately not a generic “run anything” endpoint. Narrow capabilities make one shared service safer and easier to operate for many projects.

### A project name is not a password

Every `ethical-tech-colab.github.io/<project>/` page has the same browser origin: `https://ethical-tech-colab.github.io`. A project slug, URL path, public key, or `Referer` can be copied or spoofed and therefore cannot protect private data or enforce a strong identity boundary.

For anonymous shared features, the lab uses the slug for routing and observability, then protects the whole service with model allowlists, global/per-source rate limits, request-size limits, and spending caps. User-specific or sensitive actions require OIDC and dedicated review.

## What is available today

| Capability                          | Status              | Permanence                                                                         |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| AI chat with local B3IQ models      | Live                | Requests are ephemeral; your project saves outputs only if it deliberately does so |
| Model catalog and app configuration | Live                | Recreated from service configuration                                               |
| Public form submission              | Proposed shared API | Will require PostgreSQL and daily backup                                           |
| Generic shared database             | Not offered         | A generic browser-writable database is too easy to misuse                          |
| User accounts/private records       | Dedicated review    | Must have real identity and authorization                                          |
| Uploads                             | Dedicated review    | Requires object storage, content limits, and retention                             |
| Background jobs                     | Dedicated review    | Requires a queue, idempotency, and operator limits                                 |

Do not treat “proposed” as deployed. The request issue is how the lab sees demand and enables the next shared capability safely.

## The easiest agent-assisted setup

### 1. Give your agent this prompt

```text
Add the minimum Ethical Tech CoLab backend to this GitHub Pages project.
Follow this skill exactly:
https://raw.githubusercontent.com/yorkerhodes3/bare-metal-jacket/main/.github/skills/ethical-tech-colab-backend/SKILL.md

Prefer Pages-only or the shared tier. Do not add secrets to the frontend.
Do not create a dedicated container unless the skill's decision rules require it.
```

For agents that discover repository skills, install the skill:

```bash
mkdir -p .github/skills/ethical-tech-colab-backend
curl -fsSL \
  https://raw.githubusercontent.com/yorkerhodes3/bare-metal-jacket/main/.github/skills/ethical-tech-colab-backend/SKILL.md \
  -o .github/skills/ethical-tech-colab-backend/SKILL.md
```

PowerShell:

```powershell
New-Item -ItemType Directory `
  .github\skills\ethical-tech-colab-backend `
  -Force | Out-Null
Invoke-WebRequest `
  https://raw.githubusercontent.com/yorkerhodes3/bare-metal-jacket/main/.github/skills/ethical-tech-colab-backend/SKILL.md `
  -OutFile .github\skills\ethical-tech-colab-backend\SKILL.md
```

### 2. Answer product questions, not infrastructure questions

Tell the agent:

- what the user does;
- what information leaves the browser;
- whether that information is public, personal, or sensitive;
- whether losing it would matter;
- whether the work must continue after closing the page; and
- how many people might use the demo.

The skill translates those answers into a tier.

### 3. Commit the generated request

The agent creates:

```text
.lab/
|-- backend.json
`-- AGENT-HANDOFF.md
```

`backend.json` says what your project needs. It does not contain credentials.

### 4. Open one lab request

Open the [Lab backend request](https://github.com/yorkerhodes3/bare-metal-jacket/issues/new?template=lab_backend_request.yml). Link your repository and `.lab/backend.json`.

The operator approves the shared capability or reviews a dedicated container.

### 5. Test the published Pages site

Test the real `https://ethical-tech-colab.github.io/<project>/` site, not only `localhost`. The browser origin, HTTPS edge, timeout, and failure UI are part of the feature.

## Shared AI example

```html
<form id="prompt-form">
  <label for="prompt">Question</label>
  <textarea id="prompt" required></textarea>
  <button type="submit">Ask</button>
  <button id="cancel" type="button" disabled>Cancel</button>
</form>
<p id="status" role="status"></p>
<pre id="answer"></pre>

<script type="module">
  import {
    createLabBackend,
    LabBackendError,
  } from "https://yorkerhodes3.github.io/bare-metal-jacket/sdk/lab-backend.js";

  const form = document.querySelector("#prompt-form");
  const prompt = document.querySelector("#prompt");
  const status = document.querySelector("#status");
  const answer = document.querySelector("#answer");
  const cancel = document.querySelector("#cancel");
  let backend;
  let requestController;

  try {
    status.textContent = "Connecting to the lab…";
    backend = await createLabBackend({ project: "my-project" });
    status.textContent = "Ready";
  } catch {
    status.textContent = "The lab backend is temporarily unavailable.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!backend) return;

    status.textContent = "Thinking…";
    form.querySelector("button").disabled = true;
    cancel.disabled = false;
    requestController = new AbortController();

    try {
      const models = await backend.models();
      const result = await backend.chat({
        model: models[0].id,
        messages: [{ role: "user", content: prompt.value }],
        maxTokens: 300,
        signal: requestController.signal,
      });
      answer.textContent = result.choices[0].message.content;
      status.textContent = "Done";
    } catch (error) {
      if (error instanceof LabBackendError && error.kind === "cancelled") {
        status.textContent = "Cancelled. Your question is still here.";
      } else {
        status.textContent =
          error instanceof LabBackendError && error.retryable
            ? "The lab is busy or offline. Your question is still here; try again."
            : `The request could not be completed: ${error.message}`;
      }
    } finally {
      form.querySelector("button").disabled = false;
      cancel.disabled = true;
      requestController = undefined;
    }
  });

  cancel.addEventListener("click", () => requestController?.abort());
</script>
```

There is no API key in this page. The backend holds the provider or local-model access.

## What the shared API should look like

The shared gateway contract is capability-based:

```text
GET  /healthz
GET  /readyz
GET  /v1/projects/{project}/config
GET  /v1/projects/{project}/ai/models
POST /v1/projects/{project}/ai/chat
POST /v1/projects/{project}/forms/{form}/submissions
```

It does not expose generic SQL, arbitrary outbound URLs, arbitrary environment variables, or shell execution.

`{project}` selects configuration and provides best-effort attribution; it does not authenticate the caller.

The desired contract is in the [shared lab gateway OpenAPI document](https://github.com/yorkerhodes3/bare-metal-jacket/blob/main/openapi/lab-gateway.yaml). The current AI proxy uses a compatibility discovery document, and the browser helper normalizes it.

The v1 discovery document is validated by the published [lab backend discovery schema](https://yorkerhodes3.github.io/bare-metal-jacket/schemas/lab-backend-discovery.schema.json). Its endpoint keys are `health`, `config`, `models`, `aiChat`, and the v1-only form URI template `formSubmissions`.

## When your project needs its own container

You still keep the frontend on Pages:

```text
GitHub Pages frontend
        |
        v
Dedicated HTTPS route
        |
        v
Your container
  |-- /healthz
  |-- /readyz
  |-- /v1/...
  |-- declared resource limits
  `-- declared durable storage
```

Your agent adds a Dockerfile and tests. The lab operator:

- builds an immutable image;
- injects secrets on the server;
- assigns CPU and memory;
- creates a private network;
- adds a health-gated route;
- configures durable storage and backup;
- monitors the service; and
- tests restart and restore.

One dedicated container is not a separate physical server. It is an isolated service process on the lab node. A project that needs stronger isolation or availability requires a separate infrastructure review.

## Data permanence

Use this rule:

> If it matters after a demo, name where it is stored and how it is restored.

- AI requests and temporary calculations are ephemeral by default.
- Browser local storage belongs to one browser and is not a shared database.
- Container files disappear when a container is replaced.
- A Docker volume survives container replacement and reboot, but not host loss.
- PostgreSQL with a daily verified off-host backup is the lab default for durable records.
- Uploads should use object storage, not a container directory.
- Secrets use the server secret store and a separate encrypted recovery record.

The current lab target allows up to 24 hours of durable-data loss after complete host loss. Do not promise stronger permanence without a different plan.

## Availability and warm-up

The lab is always-on and does not intentionally scale to zero, but it is a single-node service:

- routine container restart: target recovery within 15 minutes;
- host or tunnel incident: target recovery within 4 hours;
- AI calls: commonly under 4 seconds when the model is warm, potentially longer after model loading;
- fresh host bootstrap: several minutes; and
- monthly readiness target: 99.0% after the named-tunnel launch gate is met.

Your page must show “temporarily unavailable” and keep the user's input. A backend outage must not destroy the rest of the static experience.

## What remains an operator task

Students and agents do not:

- SSH to B3IQ;
- edit Docker networks;
- create tunnel credentials;
- handle provider secrets;
- create database users;
- choose backup storage;
- publish arbitrary ports; or
- grant themselves a larger quota.

That boundary is what makes the experience approachable.

## Definition of done

A student integration is done when:

- `.lab/backend.json` is committed and valid;
- the Pages site has no secret;
- the helper uses discovery instead of a tunnel hostname;
- the UI handles connecting, success, rate limit, timeout, and unavailable states;
- the real Pages origin passes;
- an unauthorized origin is rejected;
- the operator request is approved; and
- any durable data has a verified backup and restore owner.
