import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req} from '@nestjs/common';
import type {HttpRequest} from '../auth/auth.service.js';
import {McpGrantService} from '../auth/mcp-grant.js';
import {versionNumber} from '../handoff/handoff-workflow.js';
import {memberId} from './contract-policy.js';
import {ContractRepository} from './contract.repository.js';
import {ContractQueryRepository} from './contract-query.repository.js';
import type {ProposeContractInput,ReviseContractInput} from './contract.types.js';
const token=(req:HttpRequest)=>{const h=req.headers.authorization;return typeof h==='string'&&h.startsWith('Bearer ')?h.slice(7):undefined;};
@Controller('api/mcp')
export class ContractMcpController{
 constructor(private readonly grants:McpGrantService,private readonly flow:ContractRepository,private readonly queries:ContractQueryRepository){}
 @Post('contracts')
 async propose(@Req() req:HttpRequest,@Body() input:ProposeContractInput&{projectId:string}){const projectId=memberId(input?.projectId);const g=await this.grants.requireToken(token(req),projectId);return this.flow.propose(g.userId,g.projectId,g.id,input);}
 @Post('contract-proposals/:proposalId/versions')
 async revise(@Req() req:HttpRequest,@Param('proposalId',new ParseUUIDPipe()) id:string,@Body() input:ReviseContractInput){const g=await this.grants.requireToken(token(req));return this.flow.revise(g.userId,g.projectId,id,g.id,input);}
 @Get('contract-proposals/:proposalId') @Header('Cache-Control','no-store')
 async proposal(@Req() req:HttpRequest,@Param('proposalId',new ParseUUIDPipe()) id:string,@Query('version') version?:string){const g=await this.grants.requireToken(token(req));return this.queries.getProposal(g.userId,g.projectId,id,version===undefined?undefined:versionNumber(Number(version)),g.id);}
 @Get('contracts') @Header('Cache-Control','no-store')
 async list(@Req() req:HttpRequest){const g=await this.grants.requireToken(token(req));return this.queries.listPublic(g.userId,g.projectId,true,g.id);}
 @Get('contracts/:contractId') @Header('Cache-Control','no-store')
 async contract(@Req() req:HttpRequest,@Param('contractId',new ParseUUIDPipe()) id:string){const g=await this.grants.requireToken(token(req));return this.queries.getPublic(g.userId,g.projectId,id,g.id);}
}
