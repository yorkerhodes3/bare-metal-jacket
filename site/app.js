const componentDetails = {
  developer: {
    label: "Entry boundary",
    title: "Console / API",
    copy: "Authenticates requests and records desired state. It cannot run arbitrary infrastructure commands or access the Docker socket.",
    items: [
      "OIDC authentication and project authorization",
      "Versioned resource contract",
      "Idempotent deployment requests",
    ],
  },
  control: {
    label: "Coordination boundary",
    title: "Control plane",
    copy: "PostgreSQL is the source of truth. Durable jobs turn desired state into bounded work that can resume after failure.",
    items: [
      "Leased, retry-safe jobs",
      "Monotonic deployment transitions",
      "Immutable administrative audit events",
    ],
  },
  build: {
    label: "Untrusted execution boundary",
    title: "Build adapter",
    copy: "Fetches one authorized commit and builds it in an isolated BuildKit worker. Source credentials never enter Dockerfile steps.",
    items: [
      "Disposable build context and resource limits",
      "BuildKit secret mounts instead of build arguments",
      "Digest, source commit, and provenance output",
    ],
  },
  registry: {
    label: "Artifact boundary",
    title: "OCI registry",
    copy: "Stores immutable release artifacts. Recorded releases use the image digest so a changed tag cannot substitute new content.",
    items: [
      "Scoped push and pull credentials",
      "Digest-addressed release identity",
      "Retention and restore verification",
    ],
  },
  runtime: {
    label: "Privileged host boundary",
    title: "Node agent",
    copy: "The only project component with local Docker Engine access. It accepts a narrow workload contract rather than a general Docker API.",
    items: [
      "No privileged mode or arbitrary host mounts",
      "CPU, memory, process, and storage limits",
      "Desired-generation reconciliation",
    ],
  },
  edge: {
    label: "Traffic boundary",
    title: "Traefik / Caddy",
    copy: "Routes to active, healthy release endpoints and owns certificate automation. Candidates remain private until readiness is stable.",
    items: [
      "Custom domain verification",
      "ACME certificate lifecycle",
      "Atomic route membership and drain",
    ],
  },
};

const datasets = {
  managed: {
    label: "Managed benchmarks",
    title: "The expected developer experience",
    copy: "Render and Railway set the parity bar for fast Git-to-production workflows, safe releases, and clear service state.",
    products: ["Render", "Railway", "Phase 1 target"],
    capabilities: [
      ["Git or image source", "yes", "yes", "yes"],
      ["Automatic TLS", "yes", "yes", "yes"],
      ["Health-gated activation", "yes", "yes", "yes"],
      ["Release rollback", "yes", "yes", "yes"],
      ["Persistent storage", "yes", "yes", "partial"],
      ["Preview environments", "yes", "yes", "no"],
      ["Configuration as code", "yes", "yes", "yes"],
      ["Owned bare metal", "no", "no", "yes"],
    ],
  },
  selfHosted: {
    label: "Self-hosted PaaS",
    title: "The closest product references",
    copy: "Coolify and Dokploy show broad workflows; CapRover and Dokku show smaller, mature Docker deployment models.",
    products: ["Coolify", "Dokploy", "CapRover", "Dokku"],
    capabilities: [
      ["Dashboard", "yes", "yes", "yes", "no"],
      ["Dockerfile", "yes", "yes", "yes", "yes"],
      ["Docker Compose", "yes", "yes", "partial", "partial"],
      ["Automatic TLS", "yes", "yes", "yes", "partial"],
      ["Deployment rollback", "partial", "yes", "yes", "yes"],
      ["Built-in backups", "yes", "yes", "partial", "partial"],
      ["Multi-server", "yes", "yes", "yes", "partial"],
      ["Preview workflow", "yes", "yes", "no", "partial"],
    ],
  },
  runtime: {
    label: "Runtime options",
    title: "Complexity must earn its place",
    copy: "Direct Docker is enough for one node. Distributed schedulers become relevant only when measured placement and recovery needs appear.",
    products: ["Docker adapter", "SwarmKit", "Nomad", "Kubernetes"],
    capabilities: [
      ["Single-node simplicity", "yes", "yes", "yes", "no"],
      ["Multi-node scheduling", "no", "yes", "yes", "yes"],
      ["Automatic reschedule", "no", "yes", "yes", "yes"],
      ["Rolling update", "partial", "yes", "yes", "yes"],
      ["Storage ecosystem", "partial", "partial", "yes", "yes"],
      ["Network policy", "partial", "partial", "partial", "yes"],
      ["OSI-open current release", "yes", "yes", "no", "yes"],
      ["Phase 1 recommendation", "yes", "no", "no", "no"],
    ],
  },
};

const featureLabels = {
  yes: "Included",
  partial: "Partial",
  no: "Not included",
};

function selectComponent(componentName) {
  const detail = componentDetails[componentName];
  if (!detail) return;

  document.querySelectorAll(".arch-node").forEach((node) => {
    node.classList.toggle(
      "is-active",
      node.dataset.component === componentName,
    );
  });

  document.querySelector("#component-label").textContent = detail.label;
  document.querySelector("#component-title").textContent = detail.title;
  document.querySelector("#component-copy").textContent = detail.copy;

  const list = document.querySelector("#component-list");
  list.replaceChildren(
    ...detail.items.map((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      return listItem;
    }),
  );
}

function featureBadge(value) {
  const badge = document.createElement("span");
  badge.className = `feature-${value}`;
  badge.textContent = featureLabels[value];
  return badge;
}

function renderComparison(datasetName) {
  const dataset = datasets[datasetName];
  if (!dataset) return;

  document.querySelector("#dataset-label").textContent = dataset.label;
  document.querySelector("#dataset-title").textContent = dataset.title;
  document.querySelector("#dataset-copy").textContent = dataset.copy;

  const headerRow = document.createElement("tr");
  const capabilityHeader = document.createElement("th");
  capabilityHeader.scope = "col";
  capabilityHeader.textContent = "Capability";
  headerRow.append(capabilityHeader);

  dataset.products.forEach((product) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = product;
    headerRow.append(header);
  });
  document.querySelector("#comparison-head").replaceChildren(headerRow);

  const rows = dataset.capabilities.map(([capability, ...values]) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = capability;
    row.append(name);

    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.append(featureBadge(value));
      row.append(cell);
    });
    return row;
  });

  document.querySelector("#comparison-body").replaceChildren(...rows);
}

document.querySelectorAll(".arch-node").forEach((node) => {
  node.addEventListener("click", () => selectComponent(node.dataset.component));
});

document.querySelectorAll(".comparison-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".comparison-tab").forEach((candidate) => {
      const selected = candidate === tab;
      candidate.classList.toggle("is-active", selected);
      candidate.setAttribute("aria-selected", String(selected));
    });
    renderComparison(tab.dataset.dataset);
  });
});

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const revealElements = document.querySelectorAll(".reveal");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
  );

  revealElements.forEach((element) => observer.observe(element));
}

renderComparison("managed");
