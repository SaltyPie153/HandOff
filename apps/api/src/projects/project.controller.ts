import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { ProjectService } from './project.service.js';

type HttpResponse = { setHeader(name: string, value: string): void };

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
}
