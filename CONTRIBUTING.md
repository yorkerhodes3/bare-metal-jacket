# Contributing

## Before changing code

1. Read [the concept](./CONCEPT-IDEA.md), [the system context](./docs/architecture/system-context.md), and [the threat model](./docs/security/threat-model.md).
2. Open an issue for behavior or architecture changes.
3. Add or update an ADR when a change moves a trust boundary, selects infrastructure, or creates a long-lived compatibility commitment.
4. Update [the OpenAPI contract](./openapi/control-plane.yaml) before implementing an externally visible API change.

## Development checks

Install the pinned validation dependencies:

```bash
npm install
```

Run repository checks:

```bash
npm run check
python -m unittest discover -s examples/hello-docker -p "test_*.py"
```

If Docker Compose is available, also validate the local stack:

```bash
docker compose \
  --env-file deploy/compose/.env.example \
  -f deploy/compose/docker-compose.yml \
  --profile demo \
  config
```

## Pull requests

- Keep changes focused and explain the user-visible or operational outcome.
- Include failure-path tests for deployment state transitions.
- Do not add secrets, real hostnames, production addresses, or customer data.
- Preserve API compatibility or document the migration.
- Identify new privileged operations and the actor authorized to perform them.
- Record the validation commands and results.

## Commit messages

Use an imperative subject that describes the outcome, such as:

```text
Add health-gated release activation contract
```
