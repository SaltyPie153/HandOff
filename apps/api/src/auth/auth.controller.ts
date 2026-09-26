import { Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { AuthService, type HttpRequest } from './auth.service.js';

type ResponseLike = {
  cookie(name: string, value: string, options: Record<string, unknown>): ResponseLike;
  clearCookie(name: string, options: Record<string, unknown>): ResponseLike;
  redirect(url: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
  send(body: string): void;
  setHeader(name: string, value: string): void;
};

function provider(value: string): 'GOOGLE' | 'DISCORD' {
  if (value === 'google') return 'GOOGLE';
  if (value === 'discord') return 'DISCORD';
  throw new NotFoundException('Unknown login provider');
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private cookieOptions(httpOnly: boolean, lifetime: number) {
    return { httpOnly, secure: this.auth.config.nodeEnv === 'production', sameSite: 'lax', path: '/', maxAge: lifetime };
  }

  @Get('me')
  async me(@Req() req: HttpRequest, @Res({ passthrough: true }) res: ResponseLike) {
    const session = await this.auth.requireAction(req, 'READ_OWN_STATUS');
    res.setHeader('Cache-Control', 'no-store');
    return {
      id: session.user.id, status: session.user.status,
      isServiceAdmin: session.user.isServiceAdmin,
      linkedProviders: session.user.identities.map(identity => identity.provider)
    };
  }

  @Get(':provider/start')
  async startLogin(@Param('provider') name: string, @Req() req: HttpRequest, @Res() res: ResponseLike) {
    const kind = provider(name);
    const browser = this.auth.browserToken(req) ?? this.auth.newBrowserToken();
    const url = await this.auth.start(kind, 'LOGIN', browser);
    res.setHeader('Cache-Control', 'no-store');
    res.cookie('ho_browser', browser, this.cookieOptions(true, 10 * 60 * 1000));
    res.redirect(url);
  }

  @Get(':provider/callback')
  async finishLogin(@Param('provider') name: string, @Query('state') state: string, @Query('code') code: string, @Req() req: HttpRequest, @Res() res: ResponseLike) {
    const kind = provider(name);
    const browser = this.auth.browserToken(req);
    res.setHeader('Cache-Control', 'no-store');
    res.clearCookie('ho_browser', { path: '/' });
    if (!browser || !state) { res.redirect('/login?error=cancelled'); return; }
    try {
      const result = await this.auth.finish(kind, 'LOGIN', browser, state, code ?? '', undefined, this.auth.sessionToken(req) ?? undefined);
      if (result.kind !== 'SIGNED_IN') throw new Error('Unexpected OAuth result');
      res.cookie('ho_session', result.session.token, this.cookieOptions(true, 7 * 24 * 60 * 60 * 1000));
      res.cookie('ho_csrf', result.session.csrf, this.cookieOptions(false, 7 * 24 * 60 * 60 * 1000));
      res.redirect(result.status === 'PENDING' ? '/pending' : '/projects');
    } catch {
      res.redirect(code ? '/login?error=failed' : '/login?error=cancelled');
    }
  }

  @Post('links/:provider/start')
  async startLink(@Param('provider') name: string, @Req() req: HttpRequest, @Res({ passthrough: true }) res: ResponseLike) {
    const kind = provider(name);
    const session = await this.auth.requireAction(req, 'LINK_PROVIDER');
    this.auth.requireCsrf(req, session.csrfHash);
    const sessionToken = this.auth.sessionToken(req);
    if (!sessionToken) throw new ForbiddenException();
    res.setHeader('Cache-Control', 'no-store');
    return { url: await this.auth.start(kind, 'LINK', sessionToken, session.userId) };
  }

  @Get('links/:provider/callback')
  async finishLink(@Param('provider') name: string, @Query('state') state: string, @Query('code') code: string, @Req() req: HttpRequest, @Res() res: ResponseLike) {
    const kind = provider(name);
    const session = await this.auth.requireAction(req, 'LINK_PROVIDER');
    res.setHeader('Cache-Control', 'no-store');
    const sessionToken = this.auth.sessionToken(req);
    if (!sessionToken || !state) { res.redirect('/settings?error=cancelled'); return; }
    try {
      const result = await this.auth.finish(kind, 'LINK', sessionToken, state, code ?? '', session.userId);
      if (result.kind === 'CONFLICT') {
        res.status(409).send('<!doctype html><html lang="ko"><meta charset="utf-8"><title>계정 연결 충돌</title><main><h1>계정 연결 불가</h1><p>이미 다른 회원에게 연결된 계정입니다. 현재 연결 상태는 변경되지 않았습니다.</p><a href="/settings">로그인 수단 관리로 돌아가기</a></main></html>');
        return;
      }
      res.redirect('/settings?linked=1');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) { res.status(503).json({ code: 'PROVIDER_UNAVAILABLE' }); return; }
      res.redirect(code ? '/settings?error=failed' : '/settings?error=cancelled');
    }
  }

  @Post('logout')
  async logout(@Req() req: HttpRequest, @Res() res: ResponseLike) {
    const session = await this.auth.requireAction(req, 'LOGOUT');
    this.auth.requireCsrf(req, session.csrfHash);
    const token = this.auth.sessionToken(req)!;
    await this.auth.repository.revokeSession(token);
    res.clearCookie('ho_session', { path: '/' });
    res.clearCookie('ho_csrf', { path: '/' });
    res.status(204).json(null);
  }
}
