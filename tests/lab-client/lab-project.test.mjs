import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateLabProject } from "../../scripts/validate-lab-project.mjs";

const sharedProject = {
  apiVersion: "baremetaljacket.dev/v1alpha1",
  kind: "LabBackendProject",
  metadata: {
    slug: "evacuation-map",
    displayName: "Evacuation Map",
    repository: "https://github.com/Ethical-Tech-CoLab/evacuation-map",
    owner: "student-user",
  },
  spec: {
    tier: "shared",
    pages: {
      origin: "https://ethical-tech-colab.github.io",
      path: "/evacuation-map/",
    },
    capabilities: ["ai.chat"],
    data: {
      classification: "public",
      containsPersonalData: false,
      durability: "ephemeral",
    },
    serviceLevel: "lab-99",
  },
};

test("validator accepts the minimal shared tier", () => {
  assert.deepEqual(validateLabProject(sharedProject), []);
});

test("published template is a valid shared request", () => {
  const template = JSON.parse(
    readFileSync(
      resolve("site", "templates", "lab-backend.project.json"),
      "utf8",
    ),
  );
  assert.deepEqual(validateLabProject(template), []);
});

test("validator rejects sensitive shared data and dedicated capabilities", () => {
  const invalid = structuredClone(sharedProject);
  invalid.spec.data.classification = "sensitive";
  invalid.spec.data.containsPersonalData = true;
  invalid.spec.capabilities.push("custom.api");

  const errors = validateLabProject(invalid);
  assert(errors.some((error) => error.includes("dedicated container")));
  assert(errors.some((error) => error.includes("personal data")));
});

test("validator agrees with the schema minimum slug length", () => {
  const invalid = structuredClone(sharedProject);
  invalid.metadata.slug = "x";
  assert(
    validateLabProject(invalid).some((error) =>
      error.startsWith("metadata.slug:"),
    ),
  );
});

test("scaffolder creates an agent-readable project request", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bmj-scaffold-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/scaffold-lab-project.mjs",
        "--slug",
        "evacuation-map",
        "--name",
        "Evacuation Map",
        "--repository",
        "https://github.com/Ethical-Tech-CoLab/evacuation-map",
        "--owner",
        "student-user",
        "--output",
        directory,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(
      readFileSync(resolve(directory, "backend.json"), "utf8"),
    );
    assert.deepEqual(validateLabProject(manifest), []);
    assert.equal(manifest.spec.tier, "shared");
    assert.deepEqual(manifest.spec.capabilities, ["ai.chat"]);
    assert.match(
      readFileSync(resolve(directory, "AGENT-HANDOFF.md"), "utf8"),
      /ethical-tech-colab-backend\/SKILL\.md/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dedicated scaffolding defaults to a custom API", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bmj-dedicated-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/scaffold-lab-project.mjs",
        "--slug",
        "research-api",
        "--name",
        "Research API",
        "--repository",
        "https://github.com/Ethical-Tech-CoLab/research-api",
        "--owner",
        "student-user",
        "--tier",
        "dedicated",
        "--output",
        directory,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      readFileSync(resolve(directory, "backend.json"), "utf8"),
    );
    assert.deepEqual(manifest.spec.capabilities, ["custom.api"]);
    assert.deepEqual(validateLabProject(manifest), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
