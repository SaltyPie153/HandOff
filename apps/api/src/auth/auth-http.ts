import { createHash, timingSafeEqual } from 'node:crypto';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return tokenPattern.test(value) ? value : null;
  }
  return null;
}

export function validCsrf(value: string | undefined, expectedHash: string): boolean {
  if (!value || !tokenPattern.test(value) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = createHash('sha256').update(value).digest();
  return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
}
