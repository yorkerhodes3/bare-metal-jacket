import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PRIVATE_ENDPOINT =
  /^http:\/\/(?:100\.|127\.0\.0\.1|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::|\/))/;

export function validateHardwareNode(manifest) {
  const errors = [];
  const add = (path, message) => errors.push(`${path}: ${message}`);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest: must be a JSON object"];
  }
  if (manifest.apiVersion !== "baremetaljacket.dev/v1alpha1") {
    add("apiVersion", "must equal baremetaljacket.dev/v1alpha1");
  }
  if (manifest.kind !== "HardwareNode") {
    add("kind", "must equal HardwareNode");
  }

  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== "object") {
    add("metadata", "is required");
  } else {
    if (
      typeof metadata.id !== "string" ||
      metadata.id.length < 2 ||
      !SLUG.test(metadata.id)
    ) {
      add("metadata.id", "must be a lowercase DNS-style slug");
    }
    for (const property of ["displayName", "owner"]) {
      if (
        typeof metadata[property] !== "string" ||
        metadata[property].length < 2 ||
        metadata[property].length > 100
      ) {
        add(`metadata.${property}`, "must contain 2-100 characters");
      }
    }
  }

  const spec = manifest.spec;
  if (!spec || typeof spec !== "object") {
    add("spec", "is required");
    return errors;
  }
  if (spec.role !== "inference-worker") {
    add("spec.role", "must equal inference-worker");
  }
  if (spec.trust !== "lab-internal") {
    add("spec.trust", "must equal lab-internal");
  }

  for (const endpoint of ["inference", "status"]) {
    if (!PRIVATE_ENDPOINT.test(spec.endpoints?.[endpoint] ?? "")) {
      add(
        `spec.endpoints.${endpoint}`,
        "must be a loopback, Tailscale 100.x, or MagicDNS HTTP URL",
      );
    }
  }
  if (spec.network?.transport !== "tailscale") {
    add("spec.network.transport", "must equal tailscale");
  }
  if (!["wired", "wifi"].includes(spec.network?.profile)) {
    add("spec.network.profile", "must be wired or wifi");
  }

  const capacity = spec.capacity;
  if (!Number.isInteger(capacity?.cpuCores) || capacity.cpuCores < 4) {
    add("spec.capacity.cpuCores", "must be an integer of at least 4");
  }
  if (!Number.isInteger(capacity?.memoryMiB) || capacity.memoryMiB < 16384) {
    add("spec.capacity.memoryMiB", "must be at least 16384");
  }
  if (capacity?.gpu?.count !== 1) {
    add("spec.capacity.gpu.count", "must equal 1");
  }
  if (capacity?.gpu?.vendor !== "NVIDIA") {
    add("spec.capacity.gpu.vendor", "must equal NVIDIA");
  }
  if (
    typeof capacity?.gpu?.model !== "string" ||
    capacity.gpu.model.length < 2
  ) {
    add("spec.capacity.gpu.model", "is required");
  }
  if (
    !Number.isInteger(capacity?.gpu?.memoryMiB) ||
    capacity.gpu.memoryMiB < 20000
  ) {
    add(
      "spec.capacity.gpu.memoryMiB",
      "must be at least 20000 for this worker profile",
    );
  }

  if (
    !Array.isArray(spec.models) ||
    spec.models.length === 0 ||
    new Set(spec.models).size !== spec.models.length
  ) {
    add("spec.models", "must be a non-empty unique array");
  }

  if (!["disabled", "enabled", "draining"].includes(spec.scheduling?.state)) {
    add("spec.scheduling.state", "must be disabled, enabled, or draining");
  }
  if (
    !Number.isInteger(spec.scheduling?.maxConcurrent) ||
    spec.scheduling.maxConcurrent < 1 ||
    spec.scheduling.maxConcurrent > 4
  ) {
    add("spec.scheduling.maxConcurrent", "must be from 1 to 4");
  }
  if (
    !Array.isArray(spec.scheduling?.allowedWorkloads) ||
    spec.scheduling.allowedWorkloads.length === 0 ||
    spec.scheduling.allowedWorkloads.some(
      (workload) => !["ai.chat", "ai.embeddings"].includes(workload),
    )
  ) {
    add(
      "spec.scheduling.allowedWorkloads",
      "must contain ai.chat and/or ai.embeddings",
    );
  }

  if (spec.storage?.modelCache !== "reconstructable") {
    add("spec.storage.modelCache", "must equal reconstructable");
  }
  if (spec.storage?.durableApplicationData !== false) {
    add(
      "spec.storage.durableApplicationData",
      "must be false; durable application data does not belong on a worker",
    );
  }

  const heartbeat = spec.heartbeat;
  if (
    !Number.isInteger(heartbeat?.intervalSeconds) ||
    heartbeat.intervalSeconds < 10 ||
    heartbeat.intervalSeconds > 300
  ) {
    add("spec.heartbeat.intervalSeconds", "must be from 10 to 300");
  }
  if (
    !Number.isInteger(heartbeat?.unavailableAfterSeconds) ||
    heartbeat.unavailableAfterSeconds < 30 ||
    heartbeat.unavailableAfterSeconds > 900
  ) {
    add("spec.heartbeat.unavailableAfterSeconds", "must be from 30 to 900");
  } else if (
    Number.isInteger(heartbeat.intervalSeconds) &&
    heartbeat.unavailableAfterSeconds < heartbeat.intervalSeconds * 2
  ) {
    add(
      "spec.heartbeat.unavailableAfterSeconds",
      "must allow at least two missed heartbeat intervals",
    );
  }

  return errors;
}

export function readAndValidateHardwareNode(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return { manifest, errors: validateHardwareNode(manifest) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2] ?? "deploy/gpu-worker/node.example.json";
  try {
    const { errors } = readAndValidateHardwareNode(path);
    if (errors.length > 0) {
      console.error(`Invalid ${path}:\n- ${errors.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log(`Valid hardware node manifest: ${path}`);
    }
  } catch (error) {
    console.error(`Could not validate ${path}: ${error.message}`);
    process.exitCode = 1;
  }
}
