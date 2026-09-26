import { fileURLToPath } from "node:url";
import { initializeEnv } from "./lib/dev-environment.mjs";

const path = fileURLToPath(new URL("../.env", import.meta.url));
try {
  const created = await initializeEnv(path);
  console.log(created ? "Development environment created in .env" : "Existing .env preserved");
} catch (error) {
  console.error(`ENV_INIT_FAILED: ${error.code ?? "IO_ERROR"}`);
  process.exitCode = 1;
}
