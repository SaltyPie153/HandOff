import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

function keyFromEnv(): Buffer {
  const raw = process.env.HANDOFF_EVIDENCE_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) throw new ServiceUnavailableException('Evidence encryption is not configured');
  return Buffer.from(raw, 'hex');
}

export function encryptEvidence(content: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnv(), iv);
  const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptEvidence(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Invalid evidence ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
