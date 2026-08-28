# Security Policy

## Supported versions

The project is pre-release. Security fixes are made on the default branch until a versioned support policy is published.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting feature for this repository. Include:

- affected component and revision;
- required access and trust boundary;
- reproduction steps or a minimal proof of concept;
- expected and observed behavior;
- potential impact; and
- any temporary mitigation already tested.

Do not include production credentials, customer data, or destructive payloads.

## Security scope

The initial platform assumes trusted internal users but treats application source, build instructions, images, and runtime processes as untrusted. Public hostile multi-tenancy is out of scope.

Changes involving Docker access, build execution, secrets, repository credentials, ingress, tenancy, or audit records must be reviewed against [the threat model](./docs/security/threat-model.md).
