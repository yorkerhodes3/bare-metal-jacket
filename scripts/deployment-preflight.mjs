import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { arch, cpus, freemem, platform, release, totalmem } from "node:os";

const envFile = process.env.BMJ_ENV_FILE ?? "deploy/compose/.env";
const composeFile =
  process.env.BMJ_COMPOSE_FILE ?? "deploy/compose/docker-compose.yml";
const allowOccupied = process.env.BMJ_ALLOW_OCCUPIED === "1";

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
  });
}

function firstLine(value) {
  return value.trim().split(/\r?\n/, 1)[0];
}

function checkCommand(name, args) {
  const result = run(name, args);
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      detail: firstLine(
        result.error?.message ||
          result.stderr ||
          result.stdout ||
          `${name} unavailable`,
      ),
    };
  }
  return { ok: true, detail: firstLine(result.stdout) };
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      resolve({
        ok: allowOccupied,
        detail: `127.0.0.1:${port} is occupied (${error.code})`,
      });
    });
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() =>
        resolve({ ok: true, detail: `127.0.0.1:${port} is available` }),
      );
    });
  });
}

const checks = [
  ["Docker CLI", checkCommand("docker", ["--version"])],
  [
    "Docker Engine",
    checkCommand("docker", ["info", "--format", "{{.ServerVersion}}"]),
  ],
  ["Docker Compose", checkCommand("docker", ["compose", "version"])],
  [
    "Compose model",
    checkCommand("docker", [
      "compose",
      "--env-file",
      envFile,
      "-f",
      composeFile,
      "--profile",
      "demo",
      "config",
      "--quiet",
    ]),
  ],
];

for (const port of [5000, 5432, 6379, 8080]) {
  checks.push([`Port ${port}`, await checkPort(port)]);
}

console.log(
  [
    "Bare Metal Jacket deployment preflight",
    `Host: ${platform()} ${release()} (${arch()})`,
    `CPU: ${cpus().length} logical cores`,
    `Memory: ${(totalmem() / 1024 ** 3).toFixed(1)} GiB total, ${(freemem() / 1024 ** 3).toFixed(1)} GiB free`,
    `Environment: ${envFile}`,
    "",
  ].join("\n"),
);

for (const [name, result] of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${name}: ${result.detail}`);
}

const failures = checks.filter(([, result]) => !result.ok);
if (failures.length > 0) {
  console.error(
    `\nPreflight failed ${failures.length} check(s). See docs/operations/deployment-testing.md.`,
  );
  process.exitCode = 1;
} else {
  console.log("\nPreflight passed. The foundation can be started safely.");
}
