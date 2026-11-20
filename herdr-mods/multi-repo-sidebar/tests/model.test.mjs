import { test } from "node:test";
import assert from "node:assert/strict";
import { baseName, buildRequirements, displayName, normalizeId, topStatus } from "../lib/model.js";

const labels = (space, tab = "tab1") => ({ "herdr.space": space, "herdr.tab": tab });
const agent = { program: { agent: true, name: "Agent", icon: null, tint: false } };
const terminal = (fields) => ({ state: "live", ...agent, ...fields });
const spaces = [
  { id: "s1", name: "需求 A", active: true, folder: "/w/workspace", branch: "main", tabs: [{ id: "tab1", name: "总控", named: true }] },
  { id: "s2", name: "需求 B", active: false, folder: "/w/other", tabs: [{ id: "tab2" }] },
];
const agents = [
  { address: "t1", pane: "p1", space: "s1", tab: "tab1", status: "working", seq: 5 },
  { address: "t2", pane: "p2", space: "s1", tab: "tab1", status: "blocked", seq: 4 },
  { address: "t3", pane: "p3", space: "s1", tab: "tab1", status: "idle", seq: 3 },
  { address: "t4", pane: "p4", space: "s1", tab: "tab1", status: "done", seq: 2 },
  { address: "t5", pane: "p5", space: "s2", tab: "tab2", status: "idle", seq: 1 },
];
const terminals = [
  terminal({ address: "t1", parent: null, cwd: "/w/workspace", created_ms: 1, status: "working", labels: labels("s1") }),
  terminal({ address: "t2", parent: "t1", cwd: "/w/repo-a", created_ms: 2, status: "blocked", labels: labels("s1") }),
  terminal({ address: "t3", parent: "t2", cwd: "/w/repo-a/src", created_ms: 3, status: "idle", labels: labels("s1") }),
  terminal({ address: "t4", parent: "t1", cwd: "/w/repo-b", created_ms: 4, status: "done", labels: labels("s1") }),
  terminal({ address: "t5", parent: null, cwd: "/w/other", created_ms: 5, status: "idle", labels: labels("s2", "tab2") }),
  terminal({ address: "t6", parent: null, cwd: "/w/plain", created_ms: 6, status: null, labels: labels("s1"), program: null }),
];
const panes = [
  { pane: "p1", terminal: "t1", branch: "main", cwd: "/w/workspace" },
  { pane: "p2", terminal: "t2", branch: "feature-a", cwd: "/w/repo-a" },
  { pane: "p3", terminal: "t3", branch: "feature-a", cwd: "/w/repo-a/src" },
  { pane: "p4", terminal: "t4", branch: "feature-b", cwd: "/w/repo-b" },
  { pane: "p5", terminal: "t5", branch: "main", cwd: "/w/other" },
];
const repoInfo = {
  "/w/workspace": { key: "root|/w/workspace", name: "workspace", branch: "main" },
  "/w/repo-a": { key: "root|/w/repo-a", name: "repo-a", branch: "feature-a" },
  "/w/repo-a/src": { key: "root|/w/repo-a", name: "repo-a", branch: "feature-a" },
  "/w/repo-a/tools": { key: "root|/w/repo-a", name: "repo-a", branch: "feature-a" },
  "/w/repo-a2": { key: "root|/w/repo-a2", name: "repo-a2", branch: "feature-a2" },
  "/w/repo-b": { key: "root|/w/repo-b", name: "repo-b", branch: "feature-b" },
  "/w/other": { key: "root|/w/other", name: "other", branch: "main" },
};
const resolveRepo = (cwd) => repoInfo[cwd] ?? null;

test("all live terminals, agents and plain shells, share one tree", () => {
  const model = buildRequirements({ spaces, agents, terminals, panes, resolveRepo });
  const requirement = model.requirements[0];
  assert.equal(requirement.name, "需求 A");
  assert.equal(requirement.workspace.name, "workspace");
  assert.equal(requirement.workspace.branch, "main");
  assert.equal(requirement.terminalCount, 5);
  assert.equal(requirement.roots.length, 2);
  assert.equal(requirement.roots[0].node.address, "t1");
  assert.equal(requirement.roots[0].node.tabName, "总控");
  assert.equal(requirement.roots[0].node.tabNamed, true);
  assert.equal(requirement.roots[1].node.address, "t6");
});

test("direct children cluster by resolved repo root; deeper agents keep parent", () => {
  const model = buildRequirements({ spaces, agents, terminals, panes, resolveRepo });
  const root = model.requirements[0].roots[0];
  assert.equal(root.repos.length, 2);
  assert.equal(root.repos[0].name, "repo-a");
  assert.equal(root.repos[0].branch, "feature-a");
  assert.equal(root.repos[0].agents.length, 1);
  assert.equal(root.repos[0].agents[0].address, "t2");
  assert.equal(root.repos[0].agents[0].children[0].address, "t3");
  assert.equal(root.repos[1].name, "repo-b");
});

test("cwd subdirectories resolve to the same repo group", () => {
  const extra = [
    ...terminals,
    terminal({ address: "t7", parent: "t1", cwd: "/w/repo-a/tools", created_ms: 7, status: "working", labels: labels("s1") }),
  ];
  const model = buildRequirements({ spaces, agents, terminals: extra, panes, resolveRepo });
  const repoA = model.requirements[0].roots[0].repos[0];
  assert.equal(repoA.name, "repo-a");
  assert.equal(repoA.agents.length, 2);
});

test("order follows the visible tree and never includes repo rows", () => {
  const model = buildRequirements({ spaces, agents, terminals, panes, resolveRepo });
  assert.deepEqual(model.order, ["t1", "t2", "t3", "t4", "t6", "t5"]);
  assert.equal(model.totalTerminals, 6);
});

test("missing parents become roots and finished terminals stay out", () => {
  const extra = [
    ...terminals,
    terminal({ address: "t8", parent: "gone", cwd: "/w/orphan", created_ms: 8, status: "idle", labels: labels("s1") }),
    terminal({ address: "t9", parent: "t1", cwd: "/w/repo-a", created_ms: 9, state: "finished", labels: labels("s1") }),
  ];
  const model = buildRequirements({ spaces, agents, terminals: extra, panes, resolveRepo });
  assert.equal(model.requirements[0].roots.length, 3);
  assert.equal(model.requirements[0].roots[2].node.address, "t8");
  assert.equal(model.totalTerminals, 7);
});

test("unlabeled subagents inherit space and tab from their parent", () => {
  const extra = [
    ...terminals,
    terminal({ address: "t10", parent: "t1", cwd: "/w/repo-a2", created_ms: 10, status: "working" }),
  ];
  const model = buildRequirements({ spaces, agents, terminals: extra, panes, resolveRepo });
  const requirement = model.requirements[0];
  assert.equal(requirement.terminalCount, 6);
  const repo = requirement.roots[0].repos.find((candidate) => candidate.name === "repo-a2");
  assert.equal(repo.agents[0].space, "s1");
  assert.equal(repo.agents[0].tab, "tab1");
  assert.equal(model.totalTerminals, 7);
});

test("where label assigns a space when the parent is gone", () => {
  const extra = [
    ...terminals,
    terminal({
      address: "t11",
      parent: "gone",
      cwd: "/w/orphan2",
      created_ms: 11,
      status: "idle",
      labels: { where: "需求 A / tab1" },
    }),
  ];
  const model = buildRequirements({ spaces, agents, terminals: extra, panes, resolveRepo });
  const requirement = model.requirements[0];
  assert.equal(requirement.terminalCount, 6);
  const orphan = requirement.roots.find((root) => root.node.address === "t11");
  assert.equal(orphan.node.space, "s1");
});

test("workspace line follows the first top-level terminal in a repo", () => {
  const toolSpaces = [{ id: "s3", name: "AI工具", active: false, folder: "/Users/me", tabs: [] }];
  const toolTerminals = [
    terminal({
      address: "u1",
      parent: null,
      cwd: "/Users/me",
      created_ms: 1,
      status: null,
      labels: labels("s3"),
      program: null,
    }),
    terminal({ address: "u2", parent: null, cwd: "/w/repo-c", created_ms: 2, status: "idle", labels: labels("s3") }),
  ];
  const toolRepo = (cwd) =>
    cwd === "/w/repo-c" ? { key: "root|/w/repo-c", name: "repo-c", branch: "feat-c" } : null;
  const model = buildRequirements({
    spaces: toolSpaces,
    agents: [],
    terminals: toolTerminals,
    panes: [],
    resolveRepo: toolRepo,
    homeFolder: "/Users/me",
  });
  assert.equal(model.requirements[0].workspace.name, "repo-c");
  assert.equal(model.requirements[0].workspace.branch, "feat-c");
  assert.equal(model.requirements[0].folder, "/w/repo-c");
});

test("workspace line follows the live top-level terminal even when space folder differs", () => {
  const folderSpaces = [{ id: "s4", name: "配置需求", active: false, folder: "/w/repo-a", tabs: [] }];
  const folderTerminals = [
    terminal({ address: "v1", parent: null, cwd: "/w/repo-b", created_ms: 1, status: "idle", labels: labels("s4") }),
  ];
  const folderRepo = (cwd) => ({ key: `root|${cwd}`, name: cwd.replace("/w/", ""), branch: "main" });
  const model = buildRequirements({
    spaces: folderSpaces,
    agents: [],
    terminals: folderTerminals,
    panes: [],
    resolveRepo: folderRepo,
    homeFolder: "/Users/me",
  });
  assert.equal(model.requirements[0].workspace.name, "repo-b");
  assert.equal(model.requirements[0].folder, "/w/repo-b");
});

test("small helpers normalize", () => {
  assert.equal(baseName("/Users/me/repo/"), "repo");
  assert.equal(baseName("C:\\code\\repo"), "repo");
  assert.equal(normalizeId("vps/t7"), "t7");
  assert.equal(topStatus(["idle", "working", "done"]), "done");
  assert.equal(displayName({ name: "", title: "shell", address: "t1" }), "shell");
});
