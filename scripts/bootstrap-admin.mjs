import { PrismaService } from '../apps/api/dist/src/database/prisma.service.js';
import { AuthRepository } from '../apps/api/dist/src/auth/auth.repository.js';

const userId = process.argv[2];
if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || !process.env.DATABASE_URL) {
  process.stderr.write('USAGE: node --env-file=.env scripts/bootstrap-admin.mjs <existing-user-uuid>\n');
  process.exit(1);
}

const prisma = new PrismaService({ databaseUrl: process.env.DATABASE_URL });
try {
  await new AuthRepository(prisma).bootstrapAdmin(userId);
  process.stdout.write(`INITIAL_ADMIN_SET: ${userId}\n`);
} catch (error) {
  const code = error instanceof Error && ['ADMIN_ALREADY_BOOTSTRAPPED', 'USER_NOT_FOUND'].includes(error.message)
    ? error.message : 'FAILED';
  process.stderr.write(`INITIAL_ADMIN_FAILED: ${code}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
