import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { HandoffWorkflowRepository } from './handoff-workflow.repository.js';
import { HandoffRepository } from './handoff.repository.js';
import type { ResponseInput } from './handoff-workflow.js';

type HttpResponse={setHeader(name:string,value:string):void};
@Controller('api/projects/:projectId')
export class HandoffWorkflowController {
  constructor(private readonly auth:AuthService,private readonly flow:HandoffWorkflowRepository,private readonly requests:HandoffRepository){}

  @Post('requests/:requestId/responses')
  async respond(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('requestId',new ParseUUIDPipe()) requestId:string,@Body() body:ResponseInput){
    const session=await this.auth.requireSession(req); this.auth.requireCsrf(req,session.csrfHash);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new BadRequestException();
    return this.flow.respond(session.userId,projectId,requestId,body);
  }
  @Get('requests/:requestId/versions/:version')
  async version(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('requestId',new ParseUUIDPipe()) requestId:string,
    @Param('version',new ParseIntPipe()) version:number,@Res({passthrough:true}) res:HttpResponse){
    const session=await this.auth.requireSession(req);res.setHeader('Cache-Control','no-store');
    const result=await this.requests.getPrivateRequest(session.userId,requestId,version);
    if(result.projectId!==projectId) throw new NotFoundException();return result;
  }
  @Get('handoff-summary')
  async summary(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Res({passthrough:true}) res:HttpResponse){
    const session=await this.auth.requireSession(req);res.setHeader('Cache-Control','no-store');return this.flow.summary(session.userId,projectId);
  }
  @Get('notifications')
  async notifications(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Res({passthrough:true}) res:HttpResponse){
    const session=await this.auth.requireSession(req);res.setHeader('Cache-Control','no-store');return this.flow.notifications(session.userId,projectId);
  }
  @Post('notifications/:notificationId/read')
  async read(@Req() req:HttpRequest,@Param('projectId',new ParseUUIDPipe()) projectId:string,@Param('notificationId',new ParseUUIDPipe()) notificationId:string){
    const session=await this.auth.requireSession(req);this.auth.requireCsrf(req,session.csrfHash);return this.flow.markRead(session.userId,projectId,notificationId);
  }
}
