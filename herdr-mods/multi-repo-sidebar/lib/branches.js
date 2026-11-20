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

export function parseGitStatus(result) {
  if (!result || result.code !== 0) return null;
  const HEAD = "# branch.head ";
  const UPSTREAM = "# branch.upstream ";
  const AB = "# branch.ab ";
  let branch = null;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  let staged = false;
  let unstaged = false;
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let conflictedCount = 0;

  for (const line of String(result.stdout ?? "").split("\n")) {
    if (!line) continue;
    if (line.startsWith(HEAD)) {
      branch = line.slice(HEAD.length).trim() || null;
      continue;
    }
    if (line.startsWith(UPSTREAM)) {
      upstream = line.slice(UPSTREAM.length).trim() || null;
      continue;
    }
    if (line.startsWith(AB)) {
      const match = /^\+\s*(\d+)\s+-\s*(\d+)/.exec(line.slice(AB.length));
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith("u ")) {
      conflictedCount += 1;
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4);
      if (xy[0] !== ".") {
        staged = true;
        stagedCount += 1;
      }
      if (xy[1] !== ".") {
        unstaged = true;
        unstagedCount += 1;
      }
      continue;
    }
    if (line.startsWith("? ")) untrackedCount += 1;
  }

  return {
    branch: branch === "(detached)" ? "(detached)" : branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictedCount,
    dirty: staged || unstaged || untrackedCount > 0 || conflictedCount > 0,
  };
}
