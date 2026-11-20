import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cacheKey,
  dueRequests,
  isStale,
  nextBatch,
  parseBranch,
  parseGitStatus,
  parseRepoRoot,
  uniqueRequests,
} from "../lib/branches.js";

test("cache keys separate machines and folders", () => {
  assert.notEqual(cacheKey(null, "/w/a"), cacheKey("vps", "/w/a"));
  assert.notEqual(cacheKey(null, "/w/a"), cacheKey(null, "/w/b"));
  assert.equal(cacheKey(null, "/w/a"), cacheKey(null, "/w/a"));
});

test("stale entries refresh after the ttl", () => {
  const now = 30_000;
  assert.equal(isStale(undefined, now), true);
  assert.equal(isStale({ checkedAt: 10_000 }, now), true);
  assert.equal(isStale({ checkedAt: 20_000 }, now), false);
  assert.equal(isStale({ checkedAt: 0 }, 70_000, 60_000), true);
});

test("requests are deduplicated and filtered by ttl", () => {
  const requests = [
    { machine: null, cwd: "/w/a" },
    { machine: null, cwd: "/w/a" },
    { machine: "vps", cwd: "/w/a" },
    { machine: null, cwd: "/w/b" },
    { machine: null, cwd: null },
  ];
  const cache = {
    [cacheKey(null, "/w/a")]: { checkedAt: 20_001 },
    [cacheKey("vps", "/w/a")]: { checkedAt: 0 },
  };
  const due = dueRequests(requests, cache, 30_000);
  assert.deepEqual(due, [
    { machine: "vps", cwd: "/w/a" },
    { machine: null, cwd: "/w/b" },
  ]);
  assert.equal(uniqueRequests(requests).length, 3);
});

test("batches are bounded", () => {
  const queue = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(nextBatch(queue, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(queue, [7, 8]);
  assert.deepEqual(nextBatch([], 6), []);
});

test("git output is parsed defensively", () => {
  assert.equal(parseRepoRoot({ code: 0, stdout: "/w/repo\n" }), "/w/repo");
  assert.equal(parseRepoRoot({ code: 1, stdout: "/w/repo\n" }), null);
  assert.equal(parseRepoRoot(null), null);
  assert.equal(parseBranch({ code: 0, stdout: "feature/a\n" }), "feature/a");
  assert.equal(parseBranch({ code: 1, stdout: "" }), null);
});

test("porcelain v2 status gives branch, ahead/behind and changes", () => {
  const result = {
    code: 0,
    stdout: [
      "# branch.oid abc123",
      "# branch.head feature/a",
      "# branch.upstream origin/feature/a",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc def file.txt",
      "2 R. N... 100644 100644 100644 abc def new.txt\told.txt",
      "1 D. N... 100644 100644 100644 abc def deleted.txt",
      "u UU N... 100644 100644 100644 100644 abc def conflict.txt",
      "? untracked.txt",
    ].join("\n"),
  };
  assert.deepEqual(parseGitStatus(result), {
    branch: "feature/a",
    upstream: "origin/feature/a",
    ahead: 2,
    behind: 1,
    staged: true,
    unstaged: true,
    stagedCount: 2,
    unstagedCount: 1,
    untrackedCount: 1,
    conflictedCount: 1,
    dirty: true,
  });
});

test("porcelain v2 status handles no upstream and detached head", () => {
  assert.deepEqual(parseGitStatus({ code: 0, stdout: "# branch.head main\n" }), {
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: false,
    unstaged: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    dirty: false,
  });
  assert.equal(parseGitStatus({ code: 0, stdout: "# branch.head (detached)\n" }).branch, "(detached)");
  assert.equal(parseGitStatus({ code: 1, stdout: "" }), null);
});
