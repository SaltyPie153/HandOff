import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { McpGrantService } from '../auth/mcp-grant.js';
import { HandoffRepository } from './handoff.repository.js';

type HttpResponse = { setHeader(name: string, value: string): void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid payload');
  return body as Record<string, unknown>;
};
const string = (body: Record<string, unknown>, key: string, max: number) => {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException('Invalid payload');
  return value;
};
const bearer = (req: HttpRequest) => {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
};

@Controller('api/projects/:projectId')
export class HandoffProjectController {
  constructor(private readonly auth: AuthService, private readonly handoffs: HandoffRepository) {}

  @Get('feed')
  async feed(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.handoffs.listFeed(session.userId, projectId);
  }

  @Get('inbox')
  async inbox(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.handoffs.listMine(session.userId, projectId);
  }

  @Get('requests/:requestId')
  async detail(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    const detail = await this.handoffs.getPrivateRequest(session.userId, requestId);
    if (detail.projectId !== projectId) throw new NotFoundException();
    return detail;
  }

  @Post('requests/:requestId/replies')
  async reply(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string, @Body() raw: unknown) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    const detail = await this.handoffs.getPrivateRequest(session.userId, requestId);
    if (detail.projectId !== projectId) throw new NotFoundException();
    const body = record(raw);
    return this.handoffs.publishReply(session.userId, requestId, {
      body: string(body, 'body', 10_000), source: 'HUMAN', idempotencyKey: string(body, 'idempotencyKey', 128)
    });
  }
}

@Controller('api/mcp')
export class HandoffMcpController {
  constructor(private readonly auth: AuthService, private readonly grants: McpGrantService,
    private readonly handoffs: HandoffRepository) {}

  @Post('grants')
  async grant(@Req() req: HttpRequest, @Body() raw: unknown, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    const body = record(raw);
    const projectId = string(body, 'projectId', 36);
    if (!uuid.test(projectId)) throw new BadRequestException('Invalid project');
    res.setHeader('Cache-Control', 'no-store');
    return this.grants.issue(session.userId, projectId);
  }

  @Get('grants')
  async listGrants(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.grants.list(session.userId);
  }

  @Delete('grants/:grantId')
  async revoke(@Req() req: HttpRequest, @Param('grantId', new ParseUUIDPipe()) grantId: string) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    return this.grants.revoke(session.userId, grantId);
  }

  @Post('requests')
  async send(@Req() req: HttpRequest, @Body() raw: unknown) {
    const body = record(raw);
    const projectId = string(body, 'projectId', 36);
    const recipientId = string(body, 'recipientId', 36);
    if (!uuid.test(projectId) || !uuid.test(recipientId)) throw new BadRequestException('Invalid project or recipient');
    const grant = await this.grants.requireToken(bearer(req), projectId);
    return this.handoffs.createRequest(grant.userId, projectId, {
      recipientId, publicTitle: string(body, 'publicTitle', 160), privateBody: string(body, 'privateBody', 50_000),
      idempotencyKey: string(body, 'idempotencyKey', 128)
    }).then(({ id, publicTitle, createdAt }) => ({ id, publicTitle, createdAt }));
  }

  @Get('projects')
  async myProject(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const grant = await this.grants.requireToken(bearer(req));
    res.setHeader('Cache-Control', 'no-store');
    return [{ id: grant.projectId }];
  }

  @Get('requests/:requestId')
  async myRequest(@Req() req: HttpRequest, @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const grant = await this.grants.requireToken(bearer(req));
    res.setHeader('Cache-Control', 'no-store');
    const detail = await this.handoffs.getPrivateRequest(grant.userId, requestId);
    if (detail.projectId !== grant.projectId) throw new NotFoundException();
    return detail;
  }
}
