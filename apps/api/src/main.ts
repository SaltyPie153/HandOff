import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule, type ApiConfig } from './app.module.js';

const host = '127.0.0.1';

class ApiStartError extends Error {
  constructor(readonly code: string, readonly field: string) {
    super(`${code}: ${field}`);
  }
}

function isPortInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'EADDRINUSE';
}

async function closeApp(app: INestApplication): Promise<void> {
  const server = app.getHttpServer() as { closeAllConnections?: () => void };
  server.closeAllConnections?.();
  let deadline: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('CLEANUP_TIMEOUT')), 2_000);
      })
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

export async function startApi(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), { logger: false });
  try {
    await app.listen(config.apiPort, host);
    return app;
  } catch (error) {
    try { await closeApp(app); } catch { /* Preserve the startup failure. */ }
    if (isPortInUse(error)) {
      throw new ApiStartError('PORT_IN_USE', 'API_PORT');
    }
    throw error;
  }
}

async function runCli(): Promise<void> {
  const configModulePath = '../../../../scripts/lib/dev-environment.mjs';
  const { validateConfig, ConfigError } = await import(configModulePath) as {
    validateConfig(input: NodeJS.ProcessEnv): ApiConfig;
    ConfigError: new (...args: string[]) => Error & { code: string; field: string };
  };
  let config: ApiConfig;
  try {
    config = validateConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) throw new ApiStartError(error.code, error.field);
    throw error;
  }
  const app = await startApi(config);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void closeApp(app).then(() => process.exit(0), () => process.exit(1));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli().catch((error: unknown) => {
    const diagnostic = error instanceof ApiStartError
      ? error.message
      : 'INTERNAL_ERROR';
    process.stderr.write(`API_START_FAILED: ${diagnostic}\n`);
    process.exitCode = 1;
  });
}
