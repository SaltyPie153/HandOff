import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AdminController } from '../admin/admin.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService, type AuthConfig } from './auth.service.js';

@Module({})
export class AuthModule {
  static register(config: AuthConfig & { databaseUrl: string }): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController, AdminController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService({ databaseUrl: config.databaseUrl }) },
        { provide: AuthRepository, useFactory: (prisma: PrismaService) => new AuthRepository(prisma), inject: [PrismaService] },
        { provide: AuthService, useFactory: (repo: AuthRepository) => new AuthService(repo, config), inject: [AuthRepository] }
      ]
    };
  }
}
