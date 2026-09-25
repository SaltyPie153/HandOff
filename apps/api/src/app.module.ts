import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

export type ApiConfig = {
  nodeEnv: string;
  apiPort: number;
  webPort: number;
  dbPort: number;
  databaseName: string;
  databaseHost: string;
  postgresUser: string;
  postgresPassword: string;
  databaseUrl: string;
};

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      providers: [{
        provide: PrismaService,
        useFactory: () => new PrismaService({ databaseUrl: config.databaseUrl })
      }],
      exports: [PrismaService]
    };
  }
}
