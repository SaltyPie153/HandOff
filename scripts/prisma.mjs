import { runPrismaCommand } from './lib/prisma-command.mjs';

const action = process.argv[2];
if (!['generate', 'migrate'].includes(action)) {
  console.error('USAGE: prisma.mjs generate|migrate');
  process.exit(1);
}

try {
  process.exitCode = await runPrismaCommand(action);
} catch (error) {
  console.error(`PRISMA_COMMAND_FAILED: ${error.code ?? 'UNKNOWN'}`);
  process.exitCode = 1;
}
