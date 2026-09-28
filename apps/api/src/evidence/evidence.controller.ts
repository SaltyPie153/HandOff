import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { EvidenceService } from './evidence.service.js';

type HttpResponse = { setHeader(name: string, value: string): void };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid evidence payload');
  return value as Record<string, unknown>;
};
const required = (body: Record<string, unknown>, field: string) => {
  if (typeof body[field] !== 'string') throw new BadRequestException('Invalid evidence payload');
  return body[field] as string;
};
const bearer = (req: HttpRequest) => {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
};

@Controller('api/projects/:projectId/evidence')
export class EvidenceProjectController {
  constructor(private readonly auth: AuthService, private readonly evidence: EvidenceService) {}

  @Get()
  async list(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.evidence.list(session.userId, projectId);
  }

  @Post('local')
  async registerLocal(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() raw: unknown, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    res.setHeader('Cache-Control', 'no-store');
    return this.evidence.registerLocal(session.userId, projectId, required(record(raw), 'path'));
  }

  @Post('github')
  async registerGithub(@Req() req: HttpRequest, @Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() raw: unknown) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    const body = record(raw);
    return this.evidence.registerGithub(session.userId, projectId, {
      owner: required(body, 'owner'), repo: required(body, 'repo'), path: required(body, 'path'), ref: required(body, 'ref')
    });
  }

  @Delete(':sourceId')
  async revoke(@Req() req: HttpRequest, @Param('sourceId', new ParseUUIDPipe()) sourceId: string) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    return this.evidence.revoke(session.userId, sourceId);
  }
}

@Controller('api/evidence/local/:sourceId')
export class EvidenceSyncController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('dirty')
  async dirty(@Req() req: HttpRequest, @Param('sourceId', new ParseUUIDPipe()) sourceId: string) {
    return this.evidence.markDirty(sourceId, bearer(req));
  }

  @Post('sync')
  async sync(@Req() req: HttpRequest, @Param('sourceId', new ParseUUIDPipe()) sourceId: string, @Body() raw: unknown) {
    const body = record(raw);
    return this.evidence.syncLocal(sourceId, bearer(req), required(body, 'path'),
      required(body, 'content'), required(body, 'contentHash'));
  }
}
