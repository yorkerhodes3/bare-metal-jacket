# Deployment testing: workstation and B3IQ

## What can be tested now

Bare Metal Jacket currently contains a deployment foundation and architecture contracts, not a working control plane. The current test target proves:

- the repository and OpenAPI contracts validate;
- the sample workload builds and runs without root;
- PostgreSQL, Redis, the OCI registry, the workload, and Traefik become healthy;
- Traefik only routes to the healthy workload;
- the expected release identifier is active;
- the registry API is reachable only through its loopback binding; and
- the same composition can run on a workstation, GitHub Actions, or B3IQ.

It does **not** yet prove GitHub webhook handling, BuildKit isolation, image publication by digest, automatic candidate activation, or one-click rollback. Those are Phase 1 acceptance tests and must not be inferred from a successful Compose smoke test.

## Test ladder

Run the stages in order. Do not expose a host publicly until the loopback and SSH-tunnel stages pass.

| Stage | Environment                      | Evidence                                                                                                     |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 0     | Any Node/Python host             | Formatting, Markdown, OpenAPI, structure, and sample process tests pass                                      |
| 1     | Docker host                      | Compose config, image build, service health, routes, and registry smoke pass                                 |
| 2     | B3IQ over SSH                    | The same stack passes while every published port remains loopback-only                                       |
| 3     | B3IQ through Cloudflare Tunnel   | Public HTTPS reaches only Traefik; databases and registry remain private                                     |
| 4     | Existing `pages-ai-proxy` canary | Health, CORS, blocked origin, catalog, and optional local GPU inference pass                                 |
| 5     | Future Phase 1 control plane     | Git push, immutable build, failed-candidate isolation, activation, restart reconciliation, and rollback pass |

## This Windows workstation

### Current readiness

As observed on 2026-08-28:

- Node.js, Python, Docker Desktop 4.88.1, Docker CLI 29.7.2, Compose 5.4.0, and WSL 2.7.12 are installed;
- repository checks and the sample process tests pass;
- Hyper-V, Virtual Machine Platform, and the WSL optional feature are enabled; and
- Windows has a pending restart before the Linux container backend can start.

Stage 0 works now. Stage 1 is staged with generated local secrets and can begin after the required Windows restart.

### Install the missing runtime

The recommended Windows path is WSL 2 plus Docker Desktop. This changes the machine and requires administrator access and usually a restart.

1. In an elevated PowerShell window, install WSL:

   ```powershell
   wsl --install
   ```

2. Restart Windows when prompted.
3. Install Docker Desktop from the official Docker distribution and enable its WSL 2 backend.
4. Open a new terminal and verify:

   ```powershell
   docker version
   docker compose version
   ```

An alternative is a dedicated Linux VM. Do not expose an unauthenticated Docker TCP socket to make the Windows client work.

This workstation has a per-user scheduled task named `Bare Metal Jacket Local Foundation`. One minute after the next login it runs [start-local-foundation.ps1](../../scripts/start-local-foundation.ps1), starts Docker Desktop, waits for its backend, starts the Compose project, and records a smoke-test result in `%LOCALAPPDATA%\BareMetalJacket\foundation-startup.log`.

### Run Stage 0

From the repository root:

```powershell
npm ci
npm run check
python -m unittest discover -s examples\hello-docker -p "test_*.py"
```

### Run Stage 1

Create a private local environment file:

```powershell
Copy-Item deploy\compose\.env.example deploy\compose\.env
$postgres = [guid]::NewGuid().ToString("N")
$redis = [guid]::NewGuid().ToString("N")
$content = Get-Content deploy\compose\.env -Raw
$content = $content -replace "(?m)^POSTGRES_PASSWORD=.*$", "POSTGRES_PASSWORD=$postgres"
$content = $content -replace "(?m)^REDIS_PASSWORD=.*$", "REDIS_PASSWORD=$redis"
Set-Content deploy\compose\.env $content -NoNewline
```

Run preflight, start, and smoke:

```powershell
npm run preflight:deployment
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  up --detach --build --wait
npm run smoke:deployment
```

Inspect state and logs:

```powershell
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  ps
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  logs --no-color --tail 200
```

Verify restart recovery:

```powershell
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  restart hello
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  up --detach --wait
npm run smoke:deployment
```

Stop without deleting persistent data:

```powershell
docker compose `
  --env-file deploy\compose\.env `
  -f deploy\compose\docker-compose.yml `
  --profile demo `
  down
```

Do not add `--volumes` unless the named test data is intentionally disposable.

## B3IQ bare metal

### Current readiness

The tested B3IQ node is reachable through its configured SSH host name and currently has:

- Ubuntu 24.04.4 LTS;
- 60 GiB RAM and more than 700 GiB free disk;
- passwordless non-interactive `sudo`;
- Node.js 20, Git, systemd, Cloudflare Tunnel, and Ollama;
- Docker Engine 29.7.2 and Compose 5.5.0 from Docker's signed Ubuntu repository; and
- the five-service foundation running with `unless-stopped` restart policies.

Traefik, PostgreSQL, Redis, and the registry are published only on B3IQ loopback. The existing `pages-ai-proxy` service remains active on port 8799. Port 8788, which still appears in parts of its runbook, is not active.

The host reports a pending Ubuntu kernel update. Do not reboot it without coordinating the existing proxy, tunnel, model, and other workloads.

### Install Docker Engine during a maintenance window

Confirm B3IQ policy permits a Docker daemon before changing the host. Then follow Docker's official Ubuntu installation procedure to add Docker's signed apt repository and install:

```text
docker-ce
docker-ce-cli
containerd.io
docker-buildx-plugin
docker-compose-plugin
```

Verify the daemon before adding user access:

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

For a dedicated test node, add `b3iq` to the `docker` group only if its root-equivalent implications are accepted:

```bash
sudo usermod -aG docker b3iq
```

Log out and reconnect before using Docker without `sudo`. Never mount the Docker socket into a public workload.

### Clone and configure

```bash
git clone https://github.com/yorkerhodes3/bare-metal-jacket.git
cd bare-metal-jacket
cp deploy/compose/.env.example deploy/compose/.env
chmod 600 deploy/compose/.env
```

Replace both example passwords with generated values:

```bash
sed -i "0,/change-me-local-only/s//$(openssl rand -hex 24)/" deploy/compose/.env
sed -i "0,/change-me-local-only/s//$(openssl rand -hex 24)/" deploy/compose/.env
```

Keep `EDGE_BIND_ADDRESS=127.0.0.1`. PostgreSQL, Redis, the registry, and Traefik must remain on loopback for the first B3IQ run.

### Run Stage 1 on B3IQ

```bash
sudo env \
  BMJ_ENV_FILE="$PWD/deploy/compose/.env" \
  BMJ_COMPOSE_FILE="$PWD/deploy/compose/docker-compose.yml" \
  node scripts/deployment-preflight.mjs
sudo docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  --profile demo \
  up --detach --build --wait
node scripts/deployment-smoke.mjs
```

### Run Stage 2 through an SSH tunnel

From this Windows machine, keep the session open:

```powershell
ssh `
  -L 18080:127.0.0.1:8080 `
  -L 15000:127.0.0.1:5000 `
  ssh-node-b3iq-<your-id>.b3iq.org
```

In another local terminal:

```powershell
$env:BMJ_BASE_URL = "http://127.0.0.1:18080"
$env:BMJ_REGISTRY_URL = "http://127.0.0.1:15000"
npm run smoke:deployment
Remove-Item Env:BMJ_BASE_URL
Remove-Item Env:BMJ_REGISTRY_URL
```

This proves remote execution without making the test stack public.

### Run Stage 3 through Cloudflare Tunnel

The `pages-ai-proxy` pattern is appropriate for ingress after the SSH-tunneled smoke passes:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Use the generated `trycloudflare.com` URL only for a short-lived test. For repeated acceptance tests, create a named tunnel and a dedicated hostname such as `bmj-demo.example.org`. The tunnel should route only to `127.0.0.1:8080`.

From the workstation:

```powershell
$env:BMJ_BASE_URL = "https://<temporary-or-named-host>"
$env:BMJ_REGISTRY_URL = "http://127.0.0.1:15000"
npm run smoke:deployment
```

Keep the registry check on the SSH tunnel. Never publish ports 5000, 5432, 6379, or the Docker API.

## `pages-ai-proxy` as the brownfield canary

The Ethical Tech CoLab proxy is valuable in two ways:

1. its systemd plus Cloudflare Tunnel setup is a working reference for B3IQ ingress, restart, and secret handling; and
2. it is a realistic second workload for the future Phase 1 control plane because it has health, CORS, configuration, a local GPU dependency, and a public client.

Run the non-inference checks from this repository:

```powershell
npm run smoke:b3iq-proxy
```

The script reads the canonical discovery document, then verifies:

- public discovery;
- `/healthz`;
- `/v1/models`;
- allowed-origin CORS preflight; and
- rejection of a disallowed POST origin.

Include one bounded local GPU inference:

```powershell
$env:PAGES_AI_PROXY_LIVE = "1"
$env:PAGES_AI_PROXY_MODEL = "gemma3:12b"
npm run smoke:b3iq-proxy
Remove-Item Env:PAGES_AI_PROXY_LIVE
Remove-Item Env:PAGES_AI_PROXY_MODEL
```

The live test sends only `Reply with exactly BMJ_OK` with a 12-token limit.

### Canary findings and remediation

The initial 2026-08-28 probe found:

- the service and public quick tunnel are healthy;
- allowed CORS preflight returns 204 and a blocked POST returns 403;
- `gemma3:12b` returned `BMJ_OK` through the public proxy;
- the retired GitHub Models upstream and stale discovery created failed cloud requests;
- the active port and older B3IQ instructions did not agree;
- the Node service listens on all interfaces (`*:8799`) even though only the tunnel needs loopback; and
- the initial systemd unit had an exposure score of 8.6.

Remediation completed on 2026-08-29:

- B3IQ configuration and documentation use port 8799;
- discovery no longer advertises the retired cloud models;
- a write-enabled deploy key scoped only to `Ethical-Tech-CoLab/War-Games` republishes discovery after tunnel rotation;
- a five-minute watchdog checks the public endpoint and restarts an unhealthy quick tunnel;
- a forced tunnel failure successfully created a new hostname and republished it; and
- systemd sandboxing reduced the proxy exposure score from 8.6 to 3.0.

Remaining before the proxy qualifies as a production-like acceptance workload:

1. add a configurable bind host and use `127.0.0.1` for the Node listener;
2. replace the quick tunnel with a named tunnel and stable DNS;
3. run the service under a dedicated proxy identity rather than the general B3IQ login user; and
4. add a non-root Dockerfile with a health check in the proxy repository.

## Phase 1 acceptance suite

Once the control plane exists, B3IQ should run these additional tests:

1. Connect a dedicated sample GitHub repository with a GitHub App installation.
2. Push release A and record source commit, image digest, deployment events, and public response.
3. Push a release B that never becomes ready; verify A remains active.
4. Push a healthy B; verify traffic changes only after the readiness stability window.
5. Restart the control plane and worker during every deployment phase; verify reconciliation creates no duplicate release.
6. Roll back to A by release identifier; verify the digest and audit event.
7. Attempt forbidden host mounts, privileged mode, host networking, excessive memory, and a forged webhook.
8. Confirm canary secrets never appear in API output, build logs, image history, runtime logs, events, or backups.
9. Restore PostgreSQL and registry state onto a clean node and repeat deployment plus rollback.

The first production-shaped milestone passes only when all nine tests produce retained evidence.
