export function readVoxelSourceCache<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function writeVoxelSourceCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries = 256,
): void {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('Voxel source cache capacity must be a positive safe integer');
  }
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function pruneVoxelSourceCache<T>(
  cache: Map<string, T>,
  keepKeys: ReadonlySet<string>,
): void {
  for (const key of cache.keys()) {
    if (!keepKeys.has(key)) cache.delete(key);
  }
}

export function fulfilledVoxelNeighbors<T>(
  results: readonly PromiseSettledResult<T>[],
): (T | undefined)[] {
  return results.map((result) => (result.status === 'fulfilled' ? result.value : undefined));
}
