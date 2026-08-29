import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

function json(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(content),
  });
  response.end(content);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runSmoke(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/deployment-smoke.mjs"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("deployment smoke validates a healthy release and detects mismatch", async () => {
  const app = createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      json(response, 200, { status: "ok" });
    } else if (request.url === "/") {
      json(response, 200, { message: "test", release: "fixture-release" });
    } else {
      json(response, 404, { error: "not_found" });
    }
  });
  const registry = createServer((_request, response) => {
    json(response, 200, {});
  });

  const appPort = await listen(app);
  const registryPort = await listen(registry);
  const commonEnv = {
    ...process.env,
    BMJ_BASE_URL: `http://127.0.0.1:${appPort}`,
    BMJ_REGISTRY_URL: `http://127.0.0.1:${registryPort}`,
    BMJ_TIMEOUT_MS: "2000",
  };

  try {
    const passing = await runSmoke({
      ...commonEnv,
      BMJ_EXPECTED_RELEASE: "fixture-release",
    });
    assert.equal(passing.status, 0, passing.stderr || passing.stdout);
    assert.match(passing.stdout, /Deployment smoke passed/);

    const failing = await runSmoke({
      ...commonEnv,
      BMJ_EXPECTED_RELEASE: "wrong-release",
    });
    assert.notEqual(failing.status, 0);
    assert.match(failing.stderr, /Expected release wrong-release/);
  } finally {
    await Promise.all([close(app), close(registry)]);
  }
});
