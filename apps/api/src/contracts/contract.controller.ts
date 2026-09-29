import {Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req} from '@nestjs/common';
import {AuthService,type HttpRequest} from '../auth/auth.service.js';
import {ContractRepository} from './contract.repository.js';
import {ContractQueryRepository} from './contract-query.repository.js';
import type {ContractResponseInput} from './contract.types.js';
import {versionNumber} from '../handoff/handoff-workflow.js';

@Controller('api/projects/:projectId')
export class ContractController{
 constructor(private readonly auth:AuthService,private readonly flow:ContractRepository,private readonly queries:ContractQueryRepository){}
 @Get('contracts') @Header('Cache-Control','no-store')
 async list(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string){return this.queries.listPublic((await this.auth.requireSession(req)).userId,projectId);}
 @Get('contracts/:contractId') @Header('Cache-Control','no-store')
 async contract(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('contractId',new ParseUUIDPipe()) id:string){return this.queries.getPublic((await this.auth.requireSession(req)).userId,projectId,id);}
 @Get('contract-proposals') @Header('Cache-Control','no-store')
 async mine(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string){return this.queries.listMine((await this.auth.requireSession(req)).userId,projectId);}
 @Get('contract-proposals/:proposalId') @Header('Cache-Control','no-store')
 async proposal(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('proposalId',new ParseUUIDPipe()) id:string,@Query('version') version?:string){return this.queries.getProposal((await this.auth.requireSession(req)).userId,projectId,id,version===undefined?undefined:versionNumber(Number(version)));}
 @Get('contract-summary') @Header('Cache-Control','no-store')
 async summary(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string){return this.queries.summary((await this.auth.requireSession(req)).userId,projectId);}
 @Get('contract-notifications') @Header('Cache-Control','no-store')
 async notifications(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string){return this.queries.notifications((await this.auth.requireSession(req)).userId,projectId);}
 @Post('contract-proposals/:proposalId/responses')
 async respond(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('proposalId',new ParseUUIDPipe()) id:string,@Body() raw:ContractResponseInput){const session=await this.auth.requireSession(req);this.auth.requireCsrf(req,session.csrfHash);return this.flow.respond(session.userId,projectId,id,raw,{tokenHash:session.tokenHash,csrfHash:session.csrfHash});}
 @Post('contract-notifications/:id/read')
 async read(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('id',new ParseUUIDPipe()) id:string){const session=await this.auth.requireSession(req);this.auth.requireCsrf(req,session.csrfHash);return this.queries.markRead(session.userId,projectId,id);}
}
