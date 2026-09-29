import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { HandoffResponseAction } from '../generated/prisma/enums.js';

export type ResponseInput = { version: number; action: HandoffResponseAction; comment?: string; idempotencyKey: string };
export type RevisionInput = { expectedVersion: number; privateBody: string; verificationClaim?: string | null; idempotencyKey: string };
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException('Invalid input');
  return value.trim();
}
export function versionNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BadRequestException('Invalid version');
  return value as number;
}
export async function requireMember(db: Prisma.TransactionClient, userId: string, projectId: string) {
  // Hold membership and approval while the mutation commits (including concurrent removal).
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT u.id FROM users u JOIN project_memberships m ON m.user_id=u.id
    WHERE u.id=${userId}::uuid AND m.project_id=${projectId}::uuid AND u.status='APPROVED'
    FOR SHARE OF u,m`;
  if (!rows.length) throw new NotFoundException();
}
export async function lockRequest(db: Prisma.TransactionClient, requestId: string, projectId?: string) {
  await db.$queryRaw`SELECT id FROM handoff_requests WHERE id=${requestId}::uuid FOR UPDATE`;
  const request = await db.handoffRequest.findUnique({ where: { id: requestId } });
  if (!request || (projectId && request.projectId !== projectId)) throw new NotFoundException();
  return request;
}
export async function requireParticipants(db: Prisma.TransactionClient, request: { projectId: string; senderId: string; recipientId: string }) {
  for (const id of [request.senderId, request.recipientId].sort()) await requireMember(db,id,request.projectId);
}
export async function requireGrant(db: Prisma.TransactionClient, grantId: string, senderId: string, projectId: string) {
  await db.$queryRaw`SELECT id FROM mcp_grants WHERE id=${grantId}::uuid FOR SHARE`;
  const grant = await db.mcpGrant.findFirst({where:{id:grantId,userId:senderId,projectId,revokedAt:null,expiresAt:{gt:new Date()}}});
  if (!grant) throw new ForbiddenException();
}
