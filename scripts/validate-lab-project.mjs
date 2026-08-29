import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SHARED_CAPABILITIES = new Set(["ai.chat", "forms.submit"]);
export const ALL_CAPABILITIES = new Set([
  ...SHARED_CAPABILITIES,
  "custom.api",
  "auth.user",
  "files.store",
  "jobs.background",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GITHUB_REPOSITORY =
  /^https:\/\/github\.com\/Ethical-Tech-CoLab\/[A-Za-z0-9._-]+\/?$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export function validateLabProject(manifest) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest: must be a JSON object"];
  }

  if (manifest.apiVersion !== "baremetaljacket.dev/v1alpha1") {
    add("apiVersion", "must equal baremetaljacket.dev/v1alpha1");
  }
  if (manifest.kind !== "LabBackendProject") {
    add("kind", "must equal LabBackendProject");
  }

  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== "object") {
    add("metadata", "is required");
  } else {
    if (
      typeof metadata.slug !== "string" ||
      metadata.slug.length < 2 ||
      !SLUG.test(metadata.slug)
    ) {
      add("metadata.slug", "must be a lowercase DNS-style slug");
    }
    if (
      typeof metadata.displayName !== "string" ||
      metadata.displayName.length < 2 ||
      metadata.displayName.length > 100
    ) {
      add("metadata.displayName", "must contain 2-100 characters");
    }
    if (!GITHUB_REPOSITORY.test(metadata.repository ?? "")) {
      add(
        "metadata.repository",
        "must be an Ethical-Tech-CoLab GitHub repository URL",
      );
    }
    if (!GITHUB_OWNER.test(metadata.owner ?? "")) {
      add("metadata.owner", "must be a valid GitHub username");
    }
  }

  const spec = manifest.spec;
  if (!spec || typeof spec !== "object") {
    add("spec", "is required");
    return errors;
  }

  if (!["shared", "dedicated"].includes(spec.tier)) {
    add("spec.tier", "must be shared or dedicated");
  }

  if (
    spec.pages?.origin !== "https://ethical-tech-colab.github.io" ||
    !/^\/[A-Za-z0-9._-]+\/$/.test(spec.pages?.path ?? "")
  ) {
    add(
      "spec.pages",
      "must declare the CoLab Pages origin and a /repository/ path",
    );
  }

  if (
    !Array.isArray(spec.capabilities) ||
    spec.capabilities.length === 0 ||
    new Set(spec.capabilities).size !== spec.capabilities.length
  ) {
    add("spec.capabilities", "must be a non-empty unique array");
  } else {
    for (const capability of spec.capabilities) {
      if (!ALL_CAPABILITIES.has(capability)) {
        add("spec.capabilities", `unsupported capability ${capability}`);
      }
      if (spec.tier === "shared" && !SHARED_CAPABILITIES.has(capability)) {
        add(
          "spec.capabilities",
          `${capability} requires a dedicated container review`,
        );
      }
    }
  }

  const data = spec.data;
  if (!data || typeof data !== "object") {
    add("spec.data", "is required");
  } else {
    if (!["public", "internal", "sensitive"].includes(data.classification)) {
      add("spec.data.classification", "must be public, internal, or sensitive");
    }
    if (typeof data.containsPersonalData !== "boolean") {
      add("spec.data.containsPersonalData", "must be true or false");
    }
    if (!["ephemeral", "daily-backup"].includes(data.durability)) {
      add("spec.data.durability", "must be ephemeral or daily-backup");
    }
    if (
      data.retentionDays !== undefined &&
      (!Number.isInteger(data.retentionDays) ||
        data.retentionDays < 1 ||
        data.retentionDays > 3650)
    ) {
      add("spec.data.retentionDays", "must be an integer from 1 to 3650");
    }
    if (
      spec.tier === "shared" &&
      (data.classification === "sensitive" || data.containsPersonalData)
    ) {
      add(
        "spec.data",
        "sensitive or personal data requires dedicated review; do not use the shared tier",
      );
    }
    if (
      spec.capabilities?.includes("forms.submit") &&
      data.durability !== "daily-backup"
    ) {
      add("spec.data.durability", "forms.submit requires daily-backup");
    }
  }

  if (spec.serviceLevel !== "lab-99") {
    add("spec.serviceLevel", "must equal lab-99");
  }

  if (spec.tier === "dedicated") {
    const dedicated = spec.dedicated;
    if (!dedicated || typeof dedicated !== "object") {
      add("spec.dedicated", "is required for a dedicated tier");
    } else {
      if (
        typeof dedicated.dockerfile !== "string" ||
        dedicated.dockerfile.length === 0
      ) {
        add("spec.dedicated.dockerfile", "is required");
      }
      if (
        !Number.isInteger(dedicated.port) ||
        dedicated.port < 1024 ||
        dedicated.port > 65535
      ) {
        add("spec.dedicated.port", "must be from 1024 to 65535");
      }
      for (const property of ["healthPath", "readinessPath"]) {
        if (
          typeof dedicated[property] !== "string" ||
          !dedicated[property].startsWith("/")
        ) {
          add(`spec.dedicated.${property}`, "must start with /");
        }
      }
      if (
        !Number.isInteger(dedicated.cpuMillis) ||
        dedicated.cpuMillis < 50 ||
        dedicated.cpuMillis > 4000
      ) {
        add("spec.dedicated.cpuMillis", "must be from 50 to 4000");
      }
      if (
        !Number.isInteger(dedicated.memoryMiB) ||
        dedicated.memoryMiB < 64 ||
        dedicated.memoryMiB > 8192
      ) {
        add("spec.dedicated.memoryMiB", "must be from 64 to 8192");
      }
      if (!Array.isArray(dedicated.storage)) {
        add("spec.dedicated.storage", "must be an array");
      } else {
        if (dedicated.storage.length > 4) {
          add("spec.dedicated.storage", "supports at most 4 volumes");
        }
        for (const [index, storage] of dedicated.storage.entries()) {
          if (
            typeof storage?.name !== "string" ||
            storage.name.length < 2 ||
            !SLUG.test(storage.name)
          ) {
            add(
              `spec.dedicated.storage[${index}].name`,
              "must be a lowercase DNS-style slug",
            );
          }
          if (
            typeof storage?.mountPath !== "string" ||
            !storage.mountPath.startsWith("/")
          ) {
            add(
              `spec.dedicated.storage[${index}].mountPath`,
              "must start with /",
            );
          }
          if (
            !Number.isInteger(storage?.sizeGiB) ||
            storage.sizeGiB < 1 ||
            storage.sizeGiB > 100
          ) {
            add(
              `spec.dedicated.storage[${index}].sizeGiB`,
              "must be from 1 to 100",
            );
          }
        }
        if (
          dedicated.storage.length > 0 &&
          data?.durability !== "daily-backup"
        ) {
          add(
            "spec.data.durability",
            "dedicated persistent storage requires daily-backup",
          );
        }
      }
    }
  }

  return errors;
}

export function readAndValidateLabProject(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return { manifest, errors: validateLabProject(manifest) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2] ?? ".lab/backend.json";
  try {
    const { errors } = readAndValidateLabProject(path);
    if (errors.length > 0) {
      console.error(`Invalid ${path}:\n- ${errors.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log(`Valid lab backend manifest: ${path}`);
    }
  } catch (error) {
    console.error(`Could not validate ${path}: ${error.message}`);
    process.exitCode = 1;
  }
}
