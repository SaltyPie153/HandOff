import { Controller, Get, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { ProjectService } from './project.service.js';

@Controller('api/admin/projects')
export class ProjectAdminController {
  constructor(private readonly auth: AuthService, private readonly projects: ProjectService) {}

  @Get()
  async list(@Req() req: HttpRequest, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    const session = await this.auth.requireSession(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.projects.adminProjects(session.userId);
  }
}
