import { ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';

@Controller('api/admin')
export class AdminController {
  constructor(private readonly auth: AuthService) {}

  @Get('pending-users')
  async pending(@Req() req: HttpRequest, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    await this.auth.requireAction(req, 'LIST_PENDING_USERS');
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.repository.pendingUsers();
  }

  @Post('users/:id/approve')
  async approve(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) targetId: string) {
    const session = await this.auth.requireAction(req, 'APPROVE_USER');
    this.auth.requireCsrf(req, session.csrfHash);
    const status = await this.auth.repository.approve(session.userId, targetId);
    if (status === 'NOT_FOUND') throw new NotFoundException();
    return { status };
  }

  @Post('users/:id/grant-admin')
  async grant(@Req() req: HttpRequest, @Param('id', new ParseUUIDPipe()) targetId: string) {
    const session = await this.auth.requireAction(req, 'GRANT_ADMIN');
    this.auth.requireCsrf(req, session.csrfHash);
    const status = await this.auth.repository.grantAdmin(session.userId, targetId);
    if (status === 'NOT_FOUND') throw new NotFoundException();
    if (status === 'NOT_APPROVED') throw new ConflictException('User is not approved');
    return { status };
  }
}
