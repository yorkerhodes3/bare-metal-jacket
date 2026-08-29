import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLabProject } from "./validate-lab-project.mjs";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function flag(name) {
  return args.includes(name);
}

if (flag("--help")) {
  console.log(`Usage:
  node scripts/scaffold-lab-project.mjs \\
    --slug evacuation-map \\
    --name "Evacuation Map" \\
    --repository https://github.com/Ethical-Tech-CoLab/evacuation-map \\
    --owner github-user \\
    [--tier shared|dedicated] \\
    [--capabilities ai.chat,forms.submit] \\
    [--classification public|internal|sensitive] \\
    [--personal-data true|false] \\
    [--durability ephemeral|daily-backup] \\
    [--output .lab] [--force]`);
  process.exit(0);
}

const slug = option("--slug");
const displayName = option("--name");
const repository = option("--repository");
const owner = option("--owner");
const tier = option("--tier", "shared");
const capabilities = option(
  "--capabilities",
  tier === "dedicated" ? "custom.api" : "ai.chat",
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const classification = option("--classification", "public");
const personalDataOption = option("--personal-data", "false");
if (!["true", "false"].includes(personalDataOption)) {
  throw new Error("--personal-data must be true or false");
}
const containsPersonalData = personalDataOption === "true";
const durability = option(
  "--durability",
  capabilities.includes("forms.submit") ? "daily-backup" : "ephemeral",
);
const outputDirectory = resolve(option("--output", ".lab"));
const manifestPath = resolve(outputDirectory, "backend.json");
const handoffPath = resolve(outputDirectory, "AGENT-HANDOFF.md");

for (const [name, value] of [
  ["--slug", slug],
  ["--name", displayName],
  ["--repository", repository],
  ["--owner", owner],
]) {
  if (!value) throw new Error(`${name} is required`);
}

const manifest = {
  $schema:
    "https://yorkerhodes3.github.io/bare-metal-jacket/schemas/lab-backend-project.schema.json",
  apiVersion: "baremetaljacket.dev/v1alpha1",
  kind: "LabBackendProject",
  metadata: {
    slug,
    displayName,
    repository,
    owner,
  },
  spec: {
    tier,
    pages: {
      origin: "https://ethical-tech-colab.github.io",
      path: `/${new URL(repository).pathname.split("/").filter(Boolean).at(-1)}/`,
    },
    capabilities,
    data: {
      classification,
      containsPersonalData,
      durability,
    },
    serviceLevel: "lab-99",
    ...(tier === "dedicated"
      ? {
          dedicated: {
            dockerfile: "Dockerfile",
            port: 8080,
            healthPath: "/healthz",
            readinessPath: "/readyz",
            cpuMillis: 500,
            memoryMiB: 512,
            storage: [],
          },
        }
      : {}),
  },
};

const errors = validateLabProject(manifest);
if (errors.length > 0) {
  throw new Error(`Manifest would be invalid:\n- ${errors.join("\n- ")}`);
}

if (!flag("--force") && (existsSync(manifestPath) || existsSync(handoffPath))) {
  throw new Error(
    `${outputDirectory} already contains backend files; use --force to replace them`,
  );
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  handoffPath,
  `# Agent handoff: ${displayName}

Use the Ethical Tech CoLab backend skill:

https://raw.githubusercontent.com/yorkerhodes3/bare-metal-jacket/main/.github/skills/ethical-tech-colab-backend/SKILL.md

The requested tier is **${tier}** with capabilities: ${capabilities
    .map((capability) => `\`${capability}\``)
    .join(", ")}.

1. Validate \`.lab/backend.json\`.
2. Read the skill and choose only documented live capabilities.
3. Integrate the browser SDK without adding a provider secret to this repository.
4. Add connecting, unavailable, rate-limited, and retry states to the UI.
5. Open the Bare Metal Jacket \`Lab backend request\` issue for operator approval.

Request form:

https://github.com/yorkerhodes3/bare-metal-jacket/issues/new?template=lab_backend_request.yml
`,
);

console.log(`Created ${manifestPath}`);
console.log(`Created ${handoffPath}`);
console.log(
  "Next: give AGENT-HANDOFF.md to the project agent, then open the lab backend request.",
);
