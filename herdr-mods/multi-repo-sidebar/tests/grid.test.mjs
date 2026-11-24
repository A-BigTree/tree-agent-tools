import { test } from "node:test";
import assert from "node:assert/strict";
import { gridPlan } from "../mods/multi-repo-sidebar/lib/docking.js";
import { heightFix, planRows, resizePx, widthFix } from "../mods/multi-repo-sidebar/lib/grid.js";

test("plan rows place children row-major", () => {
  const children = ["a", "b", "c", "d", "e"];
  assert.deepEqual(planRows(gridPlan(5, 2), children), [
    ["a", "b"],
    ["c", "d"],
    ["e"],
  ]);
  assert.deepEqual(planRows(gridPlan(5, 3), children), [
    ["a", "b", "c"],
    ["d", "e"],
  ]);
});

test("width fix asks for the largest imbalance", () => {
  const rows = [["a", "b", "c"], ["d", "e"]];
  const cols = new Map([
    ["a", 50],
    ["b", 25],
    ["c", 25],
    ["d", 40],
    ["e", 40],
  ]);
  assert.deepEqual(widthFix(rows, cols), { row: 0, index: 0, delta: -17 });
  const even = new Map([
    ["a", 40],
    ["b", 40],
    ["c", 40],
    ["d", 40],
    ["e", 40],
  ]);
  assert.equal(widthFix(rows, even), null);
});

test("height fix targets equal row heights", () => {
  const rows = [["a"], ["b"], ["c"]];
  const heights = new Map([
    ["a", 30],
    ["b", 15],
    ["c", 15],
  ]);
  assert.deepEqual(heightFix(rows, heights), { index: 0, delta: -10 });
  const even = new Map([
    ["a", 20],
    ["b", 20],
    ["c", 20],
  ]);
  assert.equal(heightFix(rows, even), null);
});

test("resize px scales cells by the learned cell size", () => {
  assert.equal(resizePx(10, 8), 80);
  assert.equal(resizePx(-3, 7.5), -22);
});
