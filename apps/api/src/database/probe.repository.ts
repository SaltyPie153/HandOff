import type { PrismaService } from './prisma.service.js';

type ProbeClient = Pick<PrismaService, 'bootstrapProbe'>;

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === 'P2002';
}

export class ProbeRepository {
  constructor(private readonly prisma: ProbeClient) {}

  async create(id: string, value: string): Promise<'created' | 'existing' | 'conflict'> {
    try {
      await this.prisma.bootstrapProbe.create({ data: { id, value } });
      return 'created';
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const existing = await this.prisma.bootstrapProbe.findUnique({ where: { id } });
      if (!existing) throw new Error('PROBE_LOOKUP_FAILED');
      return existing.value === value ? 'existing' : 'conflict';
    }
  }

  async verify(id: string, value: string): Promise<'verified' | 'missing' | 'mismatch'> {
    const existing = await this.prisma.bootstrapProbe.findUnique({ where: { id } });
    if (!existing) return 'missing';
    return existing.value === value ? 'verified' : 'mismatch';
  }

  async cleanup(id: string): Promise<void> {
    await this.prisma.bootstrapProbe.deleteMany({ where: { id } });
  }
}
