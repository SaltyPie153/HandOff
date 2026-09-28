import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { McpGrantService } from '../auth/mcp-grant.js';
import type { ApiConfig } from '../app.module.js';
import { PrismaService } from '../database/prisma.service.js';
import { HandoffProjectController, HandoffMcpController } from './handoff.controller.js';
import { HandoffRepository } from './handoff.repository.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { HandoffBackgroundWorker } from './background-worker.js';
import { ManagedAgentRunner } from './agent-runner.js';
import { AgentKeyStore } from '../admin/agent-key.store.js';
import { AgentKeyController } from '../admin/agent-key.controller.js';

@Module({})
export class HandoffModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: HandoffModule,
      imports: [AuthModule.register(config)],
      controllers: [HandoffProjectController, HandoffMcpController, AgentKeyController],
      providers: [
        { provide: AgentKeyStore, useFactory: () => new AgentKeyStore({ nodeEnv: config.nodeEnv,
          secretDir: process.env.HANDOFF_SECRET_DIR, workRoot: process.cwd() }) },
        { provide: HandoffRepository, useFactory: (prisma: PrismaService) => new HandoffRepository(prisma), inject: [PrismaService] },
        { provide: McpGrantService, useFactory: (prisma: PrismaService) => new McpGrantService(prisma), inject: [PrismaService] },
        { provide: EvidenceService, useFactory: (prisma: PrismaService) => new EvidenceService(prisma), inject: [PrismaService] },
        { provide: HandoffBackgroundWorker, useFactory: (prisma: PrismaService, evidence: EvidenceService, keyStore: AgentKeyStore) =>
          new HandoffBackgroundWorker(prisma, evidence, new ManagedAgentRunner(), keyStore),
          inject: [PrismaService, EvidenceService, AgentKeyStore] }
      ],
      exports: [HandoffBackgroundWorker]
    };
  }
}
