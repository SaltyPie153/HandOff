import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import { basename, dirname, resolve } from 'node:path';
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
import { AgentKeyExceptionFilter } from '../admin/agent-key.filter.js';
import { HandoffWorkflowController } from './handoff-workflow.controller.js';
import { HandoffWorkflowRepository } from './handoff-workflow.repository.js';

@Module({})
export class HandoffModule {
  static register(config: ApiConfig): DynamicModule {
    const cwd = process.cwd();
    const workRoot = basename(cwd).toLowerCase() === 'api' && basename(dirname(cwd)).toLowerCase() === 'apps'
      ? resolve(cwd, '..', '..') : cwd;
    return {
      module: HandoffModule,
      imports: [AuthModule.register(config)],
      controllers: [HandoffProjectController, HandoffMcpController, HandoffWorkflowController, AgentKeyController],
      providers: [
        { provide: APP_FILTER, useFactory: (host: HttpAdapterHost) => new AgentKeyExceptionFilter(host),
          inject: [HttpAdapterHost] },
        { provide: AgentKeyStore, useFactory: () => new AgentKeyStore({ nodeEnv: config.nodeEnv,
          secretDir: process.env.HANDOFF_SECRET_DIR, workRoot }) },
        { provide: HandoffRepository, useFactory: (prisma: PrismaService) => new HandoffRepository(prisma), inject: [PrismaService] },
        { provide: HandoffWorkflowRepository, useFactory: (prisma: PrismaService) => new HandoffWorkflowRepository(prisma), inject: [PrismaService] },
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
