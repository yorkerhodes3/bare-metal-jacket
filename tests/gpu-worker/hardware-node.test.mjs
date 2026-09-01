import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateHardwareNode } from "../../scripts/validate-hardware-node.mjs";

const example = JSON.parse(
  readFileSync("deploy/gpu-worker/node.example.json", "utf8"),
);

test("RTX 3090 example is a valid disabled inference worker", () => {
  assert.deepEqual(validateHardwareNode(example), []);
  assert.equal(example.spec.scheduling.state, "disabled");
  assert.equal(example.spec.storage.durableApplicationData, false);
  assert.equal(example.spec.scheduling.maxConcurrent, 1);
});

test("validator rejects public endpoints and durable worker data", () => {
  const invalid = structuredClone(example);
  invalid.spec.endpoints.inference = "https://gpu.example.org";
  invalid.spec.storage.durableApplicationData = true;

  const errors = validateHardwareNode(invalid);
  assert(errors.some((error) => error.startsWith("spec.endpoints.inference:")));
  assert(
    errors.some((error) =>
      error.startsWith("spec.storage.durableApplicationData:"),
    ),
  );
});

test("worker unavailable timeout allows multiple heartbeat misses", () => {
  const invalid = structuredClone(example);
  invalid.spec.heartbeat.intervalSeconds = 60;
  invalid.spec.heartbeat.unavailableAfterSeconds = 90;

  assert(
    validateHardwareNode(invalid).some((error) =>
      error.includes("two missed heartbeat intervals"),
    ),
  );
});
