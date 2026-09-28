import { BadRequestException, Body, Controller, Delete, Get, Put, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { AuthService, type HttpRequest } from '../auth/auth.service.js';
import { HandoffBackgroundWorker } from '../handoff/background-worker.js';
import { AgentKeyStore } from './agent-key.store.js';

type HeaderResponse = { setHeader(name: string, value: string): void };

@Controller('api/admin/agent-key')
export class AgentKeyController {
  constructor(private readonly auth: AuthService, private readonly store: AgentKeyStore,
    private readonly worker: HandoffBackgroundWorker) {}

  private noStore(res: HeaderResponse) { res.setHeader('Cache-Control', 'no-store'); }

  @Get()
  async status(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HeaderResponse) {
    this.noStore(res);
    await this.auth.requireAction(req, 'MANAGE_AGENT_KEY');
    try {
      const { configured, source } = await this.store.read();
      return { configured, source };
    } catch { throw new ServiceUnavailableException('Server agent key is unavailable'); }
  }

  @Put()
  async save(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HeaderResponse,
    @Body() body: { key?: unknown } | undefined) {
    this.noStore(res);
    const session = await this.auth.requireAction(req, 'MANAGE_AGENT_KEY');
    this.auth.requireCsrf(req, session.csrfHash);
    if (typeof body?.key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(body.key)) {
      throw new BadRequestException('Invalid server agent key');
    }
    try { await this.store.save(body.key); }
    catch { throw new ServiceUnavailableException('Server agent key is unavailable'); }
    await this.worker.wakeUnavailableJobs();
    return { configured: true, source: 'file' };
  }

  @Delete()
  async disable(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HeaderResponse) {
    this.noStore(res);
    const session = await this.auth.requireAction(req, 'MANAGE_AGENT_KEY');
    this.auth.requireCsrf(req, session.csrfHash);
    try { await this.store.disable(); }
    catch { throw new ServiceUnavailableException('Server agent key is unavailable'); }
    return { configured: false, source: 'disabled' };
  }
}
