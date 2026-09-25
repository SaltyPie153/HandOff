import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaService, type PrismaServiceConfig } from '../database/prisma.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({})
export class HealthModule {
  static register(config: PrismaServiceConfig): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config) },
        HealthService
      ],
      exports: [PrismaService]
    };
  }
}
