import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createGpuWorkerStatusServer } from "../../deploy/gpu-worker/status/server.mjs";

function json(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(content),
    "Content-Type": "application/json",
  });
  response.end(content);
}

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolvePromise(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

test("status server reports private inventory and Ollama readiness", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bmj-gpu-status-"));
  const manifestPath = resolve(directory, "node.json");
  const manifest = JSON.parse(
    readFileSync("deploy/gpu-worker/node.example.json", "utf8"),
  );
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const ollama = createServer((request, response) => {
    if (request.url === "/api/tags") {
      json(response, 200, {
        models: [
          {
            name: "qwen3:14b",
            size: 9_000_000_000,
            digest: "sha256:fixture",
            modified_at: "2026-08-31T00:00:00Z",
          },
        ],
      });
      return;
    }
    json(response, 404, { error: "not_found" });
  });

  const ollamaPort = await listen(ollama);
  const status = createGpuWorkerStatusServer({
    manifestPath,
    ollamaUrl: `http://127.0.0.1:${ollamaPort}`,
  });
  const statusPort = await listen(status);

  try {
    const base = `http://127.0.0.1:${statusPort}`;
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), {
      status: "ok",
    });
    assert.equal((await fetch(`${base}/readyz`)).status, 200);

    const inventory = await (await fetch(`${base}/v1/inventory`)).json();
    assert.equal(inventory.metadata.id, "office-rtx3090");
    assert.equal(inventory.spec.storage.durableApplicationData, false);
    assert.match(inventory.observedAt, /^\d{4}-\d{2}-\d{2}T/);

    const models = await (await fetch(`${base}/v1/models`)).json();
    assert.equal(models.data[0].id, "qwen3:14b");
    assert.equal(models.data[0].owned_by, "gpu-worker");

    assert.equal((await fetch(`${base}/missing`)).status, 404);
    assert.equal(
      (await fetch(`${base}/healthz`, { method: "POST" })).status,
      405,
    );
  } finally {
    await Promise.all([close(status), close(ollama)]);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("status readiness fails closed when Ollama is unavailable", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bmj-gpu-down-"));
  const manifestPath = resolve(directory, "node.json");
  writeFileSync(
    manifestPath,
    readFileSync("deploy/gpu-worker/node.example.json", "utf8"),
  );
  const status = createGpuWorkerStatusServer({
    manifestPath,
    ollamaUrl: "http://127.0.0.1:9",
  });
  const port = await listen(status);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).dependency, "ollama");
  } finally {
    await close(status);
    rmSync(directory, { recursive: true, force: true });
  }
});
