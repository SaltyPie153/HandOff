import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';

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
      imports: [HealthModule.register({ databaseUrl: config.databaseUrl }), AuthModule.register(config)],
      exports: [HealthModule]
    };
  }
}
