const statusUrl = new URL(
  process.env.BMJ_GPU_WORKER_STATUS_URL ?? "http://127.0.0.1:9180",
);
const inferenceUrl = new URL(
  process.env.BMJ_GPU_WORKER_INFERENCE_URL ?? "http://127.0.0.1:11434",
);
const live = process.env.BMJ_GPU_WORKER_LIVE === "1";
const preferredModel = process.env.BMJ_GPU_WORKER_MODEL;
const timeoutMs = Number(process.env.BMJ_GPU_WORKER_TIMEOUT_MS ?? 180_000);

async function fetchJson(url, options = {}, timeout = 15_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${url} returned HTTP ${response.status}: ${text.slice(0, 160)}`,
    );
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON: ${text.slice(0, 160)}`);
  }
  return body;
}

function endpoint(base, path) {
  return new URL(path, base);
}

try {
  const health = await fetchJson(endpoint(statusUrl, "/healthz"));
  if (health.status !== "ok") throw new Error("Worker liveness is not ok");
  console.log("PASS  Worker liveness");

  const readiness = await fetchJson(endpoint(statusUrl, "/readyz"));
  if (readiness.status !== "ok") throw new Error("Worker readiness is not ok");
  console.log("PASS  Worker readiness");

  const inventory = await fetchJson(endpoint(statusUrl, "/v1/inventory"));
  if (inventory.spec?.role !== "inference-worker") {
    throw new Error("Worker inventory has the wrong role");
  }
  if (inventory.spec?.storage?.durableApplicationData !== false) {
    throw new Error("Worker inventory allows durable application data");
  }
  console.log(
    `PASS  Inventory: ${inventory.metadata?.id} / ${inventory.spec.capacity?.gpu?.model}`,
  );

  const statusModels = await fetchJson(endpoint(statusUrl, "/v1/models"));
  const ollamaModels = await fetchJson(endpoint(inferenceUrl, "/v1/models"));
  const models = ollamaModels.data ?? statusModels.data ?? [];
  if (models.length === 0) throw new Error("Worker model catalog is empty");
  console.log(`PASS  Model catalog: ${models.length} installed`);

  if (live) {
    const model =
      preferredModel ??
      models.find((candidate) => candidate.id === "qwen3:14b")?.id ??
      models[0].id;
    const started = performance.now();
    const completion = await fetchJson(
      endpoint(inferenceUrl, "/v1/chat/completions"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "user", content: "Reply with exactly GPU_WORKER_OK" },
          ],
          max_tokens: 16,
          temperature: 0,
        }),
      },
      timeoutMs,
    );
    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Worker inference returned no content");
    console.log(
      `PASS  Live inference (${model}) in ${Math.round(performance.now() - started)} ms: ${reply.slice(0, 80)}`,
    );
  }

  console.log(`\nGPU worker smoke passed via ${statusUrl.origin}.`);
  if (!live) {
    console.log(
      "INFO  Set BMJ_GPU_WORKER_LIVE=1 to include one bounded inference.",
    );
  }
} catch (error) {
  const detail = error.cause?.message ?? error.message;
  console.error(`FAIL  ${detail}`);
  process.exitCode = 1;
}
