import { createServer } from 'node:net';
import react from '@vitejs/plugin-react';
import type { WarningHandlerWithDefault } from 'rolldown';
import { defineConfig, type Plugin } from 'vite';

const host = '127.0.0.1';
const onwarn: WarningHandlerWithDefault = (warning, defaultHandler) => {
  const id = warning.id?.replaceAll('\\', '/');
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
      warning.message.includes('use client') &&
      id?.includes('/node_modules/@mui/')) return;
  defaultHandler(warning);
};

function configuredPort(name: 'WEB_PORT' | 'API_PORT'): number {
  const value = process.env[name];
  const port = Number(value);
  if (!value || !/^\d+$/.test(value) || port < 1 || port > 65535) {
    process.stderr.write(`DEV_WEB_FAILED: INVALID_PORT: ${name}\n`);
    process.exit(1);
  }
  return port;
}

async function requireFreeWebPort(port: number): Promise<void> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    process.stderr.write(code === 'EADDRINUSE'
      ? 'DEV_WEB_FAILED: PORT_IN_USE: WEB_PORT\n'
      : 'DEV_WEB_FAILED: BIND_FAILED: WEB_PORT\n');
    process.exit(1);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}

function finalBindDiagnostic(port: number): Plugin {
  return {
    name: 'handoff-final-bind-diagnostic',
    configureServer(server) {
      const listen = server.listen.bind(server);
      server.listen = async (...args) => {
        try {
          return await listen(...args);
        } catch (error) {
          if (error instanceof Error && error.message === 'Port ' + port + ' is already in use') {
            process.stderr.write('DEV_WEB_FAILED: PORT_IN_USE: WEB_PORT\n');
            process.exit(1);
          }
          throw error;
        }
      };
    }
  };
}

export default defineConfig(async ({ command }) => {
  const serving = command === 'serve';
  const webPort = serving ? configuredPort('WEB_PORT') : 5173;
  const apiPort = serving ? configuredPort('API_PORT') : 3000;
  if (serving) await requireFreeWebPort(webPort);

  return {
    plugins: [react(), ...(serving ? [finalBindDiagnostic(webPort)] : [])],
    envPrefix: 'HANDOFF_PUBLIC_',
    server: {
      host,
      port: webPort,
      strictPort: true,
      proxy: { '/api': { target: `http://${host}:${apiPort}` } }
    },
    build: {
      rolldownOptions: { onwarn }
    }
  };
});
