export const DEFAULT_TTL = 15000;

export function cacheKey(machine, cwd) {
  return `${machine ?? ""}\u0000${cwd ?? ""}`;
}

export function isStale(entry, now, ttl = DEFAULT_TTL) {
  return !entry || now - (entry.checkedAt ?? 0) >= ttl;
}

export function uniqueRequests(requests) {
  const seen = new Set();
  const result = [];
  for (const request of requests) {
    if (!request?.cwd) continue;
    const key = cacheKey(request.machine, request.cwd);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

export function dueRequests(requests, cache, now, ttl = DEFAULT_TTL) {
  return uniqueRequests(requests).filter((request) =>
    isStale(cache[cacheKey(request.machine, request.cwd)], now, ttl),
  );
}

export function nextBatch(queue, limit = 6) {
  return queue.splice(0, Math.max(1, limit));
}

export function parseRepoRoot(result) {
  if (!result || result.code !== 0) return null;
  const path = String(result.stdout ?? "").trim();
  return path || null;
}

export function parseBranch(result) {
  if (!result || result.code !== 0) return null;
  const branch = String(result.stdout ?? "").trim();
  return branch || null;
}
