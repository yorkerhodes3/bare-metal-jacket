# Backup, restore, and host transition

## Recovery contract

Containers are replaceable runtime processes, not backup units. Images and networks are recreated from Git, Dockerfiles, and Compose. Back up authoritative data, release artifacts that cannot be rebuilt within the recovery objective, and the metadata needed to verify them.

The lab target is:

- foundation-data RPO: 24 hours;
- container/process RTO: 15 minutes;
- host-rebuild RTO: 4 hours; and
- daily backups with a verified off-host copy.

See [the minimum lab service level](./lab-service-level.md).

## Persistence classes

| Data                       | Runtime location            | Reboot/container replacement | Host loss          | Recovery source                        |
| -------------------------- | --------------------------- | ---------------------------- | ------------------ | -------------------------------------- |
| Control-plane data         | `postgres-data`             | Persists                     | Lost               | PostgreSQL logical dump                |
| Redis coordination         | `redis-data`                | Persists                     | Lost               | Volume archive or reconstruction       |
| OCI images                 | `registry-data`             | Persists                     | Lost               | Volume archive or reproducible rebuild |
| Application uploads        | Future object store/volume  | Depends on declaration       | Lost if host-local | Versioned off-host object storage      |
| Containers and networks    | Docker runtime              | Recreated                    | Lost               | Compose and images                     |
| Source and operations docs | GitHub                      | Independent                  | Independent        | Git clone                              |
| `.env` secrets             | Host file, mode 600         | Persists                     | Lost               | Separate encrypted recovery record     |
| TLS certificates           | Named tunnel/ACME state     | Usually persists             | Reissue or restore | Tunnel provider or encrypted backup    |
| Logs                       | Container/collector storage | Retention-dependent          | Lost if host-local | External log store when required       |

Docker named volumes survive:

- container restart;
- container recreation;
- Docker daemon restart;
- host reboot; and
- `docker compose down`.

They do not survive:

- `docker compose down --volumes`;
- explicit volume deletion;
- filesystem corruption;
- disk or host loss; or
- transition to a clean server without restore.

Never store durable data only in a container writable layer.

## Foundation backup contents

`npm run backup:foundation` creates one timestamped directory containing:

```text
foundation-<UTC timestamp>/
|-- manifest.json
|-- postgres.dump
|-- redis-volume.tar.gz
`-- registry-volume.tar.gz
```

The manifest records:

- source Git revision;
- hash of the resolved Compose model without storing its secret-bearing content;
- host, Docker, and Compose versions;
- file sizes and SHA-256 checksums;
- the Redis/registry interruption window; and
- an explicit statement that secrets are not included.

PostgreSQL remains online during its logical dump. Redis performs a synchronous save, then Redis and the registry are stopped briefly while their volumes are archived. Both restart in a `finally` path, and the command fails visibly if any step fails.

## Create and verify a backup

From the repository root while the foundation is healthy:

```bash
npm run backup:foundation
npm run verify:backup
npm run smoke:deployment
```

Choose another staging directory:

```bash
node scripts/backup-foundation.mjs --output /var/backups/bare-metal-jacket
node scripts/verify-foundation-backup.mjs \
  --backup /var/backups/bare-metal-jacket
```

Verification:

- recalculates every SHA-256;
- asks `pg_restore` to parse the PostgreSQL archive catalog;
- asks `tar` to parse each volume archive; and
- restores PostgreSQL into a disposable container, queries it, and removes it.

A command exit of zero is retained evidence that the backup is structurally restorable. It does not replace an application-level data check.

## B3IQ daily timer

Install the timer from the B3IQ checkout:

```bash
cd ~/bare-metal-jacket
sudo bash scripts/install-b3iq-backup-timer.sh
```

The timer:

- runs daily at 03:15 with up to 30 minutes of jitter;
- catches up after downtime through `Persistent=true`;
- creates backups under `/var/backups/bare-metal-jacket`;
- verifies each backup immediately; and
- uses a restrictive umask and a low-priority one-shot service.

Inspect it:

```bash
systemctl list-timers bare-metal-jacket-backup.timer
sudo journalctl -u bare-metal-jacket-backup.service --since today
sudo systemctl start bare-metal-jacket-backup.service
```

The local backup directory is only a staging copy. It does not protect against B3IQ disk or host loss.

## Windows development backup

Run an on-demand verified backup outside the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\backup-local-foundation.ps1
```

The default target is `$HOME\BareMetalJacketBackups\Local`, and the transcript is written to `%LOCALAPPDATA%\BareMetalJacket\foundation-backup.log`. This protects against accidental container or volume replacement, but it is still on the same workstation and is not an off-host disaster-recovery copy.

The provisioned development workstation also has a daily scheduled task named `Bare Metal Jacket Local Backup` that runs this wrapper at 04:15 when the user is logged in, or when Windows next makes the missed task available.

## Off-host protection

Use three copies across at least two media/failure domains, with one off-site or independently administered copy.

Recommended lab layout:

1. live named volumes on B3IQ;
2. verified backup under `/var/backups/bare-metal-jacket`; and
3. encrypted, versioned objects in S3-compatible storage with retention protection.

Alternative interim copy:

```powershell
scp -r `
  ssh-node-b3iq-<your-id>.b3iq.org:/var/backups/bare-metal-jacket/foundation-<timestamp> `
  "$HOME\BareMetalJacketBackups\B3IQ\"
node scripts\verify-foundation-backup.mjs `
  --backup "$HOME\BareMetalJacketBackups\B3IQ\foundation-<timestamp>"
```

An operator workstation is a second host, but not a sufficient long-term off-site target.

For object storage, use an encrypted backup tool such as restic with:

- repository password stored outside the B3IQ host;
- scoped append-oriented storage credentials;
- bucket object versioning or immutability;
- 7 daily, 5 weekly, and 3 monthly generations; and
- periodic restore using read-only recovery credentials.

Do not commit storage credentials or place them in command history.

## Secret recovery

Foundation backups intentionally exclude `deploy/compose/.env`.

Store these separately in an encrypted password manager or secret manager:

- PostgreSQL password;
- Redis password;
- application provider keys;
- OIDC client secret, when introduced;
- named-tunnel credential;
- backup repository password; and
- recovery-only storage credential.

Record variable names, owners, rotation dates, and recovery location without recording values in Git.

If secrets are lost but the PostgreSQL data remains, an operator may reset credentials through a trusted local database session. If the host is lost, the encrypted recovery record is required for predictable restoration and credential rotation.

## Restore to a clean host

Restoration is destructive to the target. Use a new or explicitly empty host and preserve any existing data before starting.

### 1. Provision runtime

Install a supported Docker Engine and Compose plugin. Clone the recorded Git revision from `manifest.json`:

```bash
git clone https://github.com/yorkerhodes3/bare-metal-jacket.git
cd bare-metal-jacket
git checkout <manifest source.gitCommit>
```

### 2. Verify before extraction

```bash
node scripts/verify-foundation-backup.mjs \
  --backup /recovery/foundation-<timestamp>
```

Do not restore a failed or unverified archive.

### 3. Recover secrets

Create `deploy/compose/.env` from the encrypted recovery record, set mode 600, and confirm no example placeholder remains.

### 4. Create empty volumes

```bash
docker volume create bare-metal-jacket_redis-data
docker volume create bare-metal-jacket_registry-data
docker volume create bare-metal-jacket_postgres-data
```

Each command must report a newly created empty volume. Stop if a target volume already contains data.

### 5. Restore Redis and registry archives

```bash
docker run --rm -i \
  -v bare-metal-jacket_redis-data:/restore \
  alpine:3.22 \
  tar -xzf - -C /restore \
  < /recovery/foundation-<timestamp>/redis-volume.tar.gz

docker run --rm -i \
  -v bare-metal-jacket_registry-data:/restore \
  alpine:3.22 \
  tar -xzf - -C /restore \
  < /recovery/foundation-<timestamp>/registry-volume.tar.gz
```

### 6. Restore PostgreSQL

Start PostgreSQL against the empty volume:

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  up --detach --wait postgres
```

Restore the logical dump:

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --exit-on-error --no-owner --no-acl' \
  < /recovery/foundation-<timestamp>/postgres.dump
```

### 7. Start and validate

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  --profile demo \
  up --detach --build --wait
npm run smoke:deployment
```

Then verify application-specific row counts, release digests, configuration, secret decryption, audit continuity, and a write/read transaction.

### 8. Restore edge

Attach the stable named tunnel to `127.0.0.1:8080`, confirm external readiness, and only then update discovery or DNS.

## Host reboot

A normal reboot does not require a data restore:

1. Docker starts through systemd or Docker Desktop.
2. `unless-stopped` containers restart.
3. Health checks gate readiness.
4. The tunnel reconnects.
5. External probes verify the complete path.

Before planned reboot:

```bash
npm run backup:foundation
npm run verify:backup
```

After reboot:

```bash
npm run smoke:deployment
```

## Transition between servers

For a planned move:

1. provision and smoke-test the new host without production DNS;
2. create and verify a fresh backup;
3. stop writes or place the old service in maintenance mode;
4. create a final backup and copy it to the new host;
5. restore and run application-level checks;
6. start the named tunnel on the new host or change its ingress target;
7. verify externally;
8. retain the old host, stopped but intact, through the rollback window; and
9. sanitize the old host only after formal acceptance.

Without write quiescence or database replication, changes made after the final backup are outside the RPO and will be lost.

## Required restore drill

A backup is not successful until a clean-host drill verifies:

- manifest and checksums;
- database schema and application row counts;
- required release digests;
- secret recovery and rotation;
- audit continuity;
- application write and read;
- public readiness through the named tunnel; and
- deployment plus rollback after restoration.
