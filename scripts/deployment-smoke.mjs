const baseUrl = new URL(process.env.BMJ_BASE_URL ?? "http://127.0.0.1:8080");
const registryUrl = new URL(
  process.env.BMJ_REGISTRY_URL ?? "http://127.0.0.1:5000",
);
const expectedRelease = process.env.BMJ_EXPECTED_RELEASE ?? "local-demo";
const timeoutMs = Number(process.env.BMJ_TIMEOUT_MS ?? 10_000);

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonCheck(name, url, expectedStatus, validate) {
  const started = performance.now();
  const response = await request(url, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${name}: response was not JSON: ${text.slice(0, 160)}`);
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      `${name}: expected HTTP ${expectedStatus}, received ${response.status}: ${text.slice(0, 160)}`,
    );
  }
  validate(body);
  console.log(
    `PASS  ${name}: HTTP ${response.status} in ${Math.round(performance.now() - started)} ms`,
  );
}

function endpoint(base, path) {
  return new URL(path, base);
}

try {
  await jsonCheck("Liveness", endpoint(baseUrl, "/healthz"), 200, (body) => {
    if (body.status !== "ok") throw new Error("Liveness status is not ok");
  });

  await jsonCheck("Readiness", endpoint(baseUrl, "/readyz"), 200, (body) => {
    if (body.status !== "ok") throw new Error("Readiness status is not ok");
  });

  await jsonCheck("Active release", endpoint(baseUrl, "/"), 200, (body) => {
    if (body.release !== expectedRelease) {
      throw new Error(
        `Expected release ${expectedRelease}, received ${body.release ?? "(missing)"}`,
      );
    }
  });

  await jsonCheck(
    "Unknown route",
    endpoint(baseUrl, "/missing"),
    404,
    (body) => {
      if (body.error !== "not_found") {
        throw new Error("Unknown route did not return the expected error");
      }
    },
  );

  const registryStarted = performance.now();
  const registryResponse = await request(endpoint(registryUrl, "/v2/"));
  if (registryResponse.status !== 200) {
    throw new Error(
      `Registry: expected HTTP 200, received ${registryResponse.status}`,
    );
  }
  console.log(
    `PASS  Registry API: HTTP 200 in ${Math.round(performance.now() - registryStarted)} ms`,
  );
  console.log(
    `\nDeployment smoke passed for ${baseUrl.origin} at release ${expectedRelease}.`,
  );
} catch (error) {
  const detail = error.cause?.message ?? error.message;
  console.error(`FAIL  ${detail}`);
  process.exitCode = 1;
}
