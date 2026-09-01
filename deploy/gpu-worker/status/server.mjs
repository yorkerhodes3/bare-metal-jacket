import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { pathToFileURL } from "node:url";

function json(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(content),
    "Content-Type": "application/json",
  });
  response.end(content);
}

async function fetchJson(fetchImpl, url, timeoutMs = 5_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }
  return response.json();
}

export function createGpuWorkerStatusServer(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const ollamaUrl = new URL(
    options.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  );
  const manifestPath =
    options.manifestPath ??
    process.env.NODE_MANIFEST_PATH ??
    "/etc/bare-metal-jacket/node.json";

  function readManifest() {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  }

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url, "http://gpu-worker.local");

    if (request.method !== "GET") {
      json(response, 405, { error: "method_not_allowed" });
      return;
    }

    if (url.pathname === "/healthz") {
      json(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname === "/readyz") {
      try {
        await fetchJson(fetchImpl, new URL("/api/tags", ollamaUrl));
        json(response, 200, { status: "ok" });
      } catch (error) {
        json(response, 503, {
          status: "unavailable",
          dependency: "ollama",
          detail: error.message,
        });
      }
      return;
    }

    if (url.pathname === "/v1/inventory") {
      try {
        json(response, 200, {
          ...readManifest(),
          observedAt: new Date().toISOString(),
        });
      } catch (error) {
        json(response, 500, {
          error: "manifest_unavailable",
          detail: error.message,
        });
      }
      return;
    }

    if (url.pathname === "/v1/models") {
      try {
        const tags = await fetchJson(
          fetchImpl,
          new URL("/api/tags", ollamaUrl),
        );
        json(response, 200, {
          object: "list",
          data: (tags.models ?? []).map((model) => ({
            id: model.name,
            object: "model",
            owned_by: "gpu-worker",
            size: model.size,
            digest: model.digest,
            modified_at: model.modified_at,
          })),
        });
      } catch (error) {
        json(response, 503, {
          error: "model_catalog_unavailable",
          detail: error.message,
        });
      }
      return;
    }

    json(response, 404, { error: "not_found" });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 9180);
  const server = createGpuWorkerStatusServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        event: "gpu_worker_status_started",
        port,
      }),
    );
  });
}
