const clause = /^([A-Z][A-Z0-9_.-]{1,63}): ([^\r\n]{1,400})$/;
export function parseClaim(value: string | null | undefined): { key: string; value: string } | null {
  if (typeof value !== 'string') return null;
  const match = clause.exec(value);
  return match ? { key: match[1], value: match[2] } : null;
}
export function extractClaimLines(content: string, key: string): { values: string[]; lines: string[]; malformed: boolean } {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp(`^${escaped}(?:\\s*[:：=]|\\s*$)`);
  const values: string[] = [], lines: string[] = [];
  let malformed = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!prefix.test(line)) continue;
    const parsed = parseClaim(line);
    if (!parsed || parsed.key !== key) { malformed = true; continue; }
    values.push(parsed.value); lines.push(line);
  }
  return { values, lines, malformed };
}
