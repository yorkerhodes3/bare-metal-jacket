const discoveryUrl =
  process.env.PAGES_AI_PROXY_DISCOVERY_URL ??
  "https://ethical-tech-colab.github.io/War-Games/ai-proxy.json";
const allowedOrigin =
  process.env.PAGES_AI_PROXY_ORIGIN ?? "https://ethical-tech-colab.github.io";
const blockedOrigin =
  process.env.PAGES_AI_PROXY_BLOCKED_ORIGIN ?? "https://evil.example";
const live = process.env.PAGES_AI_PROXY_LIVE === "1";
const timeoutMs = Number(process.env.PAGES_AI_PROXY_TIMEOUT_MS ?? 120_000);

async function request(url, options = {}, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function endpoint(base, path) {
  return new URL(path, base);
}

async function expectStatus(name, url, status, options = {}, timeout = 20_000) {
  const started = performance.now();
  const response = await request(url, options, timeout);
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(
      `${name}: expected HTTP ${status}, received ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  console.log(
    `PASS  ${name}: HTTP ${status} in ${Math.round(performance.now() - started)} ms`,
  );
  return { response, text };
}

try {
  const discoveryResult = await expectStatus(
    "Discovery document",
    discoveryUrl,
    200,
  );
  const discovery = JSON.parse(discoveryResult.text);
  const chatUrl = new URL(process.env.PAGES_AI_PROXY_URL ?? discovery.proxyUrl);
  const baseUrl = new URL(chatUrl);
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  const headers = { Origin: allowedOrigin, Accept: "application/json" };
  const health = await expectStatus(
    "Proxy liveness",
    endpoint(baseUrl, "/healthz"),
    200,
    { headers },
  );
  if (JSON.parse(health.text).status !== "ok") {
    throw new Error("Proxy liveness body did not report ok");
  }

  const modelsResult = await expectStatus(
    "Model catalog",
    endpoint(baseUrl, "/v1/models"),
    200,
    { headers },
  );
  const models = JSON.parse(modelsResult.text).data ?? [];
  if (models.length === 0)
    throw new Error("Proxy returned an empty model catalog");

  await expectStatus("CORS preflight", chatUrl, 204, {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  await expectStatus("Blocked origin", chatUrl, 403, {
    method: "POST",
    headers: {
      Origin: blockedOrigin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (live) {
    const selectedModel =
      process.env.PAGES_AI_PROXY_MODEL ??
      models.find((model) => model.owned_by === "local")?.id;
    if (!selectedModel) {
      throw new Error(
        "Live inference requested but the catalog has no local model",
      );
    }
    const inference = await expectStatus(
      `Live local inference (${selectedModel})`,
      chatUrl,
      200,
      {
        method: "POST",
        headers: {
          Origin: allowedOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: "Reply with exactly BMJ_OK" }],
          max_tokens: 12,
          temperature: 0,
        }),
      },
      timeoutMs,
    );
    const reply = JSON.parse(inference.text).choices?.[0]?.message?.content;
    if (!reply) throw new Error("Live inference returned no assistant content");
    console.log(`INFO  Local model reply: ${reply.trim().slice(0, 80)}`);
  }

  console.log(`\nB3IQ proxy smoke passed via ${baseUrl.origin}.`);
  if (!live) {
    console.log(
      "INFO  Set PAGES_AI_PROXY_LIVE=1 to include one bounded local-model inference.",
    );
  }
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exitCode = 1;
}
