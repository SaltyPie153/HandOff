import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ApiConfig } from '../app.module.js';
import { ProjectController } from './project.controller.js';
import { ProjectRepository } from './project.repository.js';
import { ProjectService } from './project.service.js';

@Module({})
export class ProjectModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ProjectModule,
      imports: [AuthModule.register(config)],
      controllers: [ProjectController],
      providers: [
        { provide: ProjectRepository, useFactory: (prisma: PrismaService) => new ProjectRepository(prisma), inject: [PrismaService] },
        { provide: ProjectService, useFactory: (repository: ProjectRepository) => new ProjectService(repository), inject: [ProjectRepository] }
      ]
    };
  }
}
