import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_OFF_TTL,
  dockGroups,
  gridPlan,
  groupName,
  nextGroupSequence,
  reconcileDocks,
} from "../mods/multi-repo-sidebar/lib/docking.js";

const terminal = (address, parent, extra = {}) => ({
  address,
  parent,
  state: "live",
  ...extra,
});

test("only live children without a pane are candidates", () => {
  const panes = [{ pane: "p1", terminal: "t1" }];
  const terminals = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
    terminal("t3", "t1", { state: "finished" }),
    terminal("t4", null),
  ];
  const groups = dockGroups({ terminals, panes, docked: {}, off: {} });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].children, ["t2"]);
  assert.equal(groups[0].parent, "t1");
  assert.equal(groups[0].space, "sp1");
});

test("children group by their direct parent and inherit space from the chain", () => {
  const terminals = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
    terminal("t3", "t1"),
    terminal("t4", "t2"),
  ];
  const groups = dockGroups({ terminals, panes: [], docked: {}, off: {} });
  const byParent = new Map(groups.map((group) => [group.parent, group]));
  assert.deepEqual(byParent.get("t1").children, ["t2", "t3"]);
  assert.deepEqual(byParent.get("t2").children, ["t4"]);
  assert.equal(byParent.get("t2").space, "sp1");
});

test("a parent with a pane in another tab still groups its new children", () => {
  const terminals = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
  ];
  const groups = dockGroups({
    terminals,
    panes: [{ pane: "p1", terminal: "t1" }],
    docked: {},
    off: {},
  });
  assert.deepEqual(groups[0].children, ["t2"]);
  assert.equal(groups[0].parent, "t1");
});

test("group names are a plain sequence per space", () => {
  assert.equal(groupName(1), "子代理组-1");
  assert.equal(nextGroupSequence([], 0), 1);
  assert.equal(nextGroupSequence([{ name: "子代理组-3" }, { name: "总控" }], 0), 4);
  assert.equal(nextGroupSequence([{ name: "子代理组-2" }], 5), 6);
  assert.equal(nextGroupSequence([{ name: "子代理组-x" }], 0), 1);
});

test("dismissed parents and unknown spaces are skipped", () => {
  const unknown = [terminal("t2", "t1")];
  assert.equal(dockGroups({ terminals: unknown, panes: [], docked: {}, off: {} }).length, 0);

  const known = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
  ];
  assert.equal(dockGroups({ terminals: known, panes: [], docked: {}, off: { t1: 1 } }).length, 0);
});

test("an existing tab is reported for reuse", () => {
  const terminals = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
  ];
  const groups = dockGroups({
    terminals,
    panes: [],
    docked: { t1: "tab1" },
    off: {},
  });
  assert.equal(groups[0].tab, "tab1");
});

test("grid plan stacks the first column, then fills rows", () => {
  assert.deepEqual(gridPlan(0, 2), []);
  assert.deepEqual(
    gridPlan(1, 2).map((step) => [step.row, step.col, step.direction, step.child]),
    [[0, 0, "right", 0]],
  );
  assert.deepEqual(
    gridPlan(5, 2).map((step) => [step.row, step.col, step.direction, step.anchor, step.child]),
    [
      [0, 0, "right", null, 0],
      [1, 0, "down", { row: 0, col: 0 }, 2],
      [2, 0, "down", { row: 1, col: 0 }, 4],
      [0, 1, "right", { row: 0, col: 0 }, 1],
      [1, 1, "right", { row: 1, col: 0 }, 3],
    ],
  );
  assert.equal(gridPlan(6, 3).length, 6);
  assert.equal(gridPlan(6, 3)[1].direction, "down");
  assert.deepEqual(
    gridPlan(2, 4).map((step) => step.col),
    [0, 1],
  );
});

test("reconcile turns a closed tab into a dismissal and drops stale records", () => {
  const now = 1_000_000;
  const spaces = [{ id: "sp1", tabs: [{ id: "tab1" }] }];
  const terminals = [
    terminal("t1", null, { labels: { "herdr.space": "sp1" } }),
    terminal("t2", "t1"),
  ];
  const groups = [{ parent: "t1", children: ["t2"] }];
  const kept = reconcileDocks({ spaces, terminals, docked: { t1: "tab1" }, off: {} }, groups, now);
  assert.deepEqual(kept.docked, { t1: "tab1" });
  assert.deepEqual(kept.off, {});

  const closed = reconcileDocks({ spaces, terminals, docked: { t1: "tab9" }, off: {} }, groups, now);
  assert.deepEqual(closed.docked, {});
  assert.deepEqual(closed.off, { t1: now });

  const expired = reconcileDocks(
    { spaces, terminals, docked: {}, off: { t1: now - DOCK_OFF_TTL - 1, gone: now } },
    groups,
    now,
  );
  assert.deepEqual(expired.off, {});

  const dead = reconcileDocks(
    { spaces, terminals: [terminal("t1", null, { state: "finished" })], docked: { t1: "tab1" }, off: {} },
    groups,
    now,
  );
  assert.deepEqual(dead.docked, {});
});
