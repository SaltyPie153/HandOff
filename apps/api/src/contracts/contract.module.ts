import {Module,type DynamicModule} from '@nestjs/common';
import type {ApiConfig} from '../app.module.js';
import {AuthModule} from '../auth/auth.module.js';
import {McpGrantService} from '../auth/mcp-grant.js';
import {PrismaService} from '../database/prisma.service.js';
import {ContractController} from './contract.controller.js';
import {ContractMcpController} from './contract-mcp.controller.js';
import {ContractRepository} from './contract.repository.js';
import {ContractQueryRepository} from './contract-query.repository.js';
@Module({})
export class ContractModule{
 static register(config:ApiConfig):DynamicModule{return {module:ContractModule,imports:[AuthModule.register(config)],controllers:[ContractController,ContractMcpController],providers:[
  {provide:ContractRepository,useFactory:(db:PrismaService)=>new ContractRepository(db),inject:[PrismaService]},
  {provide:ContractQueryRepository,useFactory:(db:PrismaService)=>new ContractQueryRepository(db),inject:[PrismaService]},
  {provide:McpGrantService,useFactory:(db:PrismaService)=>new McpGrantService(db),inject:[PrismaService]}
 ]};}
}
