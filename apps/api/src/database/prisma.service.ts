import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type PrismaServiceConfig = {
  databaseUrl: string;
};

export class PrismaService extends PrismaClient {
  constructor(config: PrismaServiceConfig) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      max: 4,
      connectionTimeoutMillis: 2_000,
      statement_timeout: 2_000,
      query_timeout: 2_000
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
