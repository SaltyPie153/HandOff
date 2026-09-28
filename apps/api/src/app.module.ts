import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { ProjectModule } from './projects/project.module.js';
import { HandoffModule } from './handoff/handoff.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';

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
      imports: [HealthModule.register({ databaseUrl: config.databaseUrl }), ProjectModule.register(config),
        HandoffModule.register(config), EvidenceModule.register(config)],
      exports: [HealthModule]
    };
  }
}
