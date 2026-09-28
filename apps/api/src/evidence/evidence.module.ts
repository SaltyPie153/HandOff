import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import type { ApiConfig } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { EvidenceProjectController, EvidenceSyncController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

@Module({})
export class EvidenceModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: EvidenceModule,
      imports: [AuthModule.register(config)],
      controllers: [EvidenceProjectController, EvidenceSyncController],
      providers: [{ provide: EvidenceService, useFactory: (prisma: PrismaService) => new EvidenceService(prisma), inject: [PrismaService] }]
    };
  }
}
