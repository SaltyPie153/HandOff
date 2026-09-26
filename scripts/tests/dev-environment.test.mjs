import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig, initializeEnv } from "../lib/dev-environment.mjs";

const valid = () => ({
  NODE_ENV: "development", API_PORT: "3000", WEB_PORT: "5173", DB_PORT: "5432",
  POSTGRES_USER: "handoff", POSTGRES_PASSWORD: "local-test-value", POSTGRES_DB: "handoff_dev",
  DATABASE_URL: "postgresql://handoff:local-test-value@127.0.0.1:5432/handoff_dev"
});

test("accepts matching local development configuration", () => {
  const result = validateConfig(valid());
  assert.equal(result.databaseName, "handoff_dev");
  assert.equal(result.databaseHost, "127.0.0.1");
});

test("rejects missing, remote, production and mismatched settings without exposing secrets", () => {
  for (const patch of [
    { POSTGRES_PASSWORD: "" }, { NODE_ENV: "production" },
    { DATABASE_URL: "postgresql://handoff:local-test-value@db.example.com:5432/handoff_dev" },
    { POSTGRES_DB: "handoff_test" }, { API_PORT: "invalid" }
  ]) {
    const config = { ...valid(), ...patch };
    assert.throws(() => validateConfig(config), error => {
      assert.match(error.message, /[A-Z_]+/);
      assert.doesNotMatch(error.message, /local-test-value|db\.example\.com/);
      return true;
    });
  }
});

test("reports malformed percent escapes in database credentials as a config error", () => {
  for (const databaseUrl of [
    "postgresql://bad%:local-test-value@127.0.0.1:5432/handoff_dev",
    "postgresql://handoff:bad%25%xx@127.0.0.1:5432/handoff_dev"
  ]) {
    assert.throws(() => validateConfig({ ...valid(), DATABASE_URL: databaseUrl }), error => {
      assert.equal(error.name, "ConfigError");
      assert.equal(error.code, "INVALID_DATABASE_URL");
      assert.equal(error.field, "DATABASE_URL");
      assert.doesNotMatch(error.message, /local-test-value|bad%/);
      return true;
    });
  }
});

test("initialization creates one local config and preserves it on repeat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoff-env-"));
  const path = join(dir, ".env");
  try {
    assert.equal(await initializeEnv(path), true);
    const original = await readFile(path, "utf8");
    assert.doesNotMatch(original, /CHANGE_ME/);
    assert.equal(await initializeEnv(path), false);
    assert.equal(await readFile(path, "utf8"), original);
    await writeFile(path, "custom=value\n");
    assert.equal(await initializeEnv(path), false);
    assert.equal(await readFile(path, "utf8"), "custom=value\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
