import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

@Catch()
export class AgentKeyExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    if (!/^\/api\/admin\/agent-key\/?(?:\?|$)/.test(request.originalUrl ?? request.url ?? '')) {
      super.catch(exception, host);
      return;
    }
    const response = host.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
      status(code: number): { json(body: unknown): void };
    }>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ statusCode: status, message: 'Server agent key request failed' });
  }
}
