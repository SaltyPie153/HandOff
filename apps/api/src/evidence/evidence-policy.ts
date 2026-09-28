const DAY_MS = 24 * 60 * 60 * 1000;

export function isFreshLocalSnapshot(snapshot: { syncedAt: Date; dirtyAt: Date | null }, now = new Date()): boolean {
  const age = now.getTime() - snapshot.syncedAt.getTime();
  return age >= 0 && age <= DAY_MS && (!snapshot.dirtyAt || snapshot.dirtyAt <= snapshot.syncedAt);
}
