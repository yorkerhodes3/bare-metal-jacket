import { access } from "node:fs/promises";

const requiredPaths = [
  "CONCEPT-IDEA.md",
  "README.md",
  "SECURITY.md",
  "docs/architecture/system-context.md",
  "docs/security/threat-model.md",
  "docs/adr/0001-tenancy-model.md",
  "docs/adr/0002-runtime-orchestrator.md",
  "docs/adr/0003-build-isolation.md",
  "docs/operations/backup-and-restore.md",
  "docs/operations/deployment-testing.md",
  "docs/research/competitive-landscape.md",
  "openapi/control-plane.yaml",
  "deploy/compose/docker-compose.yml",
  "examples/hello-docker/Dockerfile",
  "scripts/deployment-preflight.mjs",
  "scripts/deployment-smoke.mjs",
  "scripts/pages-proxy-smoke.mjs",
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
