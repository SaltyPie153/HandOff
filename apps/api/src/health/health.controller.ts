import { Controller, Get, Res } from '@nestjs/common';
import { HealthService } from './health.service.js';

type StatusResponse = {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
};

@Controller('api/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: StatusResponse) {
    const snapshot = await this.healthService.check();
    response.status(snapshot.status === 'ready' ? 200 : 503);
    response.setHeader('Cache-Control', 'no-store');
    return {
      status: snapshot.status,
      checkedAt: snapshot.checkedAt,
      service: snapshot.service,
      database: snapshot.database,
      code: snapshot.code
    };
  }
}
