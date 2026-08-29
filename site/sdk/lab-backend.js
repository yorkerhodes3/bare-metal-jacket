const DEFAULT_DISCOVERY_URL =
  "https://ethical-tech-colab.github.io/War-Games/ai-proxy.json";
const DEFAULT_TIMEOUT_MS = 30_000;

export class LabBackendError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "LabBackendError";
    this.kind = options.kind ?? "unknown";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

function requiredProjectSlug(value) {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
  ) {
    throw new LabBackendError(
      "project must be a lowercase slug such as evacuation-map",
      { kind: "configuration" },
    );
  }
  return value;
}

function endpointFromChat(chatUrl, path) {
  const endpoint = new URL(chatUrl);
  endpoint.pathname = endpoint.pathname.replace(
    /\/v1\/chat\/completions\/?$/,
    path,
  );
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.href;
}

function normalizeDiscovery(document, project) {
  if (!document || typeof document !== "object") {
    throw new LabBackendError("Backend discovery was not a JSON object", {
      kind: "configuration",
    });
  }

  if (typeof document.proxyUrl === "string") {
    return {
      schemaVersion: 0,
      project,
      mode: "shared",
      capabilities: ["ai.chat"],
      endpoints: {
        aiChat: document.proxyUrl,
        config: endpointFromChat(document.proxyUrl, "/config"),
        health: endpointFromChat(document.proxyUrl, "/healthz"),
        models: endpointFromChat(document.proxyUrl, "/v1/models"),
      },
      models: [
        ...(document.cloudModels ?? []),
        ...(document.localModels ?? []),
      ],
      updatedAt: document.updated ?? null,
    };
  }

  const endpoints = document.endpoints;
  if (!endpoints || typeof endpoints.health !== "string") {
    throw new LabBackendError("Backend discovery is missing endpoints.health", {
      kind: "configuration",
    });
  }
  if (document.project && document.project !== project) {
    throw new LabBackendError(
      `Backend discovery belongs to ${document.project}, not ${project}`,
      { kind: "configuration" },
    );
  }

  return {
    schemaVersion: document.schemaVersion ?? 1,
    project: document.project ?? project,
    mode: document.mode ?? "shared",
    capabilities: Array.isArray(document.capabilities)
      ? [...document.capabilities]
      : [],
    endpoints: { ...endpoints },
    models: Array.isArray(document.models) ? [...document.models] : [],
    updatedAt: document.updatedAt ?? null,
  };
}

function classifyStatus(status) {
  if (status === 429) return { kind: "rate_limited", retryable: true };
  if (status === 408) return { kind: "timeout", retryable: true };
  if (status === 401 || status === 403) {
    return { kind: "forbidden", retryable: false };
  }
  if (status >= 500) return { kind: "unavailable", retryable: true };
  return { kind: "request", retryable: false };
}

async function parseResponse(response) {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text) return null;
  if (type.includes("json")) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new LabBackendError("Backend returned invalid JSON", {
        kind: "invalid_response",
        status: response.status,
        cause: error,
      });
    }
  }
  return text;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const timeoutController = new AbortController();
  const callerSignal = options.signal;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    return await fetchImpl(url, { ...options, signal });
  } catch (error) {
    if (error.name === "AbortError") {
      if (!timedOut && callerSignal?.aborted) {
        throw new LabBackendError("Backend request was cancelled", {
          kind: "cancelled",
          retryable: false,
          cause: error,
        });
      }
      throw new LabBackendError(
        `Backend did not respond within ${timeoutMs} ms`,
        { kind: "timeout", retryable: true, cause: error },
      );
    }
    throw new LabBackendError("Backend is unreachable", {
      kind: "unavailable",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function createLabBackend(options) {
  const project = requiredProjectSlug(options?.project);
  const discoveryUrl = options.discoveryUrl ?? DEFAULT_DISCOVERY_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    throw new LabBackendError("A Fetch API implementation is required", {
      kind: "configuration",
    });
  }

  let discovery;

  async function request(url, init = {}, requestTimeout = timeoutMs) {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        cache: init.method === "POST" ? "no-store" : "no-cache",
        ...init,
      },
      requestTimeout,
    );
    const body = await parseResponse(response);

    if (!response.ok) {
      const classification = classifyStatus(response.status);
      const message =
        body?.error ??
        body?.detail ??
        `Backend request failed with HTTP ${response.status}`;
      throw new LabBackendError(message, {
        ...classification,
        status: response.status,
        details: body,
      });
    }
    return body;
  }

  async function refresh() {
    const document = await request(discoveryUrl, {
      headers: { Accept: "application/json" },
    });
    discovery = normalizeDiscovery(document, project);
    return discovery;
  }

  await refresh();

  function requireEndpoint(name, capability) {
    const endpoint = discovery.endpoints[name];
    if (!endpoint) {
      throw new LabBackendError(
        `${capability} is not enabled for ${project}. Request it through the lab backend workflow.`,
        { kind: "capability_unavailable", retryable: false },
      );
    }
    return endpoint;
  }

  return {
    project,
    get discovery() {
      return structuredClone(discovery);
    },
    refresh,
    async health() {
      return request(requireEndpoint("health", "health"));
    },
    async config() {
      return request(requireEndpoint("config", "project configuration"));
    },
    async models() {
      const result = await request(requireEndpoint("models", "ai.chat"));
      return result?.data ?? result?.models ?? [];
    },
    async chat({
      model,
      messages,
      maxTokens = 512,
      temperature = 0.7,
      timeout = 120_000,
      signal,
    }) {
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new LabBackendError("chat messages must be a non-empty array", {
          kind: "configuration",
        });
      }
      return request(
        requireEndpoint("aiChat", "ai.chat"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
          signal,
        },
        timeout,
      );
    },
    async submitForm(form, values, { idempotencyKey } = {}) {
      if (
        typeof form !== "string" ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(form)
      ) {
        throw new LabBackendError("form must be a lowercase slug", {
          kind: "configuration",
        });
      }
      const template = requireEndpoint("formSubmissions", "forms.submit");
      const endpoint = template
        .replace("{project}", encodeURIComponent(project))
        .replace("{form}", encodeURIComponent(form));

      return request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
        },
        body: JSON.stringify({ values }),
      });
    },
  };
}

export const labBackendDefaults = Object.freeze({
  discoveryUrl: DEFAULT_DISCOVERY_URL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
