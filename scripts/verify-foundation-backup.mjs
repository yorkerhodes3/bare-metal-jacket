import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function findLatest(root) {
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("foundation-"),
    )
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) throw new Error(`No backups found in ${root}`);
  return resolve(root, candidates.at(-1));
}

const requested = option(
  "--backup",
  process.env.BMJ_BACKUP_DIRECTORY ?? "backups/foundation",
);
const requestedPath = resolve(requested);
const backupDirectory = existsSync(resolve(requestedPath, "manifest.json"))
  ? requestedPath
  : findLatest(requestedPath);
const manifestPath = resolve(backupDirectory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function sha256File(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.once("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });
}

function runWithInput(command, commandArgs, inputFile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
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
    createReadStream(inputFile).pipe(child.stdin);
    child.once("close", (status) => {
      if (status !== 0) {
        reject(new Error(stderr.trim() || `${command} exited ${status}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
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
    child.once("close", (status) => {
      if (status !== 0) {
        reject(new Error(stderr.trim() || `${command} exited ${status}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

console.log(`Verifying foundation backup ${backupDirectory}`);

for (const file of manifest.files) {
  const path = resolve(backupDirectory, file.name);
  if (!existsSync(path)) throw new Error(`Missing ${file.name}`);
  const actual = await sha256File(path);
  if (actual !== file.sha256) {
    throw new Error(`Checksum mismatch for ${file.name}`);
  }
  console.log(`PASS  ${file.name} SHA-256`);
}

const postgresDump = resolve(backupDirectory, "postgres.dump");
const postgresList = await runWithInput(
  "docker",
  [
    "run",
    "--rm",
    "--interactive",
    "postgres:17-alpine",
    "pg_restore",
    "--list",
  ],
  postgresDump,
);
if (
  !postgresList.includes("Archive created at") ||
  !postgresList.includes("Format: CUSTOM")
) {
  throw new Error("PostgreSQL dump did not contain a valid archive catalog");
}
console.log("PASS  PostgreSQL archive catalog");

for (const name of ["redis-volume.tar.gz", "registry-volume.tar.gz"]) {
  const listing = await runWithInput(
    "docker",
    ["run", "--rm", "--interactive", "alpine:3.22", "tar", "-tzf", "-"],
    resolve(backupDirectory, name),
  );
  if (!listing.trim()) throw new Error(`${name} was empty`);
  console.log(`PASS  ${name} archive catalog`);
}

const restoreContainer = `bmj-restore-${randomUUID().slice(0, 8)}`;
const restorePassword = randomUUID().replaceAll("-", "");
let restoreContainerCreated = false;

try {
  await run("docker", [
    "run",
    "--detach",
    "--name",
    restoreContainer,
    "--env",
    `POSTGRES_PASSWORD=${restorePassword}`,
    "--env",
    "POSTGRES_DB=restore",
    "postgres:17-alpine",
  ]);
  restoreContainerCreated = true;

  let ready = false;
  let lastReadinessError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run("docker", [
        "exec",
        restoreContainer,
        "pg_isready",
        "--username",
        "postgres",
        "--dbname",
        "restore",
      ]);
      ready = true;
      break;
    } catch (error) {
      lastReadinessError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }
  if (!ready) {
    throw new Error("Disposable PostgreSQL restore target was not ready", {
      cause: lastReadinessError,
    });
  }

  await runWithInput(
    "docker",
    [
      "exec",
      "--interactive",
      restoreContainer,
      "pg_restore",
      "--username",
      "postgres",
      "--dbname",
      "restore",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
    ],
    postgresDump,
  );
  const restoredDatabase = await run("docker", [
    "exec",
    restoreContainer,
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "restore",
    "--tuples-only",
    "--command",
    "SELECT current_database();",
  ]);
  if (restoredDatabase.trim() !== "restore") {
    throw new Error("Disposable PostgreSQL restore query failed");
  }
  console.log("PASS  PostgreSQL restore into disposable container");
} finally {
  if (restoreContainerCreated) {
    await run("docker", ["rm", "--force", restoreContainer]);
  }
}

console.log(`\nBackup verified: ${basename(backupDirectory)}`);
