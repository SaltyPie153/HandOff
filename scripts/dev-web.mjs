import { fileURLToPath } from 'node:url';
import { ConfigError, validateConfig } from './lib/dev-environment.mjs';

try {
  validateConfig(process.env);
} catch (error) {
  const diagnostic = error instanceof ConfigError ? error.message : 'INTERNAL_ERROR';
  process.stderr.write(`DEV_WEB_FAILED: ${diagnostic}\n`);
  process.exit(1);
}

process.chdir(fileURLToPath(new URL('../apps/web/', import.meta.url)));
await import('../apps/web/node_modules/vite/bin/vite.js');
