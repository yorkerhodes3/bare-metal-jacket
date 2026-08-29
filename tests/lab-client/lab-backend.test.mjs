import assert from "node:assert/strict";
import test from "node:test";
import {
  createLabBackend,
  LabBackendError,
} from "../../site/sdk/lab-backend.js";

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("client normalizes current proxy discovery and sends AI chat", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("ai-proxy.json")) {
      return response(200, {
        proxyUrl: "https://proxy.example/v1/chat/completions",
        cloudModels: [],
        localModels: ["gemma3:12b"],
        updated: "2026-08-29T00:00:00Z",
      });
    }
    if (String(url).endsWith("/healthz")) {
      return response(200, { status: "ok" });
    }
    if (String(url).endsWith("/v1/models")) {
      return response(200, {
        data: [{ id: "gemma3:12b", owned_by: "local" }],
      });
    }
    if (String(url).endsWith("/v1/chat/completions")) {
      return response(200, {
        choices: [{ message: { content: "hello" } }],
      });
    }
    return response(404, { error: "not found" });
  };

  const backend = await createLabBackend({
    project: "example-project",
    fetchImpl,
    discoveryUrl: "https://pages.example/ai-proxy.json",
  });

  assert.deepEqual(await backend.health(), { status: "ok" });
  assert.deepEqual(await backend.models(), [
    { id: "gemma3:12b", owned_by: "local" },
  ]);
  const chat = await backend.chat({
    model: "gemma3:12b",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(chat.choices[0].message.content, "hello");

  const post = calls.find((call) => call.init.method === "POST");
  assert.equal(JSON.parse(post.init.body).max_tokens, 512);
  assert.equal(
    post.init.headers.Authorization,
    undefined,
    "browser helper must not send a provider token",
  );
});

test("client exposes retryable rate-limit errors", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("discovery.json")) {
      return response(200, {
        schemaVersion: 1,
        project: "example-project",
        capabilities: ["ai.chat"],
        endpoints: {
          health: "https://api.example/healthz",
          aiChat: "https://api.example/v1/projects/example-project/ai/chat",
        },
      });
    }
    return response(429, { error: "Try again later" });
  };

  const backend = await createLabBackend({
    project: "example-project",
    discoveryUrl: "https://pages.example/discovery.json",
    fetchImpl,
  });

  await assert.rejects(
    backend.chat({
      model: "gemma3:12b",
      messages: [{ role: "user", content: "hello" }],
    }),
    (error) => {
      assert(error instanceof LabBackendError);
      assert.equal(error.kind, "rate_limited");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("shared helper reports unavailable capabilities clearly", async () => {
  const backend = await createLabBackend({
    project: "example-project",
    discoveryUrl: "https://pages.example/discovery.json",
    fetchImpl: async () =>
      response(200, {
        schemaVersion: 1,
        capabilities: ["ai.chat"],
        endpoints: { health: "https://api.example/healthz" },
      }),
  });

  await assert.rejects(
    backend.submitForm("contact", { message: "hello" }),
    (error) => {
      assert.equal(error.kind, "capability_unavailable");
      assert.match(error.message, /forms\.submit/);
      return true;
    },
  );
});

test("chat can be cancelled by the caller", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("discovery.json")) {
      return response(200, {
        schemaVersion: 1,
        project: "example-project",
        capabilities: ["ai.chat"],
        endpoints: {
          health: "https://api.example/healthz",
          aiChat: "https://api.example/v1/chat",
        },
      });
    }

    return new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };
  const backend = await createLabBackend({
    project: "example-project",
    discoveryUrl: "https://pages.example/discovery.json",
    fetchImpl,
  });
  const controller = new AbortController();
  const request = backend.chat({
    model: "gemma3:12b",
    messages: [{ role: "user", content: "hello" }],
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(request, (error) => {
    assert.equal(error.kind, "cancelled");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("v1 form endpoint expands project and form templates", async () => {
  let submission;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("discovery.json")) {
      return response(200, {
        schemaVersion: 1,
        project: "example-project",
        capabilities: ["forms.submit"],
        endpoints: {
          health: "https://api.example/healthz",
          config: "https://api.example/v1/projects/example-project/config",
          formSubmissions:
            "https://api.example/v1/projects/{project}/forms/{form}/submissions",
        },
        updatedAt: "2026-08-29T00:00:00Z",
      });
    }
    submission = { url: String(url), init };
    return response(202, {
      id: "00000000-0000-4000-8000-000000000000",
      acceptedAt: "2026-08-29T00:00:00Z",
    });
  };
  const backend = await createLabBackend({
    project: "example-project",
    discoveryUrl: "https://pages.example/discovery.json",
    fetchImpl,
  });

  await backend.submitForm(
    "contact",
    { message: "hello" },
    { idempotencyKey: "00000000-0000-4000-8000-000000000001" },
  );

  assert.equal(
    submission.url,
    "https://api.example/v1/projects/example-project/forms/contact/submissions",
  );
  assert.equal(
    submission.init.headers["Idempotency-Key"],
    "00000000-0000-4000-8000-000000000001",
  );
});
