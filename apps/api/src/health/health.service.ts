import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type HealthSnapshot = {
  status: 'ready' | 'degraded';
  checkedAt: string;
  service: 'ok';
  database: 'ok' | 'unavailable' | 'schema_missing';
  code: 'OK' | 'DATABASE_UNAVAILABLE' | 'SCHEMA_NOT_READY';
};

function isMissingTableError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const details = current as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
    if (details.code === 'P2021' || details.code === '42P01' || details.meta?.code === '42P01') {
      return true;
    }
    current = details.cause;
  }
  return false;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthSnapshot> {
    try {
      await this.prisma.$connect();
      await this.prisma.bootstrapProbe.findFirst({ select: { id: true } });
      return {
        status: 'ready',
        checkedAt: new Date().toISOString(),
        service: 'ok',
        database: 'ok',
        code: 'OK'
      };
    } catch (error: unknown) {
      const schemaMissing = isMissingTableError(error);
      return {
        status: 'degraded',
        checkedAt: new Date().toISOString(),
        service: 'ok',
        database: schemaMissing ? 'schema_missing' : 'unavailable',
        code: schemaMissing ? 'SCHEMA_NOT_READY' : 'DATABASE_UNAVAILABLE'
      };
    }
  }
}
