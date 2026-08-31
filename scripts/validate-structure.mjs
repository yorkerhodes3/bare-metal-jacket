import { access } from "node:fs/promises";

const requiredPaths = [
  "CONCEPT-IDEA.md",
  "README.md",
  "SECURITY.md",
  "docs/architecture/system-context.md",
  "docs/guides/pages-backend.md",
  "docs/guides/lab-backend-for-students.md",
  "docs/security/threat-model.md",
  "docs/adr/0001-tenancy-model.md",
  "docs/adr/0002-runtime-orchestrator.md",
  "docs/adr/0003-build-isolation.md",
  "docs/operations/backup-and-restore.md",
  "docs/operations/deployment-testing.md",
  "docs/operations/lab-service-level.md",
  "docs/research/competitive-landscape.md",
  "openapi/control-plane.yaml",
  "openapi/lab-gateway.yaml",
  "deploy/compose/docker-compose.yml",
  "deploy/systemd/bare-metal-jacket-backup.service",
  "deploy/systemd/bare-metal-jacket-backup.timer",
  "examples/hello-docker/Dockerfile",
  "scripts/deployment-preflight.mjs",
  "scripts/deployment-smoke.mjs",
  "scripts/backup-foundation.mjs",
  "scripts/install-b3iq-backup-timer.sh",
  "scripts/scaffold-lab-project.mjs",
  "scripts/pages-proxy-smoke.mjs",
  "scripts/backup-local-foundation.ps1",
  "scripts/start-local-foundation.ps1",
  "scripts/verify-foundation-backup.mjs",
  "scripts/validate-lab-project.mjs",
  "site/sdk/lab-backend.js",
  "site/schemas/lab-backend-project.schema.json",
  "site/schemas/lab-backend-discovery.schema.json",
  "site/templates/lab-backend.project.json",
  "site/favicon-lab.html",
  "site/favicon-lab.css",
  "site/favicon-options/01-armor-plates.svg",
  "site/favicon-options/02-jacket-lapels.svg",
  "site/favicon-options/03-armored-server.svg",
  "site/favicon-options/04-bmj-rivet.svg",
  "site/favicon-options/05-metal-node.svg",
  ".github/skills/ethical-tech-colab-backend/SKILL.md",
  "tests/deployment/smoke-harness.test.mjs",
];

const missingPaths = [];

for (const path of requiredPaths) {
  try {
    await access(path);
  } catch {
    missingPaths.push(path);
  }
}

if (missingPaths.length > 0) {
  console.error(`Missing required scaffold paths:\n${missingPaths.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${requiredPaths.length} required scaffold paths.`);
}
