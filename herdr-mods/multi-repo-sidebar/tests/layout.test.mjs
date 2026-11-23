import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const layout = JSON.parse(readFileSync(resolve(root, "layouts/Multi-Repo-Sidebar.json"), "utf8"));

function modsIn(node, found = []) {
  if (node?.content?.mod) found.push(node.content.mod);
  for (const child of node?.children ?? []) modsIn(child, found);
  return found;
}

test("shared layout keeps Herdr's default settings thumbnail", () => {
  assert.equal(layout.preview, undefined);
  assert.equal(layout.title, undefined);
});

test("shared layout points at the shipped sidebar mod", () => {
  assert.ok(modsIn(layout).includes("multi-repo-sidebar"));
});
