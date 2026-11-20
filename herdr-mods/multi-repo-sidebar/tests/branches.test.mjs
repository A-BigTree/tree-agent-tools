import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cacheKey,
  dueRequests,
  isStale,
  nextBatch,
  parseBranch,
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
