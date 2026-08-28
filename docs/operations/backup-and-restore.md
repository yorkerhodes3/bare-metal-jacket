# Backup and restore runbook

## Status

This is an initial local-foundation runbook, not a production recovery guarantee. Production recovery point and recovery time objectives remain to be defined.

## Data inventory

| Data                                  | Local volume                  | Consistency method                                        |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Control-plane state and audit records | `postgres-data`               | PostgreSQL logical backup plus periodic physical strategy |
| Durable coordination data             | `redis-data`                  | Rebuild from PostgreSQL where possible; AOF is secondary  |
| OCI manifests and blobs               | `registry-data`               | Registry-aware snapshot or quiesced volume copy           |
| Configuration                         | Git and external secret store | Versioned config; encrypted secret backup                 |
| TLS state                             | Future edge volume            | Reissue where possible; encrypted backup if retained      |

Application persistent volumes are not part of this foundation and require per-service consistency contracts.

## Backup procedure

1. Record the repository revision, deployed component versions, and database migration version.
2. Create a PostgreSQL custom-format logical backup:

   ```bash
   docker compose \
     --env-file deploy/compose/.env \
     -f deploy/compose/docker-compose.yml \
     exec -T postgres \
     pg_dump --format=custom --no-owner --file=/tmp/platform.dump "$POSTGRES_DB"
   ```

3. Copy the dump out of the container into an encrypted staging directory.
4. Quiesce registry writes before snapshotting `registry-data`, or use a storage backend with consistent snapshots.
5. Generate SHA-256 checksums and a manifest that records time, versions, and expected files.
6. Encrypt before transfer and upload with a credential that cannot delete older backup generations.
7. Verify the remote object exists, its checksum matches, and retention policy is active.
8. Remove local plaintext staging files through the approved secure cleanup process.

The production implementation should automate these operations without placing credentials in shell history or logs.

## Restore procedure

Restore is destructive to the target environment. Confirm that the target is an empty recovery environment and preserve any existing data before proceeding.

1. Provision a clean supported Linux host from the documented baseline.
2. Fetch the backup manifest and artifacts using a read-only recovery credential.
3. Verify signatures or checksums before decrypting.
4. Check out the recorded repository revision.
5. Start only PostgreSQL and restore into an empty database.
6. Restore registry data while registry writes are disabled.
7. Start the control plane and run compatibility checks before workers or agents.
8. Reconcile registry digests against release records.
9. Start workers, the node agent, and edge routing.
10. Verify authentication, project inventory, release history, active digest, audit continuity, and a deployment plus rollback.
11. Record measured recovery time and all deviations.

## Required restore drill

A backup is not considered successful until a scheduled drill restores it into a clean environment and verifies:

- database schema and row counts;
- release digests exist in the registry;
- encrypted secrets can be decrypted with the recovery key;
- audit records are continuous;
- a retained release can start and pass readiness;
- a new deployment can complete; and
- rollback leaves the prior healthy service available.
