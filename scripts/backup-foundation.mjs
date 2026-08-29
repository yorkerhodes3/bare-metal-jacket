import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform, release } from "node:os";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

const composeFile = resolve(
  option(
    "--compose-file",
    process.env.BMJ_COMPOSE_FILE ?? "deploy/compose/docker-compose.yml",
  ),
);
const envFile = resolve(
  option("--env-file", process.env.BMJ_ENV_FILE ?? "deploy/compose/.env"),
);
const outputRoot = resolve(
  option("--output", process.env.BMJ_BACKUP_ROOT ?? "backups/foundation"),
);
const projectName = option(
  "--project-name",
  process.env.BMJ_PROJECT_NAME ?? "bare-metal-jacket",
);

if (!existsSync(composeFile)) throw new Error(`Missing ${composeFile}`);
if (!existsSync(envFile)) throw new Error(`Missing ${envFile}`);

function runText(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = (
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      `${command} failed`
    ).trim();
    throw new Error(detail);
  }
  return result.stdout.trim();
}

function runToFile(command, commandArgs, outputFile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = createWriteStream(outputFile, { mode: 0o640 });
    let stderr = "";
    let childStatus;
    let outputFinished = false;

    const complete = () => {
      if (childStatus === undefined || !outputFinished) return;
      if (childStatus !== 0) {
        reject(new Error(stderr.trim() || `${command} exited ${childStatus}`));
        return;
      }
      resolvePromise();
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    output.once("error", reject);
    child.stdout.pipe(output);
    output.once("finish", () => {
      outputFinished = true;
      complete();
    });
    child.once("close", (status) => {
      childStatus = status;
      complete();
    });
  });
}

function sha256File(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.once("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });
}

const compose = [
  "compose",
  "--env-file",
  envFile,
  "-f",
  composeFile,
  "--profile",
  "demo",
];
const docker = (commandArgs, options) =>
  runText("docker", [...compose, ...commandArgs], options);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDirectory = resolve(outputRoot, `foundation-${timestamp}`);
mkdirSync(backupDirectory, { recursive: true, mode: 0o750 });

const requiredServices = ["postgres", "redis", "registry", "hello", "traefik"];
const runningServices = new Set(
  docker(["ps", "--status", "running", "--services"])
    .split(/\r?\n/)
    .filter(Boolean),
);
const missingServices = requiredServices.filter(
  (service) => !runningServices.has(service),
);
if (missingServices.length > 0) {
  throw new Error(`Services are not running: ${missingServices.join(", ")}`);
}

const config = docker(["config"]);
const metadata = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  host: {
    hostname: hostname(),
    platform: platform(),
    release: release(),
  },
  projectName,
  source: {
    gitCommit: runText("git", ["rev-parse", "HEAD"]),
    composeFile: basename(composeFile),
    composeConfigSha256: createHash("sha256").update(config).digest("hex"),
  },
  runtime: {
    docker: runText("docker", ["version", "--format", "{{.Server.Version}}"]),
    compose: runText("docker", ["compose", "version", "--short"]),
  },
  secretsIncluded: false,
  interruption: {
    services: ["redis", "registry"],
    startedAt: null,
    completedAt: null,
  },
  files: [],
};

const postgresDump = resolve(backupDirectory, "postgres.dump");
const redisArchive = resolve(backupDirectory, "redis-volume.tar.gz");
const registryArchive = resolve(backupDirectory, "registry-volume.tar.gz");
let interrupted = false;

console.log(`Creating foundation backup in ${backupDirectory}`);

await runToFile(
  "docker",
  [
    ...compose,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-acl',
  ],
  postgresDump,
);
console.log("PASS  PostgreSQL logical dump");

docker([
  "exec",
  "-T",
  "redis",
  "sh",
  "-c",
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning SAVE',
]);

try {
  metadata.interruption.startedAt = new Date().toISOString();
  interrupted = true;
  docker(["stop", "redis", "registry"]);

  await runToFile(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      `${projectName}_redis-data:/source:ro`,
      "alpine:3.22",
      "tar",
      "-czf",
      "-",
      "-C",
      "/source",
      ".",
    ],
    redisArchive,
  );
  console.log("PASS  Redis volume archive");

  await runToFile(
    "docker",
    [
      "run",
      "--rm",
      "--volume",
      `${projectName}_registry-data:/source:ro`,
      "alpine:3.22",
      "tar",
      "-czf",
      "-",
      "-C",
      "/source",
      ".",
    ],
    registryArchive,
  );
  console.log("PASS  Registry volume archive");
} finally {
  if (interrupted) {
    docker(["up", "--detach", "--wait", "redis", "registry"]);
    metadata.interruption.completedAt = new Date().toISOString();
  }
}

for (const file of [postgresDump, redisArchive, registryArchive]) {
  metadata.files.push({
    name: basename(file),
    bytes: statSync(file).size,
    sha256: await sha256File(file),
  });
}

writeFileSync(
  resolve(backupDirectory, "manifest.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  { mode: 0o640 },
);

const interruptionSeconds =
  metadata.interruption.startedAt && metadata.interruption.completedAt
    ? Math.round(
        (Date.parse(metadata.interruption.completedAt) -
          Date.parse(metadata.interruption.startedAt)) /
          1000,
      )
    : 0;

console.log(`PASS  Manifest and SHA-256 checksums`);
console.log(
  `INFO  Redis/registry interruption: ${interruptionSeconds} seconds`,
);
console.log(`\nBackup complete: ${backupDirectory}`);
console.log(
  "Secrets were not included. Copy this directory off-host and retain the environment secrets separately.",
);
