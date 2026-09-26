import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "./lib/dev-environment.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const composePath = fileURLToPath(new URL("../compose.dev.yml", import.meta.url));

function mismatch() {
  return Object.assign(new Error("COMPOSE_PROJECT_MISMATCH"), { code: "COMPOSE_PROJECT_MISMATCH" });
}

function samePath(actual, expected) {
  return typeof actual === "string" &&
    resolve(actual).replaceAll("\\", "/").toLowerCase() ===
    resolve(expected).replaceAll("\\", "/").toLowerCase();
}

async function defaultRunDocker(args, options) {
  const { stdout } = await execFileAsync("docker", args, options);
  return stdout;
}

async function checkedDocker(runDocker, args, options) {
  try {
    return await runDocker(args, options);
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    throw Object.assign(new Error("DOCKER_UNAVAILABLE"), { code: "DOCKER_UNAVAILABLE" });
  }
}

async function projectIsOwned(rootPath, composeFile, runDocker, childEnv) {
  const options = { cwd: rootPath, env: childEnv, windowsHide: true };
  const ids = (await checkedDocker(runDocker, [
    "ps", "--all", "--quiet", "--filter", "label=com.docker.compose.project=handoff-dev"
  ], options)).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const rawLabels = await checkedDocker(runDocker, [
      "inspect", "--format", "{{json .Config.Labels}}", id
    ], options);
    let labels;
    try {
      labels = JSON.parse(rawLabels.trim());
    } catch {
      throw mismatch();
    }
    if (labels?.["com.docker.compose.project"] !== "handoff-dev" ||
        !samePath(labels["com.docker.compose.project.working_dir"], rootPath) ||
        !samePath(labels["com.docker.compose.project.config_files"], composeFile)) {
      throw mismatch();
    }
  }
}

export async function runDbCommand(action, {
  envPath: configPath = envPath,
  root: rootPath = root,
  composePath: composeFile = composePath,
  parentEnv = process.env,
  runDocker = defaultRunDocker,
  spawnImpl = spawn
} = {}) {
  if (!["up", "down"].includes(action)) throw Object.assign(new Error("INVALID_ACTION"), { code: "INVALID_ACTION" });
  const config = await loadConfig(configPath);
  const childEnv = {
    ...parentEnv,
    POSTGRES_USER: config.postgresUser,
    POSTGRES_PASSWORD: config.postgresPassword,
    POSTGRES_DB: config.databaseName,
    DB_PORT: String(config.dbPort)
  };
  await projectIsOwned(rootPath, composeFile, runDocker, childEnv);
  const args = ["compose", "--project-name", "handoff-dev", "--env-file", configPath, "-f", composeFile, action];
  if (action === "up") args.push("-d", "--wait", "--wait-timeout", "60");
  const child = spawnImpl("docker", args, { cwd: rootPath, stdio: "inherit", windowsHide: true, env: childEnv });
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", value => resolve(value ?? 1));
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const action = process.argv[2];
  if (!["up", "down"].includes(action)) {
    console.error("USAGE: db.mjs up|down");
    process.exit(1);
  }
  try {
    process.exitCode = await runDbCommand(action);
  } catch (error) {
    console.error(`DB_COMMAND_FAILED: ${error.code === "ENOENT" ? "DOCKER_NOT_FOUND" : error.code ?? "UNKNOWN"}`);
    process.exitCode = 1;
  }
}
