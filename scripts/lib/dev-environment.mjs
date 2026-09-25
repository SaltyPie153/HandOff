import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const required = [
  "NODE_ENV", "API_PORT", "WEB_PORT", "DB_PORT",
  "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL"
];

export class ConfigError extends Error {
  constructor(code, field) {
    super(`${code}: ${field}`);
    this.name = "ConfigError";
    this.code = code;
    this.field = field;
  }
}

function localHost(value) {
  return value === "127.0.0.1" || value === "localhost" || value === "[::1]";
}

function port(value, field) {
  if (!/^[0-9]+$/.test(value ?? "")) throw new ConfigError("INVALID_PORT", field);
  const number = Number(value);
  if (number < 1 || number > 65535) throw new ConfigError("INVALID_PORT", field);
  return number;
}

export function validateConfig(input) {
  for (const field of required) {
    if (!input[field] || String(input[field]).trim() === "") {
      throw new ConfigError("MISSING_SETTING", field);
    }
  }
  if (!["development", "test"].includes(input.NODE_ENV)) {
    throw new ConfigError("UNSAFE_ENVIRONMENT", "NODE_ENV");
  }
  if (!["handoff_dev", "handoff_test"].includes(input.POSTGRES_DB)) {
    throw new ConfigError("UNSAFE_DATABASE", "POSTGRES_DB");
  }
  const apiPort = port(input.API_PORT, "API_PORT");
  const webPort = port(input.WEB_PORT, "WEB_PORT");
  const dbPort = port(input.DB_PORT, "DB_PORT");
  if (new Set([apiPort, webPort, dbPort]).size !== 3) {
    throw new ConfigError("PORT_COLLISION", "PORT");
  }
  let url;
  try { url = new URL(input.DATABASE_URL); }
  catch { throw new ConfigError("INVALID_DATABASE_URL", "DATABASE_URL"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    throw new ConfigError("INVALID_DATABASE_URL", "DATABASE_URL");
  }
  if (!localHost(url.hostname)) throw new ConfigError("UNSAFE_DATABASE_HOST", "DATABASE_URL");
  if (url.search || url.hash || url.pathname !== `/${input.POSTGRES_DB}` ||
      decodeURIComponent(url.username) !== input.POSTGRES_USER ||
      decodeURIComponent(url.password) !== input.POSTGRES_PASSWORD ||
      Number(url.port || "5432") !== dbPort) {
    throw new ConfigError("DATABASE_SETTING_MISMATCH", "DATABASE_URL");
  }
  return {
    nodeEnv: input.NODE_ENV,
    apiPort, webPort, dbPort,
    databaseName: input.POSTGRES_DB,
    databaseHost: url.hostname,
    postgresUser: input.POSTGRES_USER,
    postgresPassword: input.POSTGRES_PASSWORD,
    databaseUrl: input.DATABASE_URL
  };
}

export function parseEnv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) throw new ConfigError("INVALID_ENV_FILE", "ENV_FILE");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new ConfigError("INVALID_ENV_FILE", "ENV_FILE");
    result[key] = value;
  }
  return result;
}

export async function loadConfig(path, overrides = {}) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") throw new ConfigError("MISSING_ENV_FILE", "ENV_FILE");
    throw error;
  }
  return validateConfig({ ...parseEnv(text), ...overrides });
}

export async function initializeEnv(path) {
  const password = randomBytes(24).toString("base64url");
  const user = "handoff";
  const name = "handoff_dev";
  const values = {
    NODE_ENV: "development",
    API_PORT: "3000", WEB_PORT: "5173", DB_PORT: "5432",
    POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: name,
    DATABASE_URL: `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:5432/${name}`
  };
  const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
