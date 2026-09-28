import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { ProjectService } from './project.service.js';

type HttpResponse = { setHeader(name: string, value: string): void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/projects')
export class ProjectController {
  constructor(private readonly auth: AuthService, private readonly projects: ProjectService) {}

  @Get()
  async list(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireAction(req, 'CREATE_PROJECT');
    res.setHeader('Cache-Control', 'no-store');
    return this.projects.listMine(session.userId);
  }

  @Post()
  async create(@Req() req: HttpRequest, @Body() body: unknown) {
    const session = await this.auth.requireAction(req, 'CREATE_PROJECT');
    this.auth.requireCsrf(req, session.csrfHash);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !('name' in body) || typeof body.name !== 'string' ||
        ('description' in body && body.description !== null && typeof body.description !== 'string')) {
      throw new BadRequestException('Invalid project payload');
    }
    return this.projects.create(session.userId, { name: body.name, description: 'description' in body ? body.description as string | null : null });
  }

  @Get(':id')
  async room(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireAction(req, 'READ_PROJECT', true);
    res.setHeader('Cache-Control', 'no-store');
    return this.projects.room(session.userId, id);
  }

  @Get(':id/members')
  async members(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.projects.members(session.userId, id);
  }

  @Get(':id/eligible-users')
  async eligible(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) id: string,
    @Query('query') query: unknown, @Res({ passthrough: true }) res: HttpResponse) {
    const session = await this.auth.requireSession(req);
    if (query !== undefined && typeof query !== 'string') throw new BadRequestException('Invalid query');
    res.setHeader('Cache-Control', 'no-store');
    return this.projects.eligibleUsers(session.userId, id, query ?? '' as string);
  }

  @Post(':id/members')
  async add(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('userId' in body) ||
      typeof body.userId !== 'string' || !uuid.test(body.userId)) throw new BadRequestException('Invalid member');
    return { status: await this.projects.addMember(session.userId, id, body.userId) };
  }

  @Delete(':id/members/:userId')
  async remove(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string) {
    const session = await this.auth.requireSession(req);
    this.auth.requireCsrf(req, session.csrfHash);
    return { status: await this.projects.removeMember(session.userId, id, userId) };
  }
}
