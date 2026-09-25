import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/dev-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const composePath = fileURLToPath(new URL("../compose.dev.yml", import.meta.url));
const action = process.argv[2];
if (!["up", "down"].includes(action)) {
  console.error("USAGE: db.mjs up|down");
  process.exit(1);
}

try {
  await loadConfig(envPath);
  const args = ["compose", "--project-name", "handoff-dev", "--env-file", envPath, "-f", composePath, action];
  if (action === "up") args.push("-d", "--wait", "--wait-timeout", "60");
  const child = spawn("docker", args, { cwd: root, stdio: "inherit", windowsHide: true });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", value => resolve(value ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  console.error(`DB_COMMAND_FAILED: ${error.code === "ENOENT" ? "DOCKER_NOT_FOUND" : error.code ?? "UNKNOWN"}`);
  process.exitCode = 1;
}
