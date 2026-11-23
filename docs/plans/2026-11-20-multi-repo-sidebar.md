# Multi-Repo Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按已确认设计重构 `herdr-mods/multi-repo-sidebar`：需求 space 下统一展示 agent/普通终端树，直接子终端按仓库聚类，后台读取仓库分支。

**Architecture:** 纯数据层 `lib/model.js` 把 `spaces()/agents()/terminals()/panes()` 组织成需求树；`lib/branches.js` 负责 git 分支缓存的纯逻辑；`main.js` 负责 View、交互与异步 git 调度；`lib/ui.js` 提供视觉组件。

**Tech Stack:** Herdr mod（gpui-kit + herdr API）、JavaScript ESM、Node `node:test`、Herdr CLI。

**依据：** `docs/plans/2026-11-20-multi-repo-sidebar-design.md`

---

## 约束

- 现有 `herdr-mods/multi-repo-sidebar` 是草稿，本计划基于它重构。
- 不删除用户现有 layout；示例 layout 只新增 `herdr-mods/examples/multi-repo.json`。
- 不提交 git，直到用户明确要求。
- 每个行为先写失败测试，再实现，再跑测试。

---

### Task 0: 记录基线

**Files:**
- Read: `herdr-mods/multi-repo-sidebar/main.js`
- Read: `herdr-mods/multi-repo-sidebar/lib/model.js`
- Read: `docs/plans/2026-11-20-multi-repo-sidebar-design.md`

**Step 1: 确认当前测试状态**

Run:
```bash
cd /Users/wangshuxin05/Desktop/study/github/tree-agent-tools/herdr-mods/multi-repo-sidebar
node --test tests/*.test.mjs
```

Expected: 5 tests pass（草稿基线）。若失败，先记录失败项，不继续。

**Step 2: 确认 mod check 基线**

Run:
```bash
herdr-app check /Users/wangshuxin05/.config/herdr-app/mods/multi-repo-sidebar
```

Expected: `check passed: ...`。若 `~/.config/herdr-app/mods/multi-repo-sidebar` 不存在，先运行 `./sync.sh`。

---

### Task 1: 分支缓存纯函数（TDD）

**Files:**
- Create: `tests/branches.test.mjs`
- Create: `lib/branches.js`

**Step 1: 写失败测试**

Create `tests/branches.test.mjs`:

```js
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
  assert.equal(isStale({ checkedAt: 20_000 }, now), true);
  assert.equal(isStale({ checkedAt: 20_001 }, now), false);
  assert.equal(isStale({ checkedAt: 0 }, now, 60_000), true);
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
```

**Step 2: 运行测试确认失败**

Run:
```bash
cd /Users/wangshuxin05/Desktop/study/github/tree-agent-tools/herdr-mods/multi-repo-sidebar
node --test tests/branches.test.mjs
```

Expected: FAIL，错误为 `Cannot find module '../lib/branches.js'`。

**Step 3: 实现最小代码**

Create `lib/branches.js`:

```js
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
```

**Step 4: 运行测试确认通过**

Run:
```bash
node --test tests/branches.test.mjs
```

Expected: 5 tests pass。

---

### Task 2: 重构 model 为“统一终端树 + 直接子终端仓库聚类”（TDD）

**Files:**
- Modify: `lib/model.js`
- Modify: `tests/model.test.mjs`

**Step 1: 写新的失败测试**

Replace `tests/model.test.mjs` with tests that cover:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseName, buildRequirements, displayName, normalizeId, topStatus } from "../lib/model.js";

const labels = (space, tab = "tab1") => ({ "herdr.space": space, "herdr.tab": tab });
const agent = { program: { agent: true, name: "Agent", icon: null, tint: false } };
const terminal = (fields) => ({ state: "live", ...agent, ...fields });
const spaces = [
  { id: "s1", name: "需求 A", active: true, folder: "/w/workspace", branch: "main", tabs: [{ id: "tab1" }] },
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

test("small helpers normalize", () => {
  assert.equal(baseName("/Users/me/repo/"), "repo");
  assert.equal(baseName("C:\\code\\repo"), "repo");
  assert.equal(normalizeId("vps/t7"), "t7");
  assert.equal(topStatus(["idle", "working", "done"]), "done");
  assert.equal(displayName({ name: "", title: "shell", address: "t1" }), "shell");
});
```

**Step 2: 运行测试确认失败**

Run:
```bash
node --test tests/model.test.mjs
```

Expected: FAIL，缺少 `terminalCount` / `workspace` 或结构不符。

**Step 3: 实现新 model**

Replace `lib/model.js` with a model that:

- 保留 `normalizeId`、`rankOf`、`normalizeStatus`、`topStatus`、`baseName`、`displayName`。
- 删除 `cleanName`、`isAgentTerminal`、折叠相关字段。
- `buildRequirements({ spaces, agents, terminals, panes, resolveRepo = () => null })` 返回：

```js
{
  requirements: [{
    id, space, name, active, folder,
    workspace: { name, branch },
    terminalCount,
    roots: [{
      key, address, node,
      repos: [{
        key, name, branch, cwd,
        agents: [node],
        terminalCount,
      }],
    }],
  }],
  order,
  totalTerminals,
}
```

实现要点：

```js
const spaceById = new Map(spaces.map((space) => [normalizeId(space.id), space]));
const spaceId = normalizeId(terminal.labels?.["herdr.space"] ?? agent?.space);
const node = {
  key: `${spaceId}|${local}`,
  address: String(terminal.address),
  local,
  space: spaceId,
  machine: spaceById.get(spaceId)?.machine ?? null,
  name: terminal.name || null,
  title: terminal.title || null,
  cwd: terminal.cwd || pane?.cwd || null,
  parent: terminal.parent ? normalizeId(terminal.parent) : null,
  status: normalizeStatus(agent?.status ?? terminal.status),
  report: typeof terminal.report === "string" ? terminal.report : null,
  program: terminal.program || agent?.program || null,
  pane: agent?.pane || pane?.pane || null,
  tab: normalizeId(terminal.labels?.["herdr.tab"] ?? agent?.tab),
  branch: pane?.branch || null,
  created: Number(terminal.created_ms ?? 0),
  seq: Number(agent?.seq ?? 0),
  children: [],
};
```

- 所有 `state === "live"` 且能确定 space 的终端都进入 nodes（不再按 agent 过滤）。
- 按 parent 建树；parent 不在本 space 的节点成为 root。
- roots 按 tab 顺序、`created`、`local` 排序。
- 需求 workspace：

```js
const folder = space.folder || mine[0]?.cwd || "";
const info = resolveRepo(folder, space);
const workspace = {
  name: info?.name || baseName(folder) || space.name || "",
  branch: info?.branch || space.branch || null,
};
```

- 每个 root 的直接 children：

```js
const info = resolveRepo(child.cwd, space);
const key = info?.key || `${space.machine ?? ""}|${child.cwd || child.address}`;
const name = info?.name || baseName(child.cwd) || displayName(child);
const branch = info?.branch || child.branch || null;
```

- 同 key 合并为一个 repo group；`terminalCount` 为 group 内 agents 及其所有后代数量。
- `order` 按渲染顺序 push 终端地址：root → repo group 下每个 agent 及其后代 → 下一个 repo → 下一个 root → 下一个需求。
- 不生成折叠、聚合状态字段。

**Step 4: 运行测试确认通过**

Run:
```bash
node --test tests/model.test.mjs
```

Expected: 6 tests pass。

---

### Task 3: 重构 UI

**Files:**
- Modify: `lib/ui.js`
- Modify: `main.js`

**Step 1: ui.js 增加/保留组件**

保留：

- `Icon(name, size)`：`mods/multi-repo-sidebar/icons/*.svg`
- `Avatar(space, size)`
- `Status(t, status)`：working spinner、blocked 徽标、done 实心点、idle 圆环
- `IconButton`
- `CountPill`

新增：

```js
export function Rail(kind) {
  const t = theme();
  const line = () => div().absolute().left(5).border_color(t.border);
  return div()
    .relative()
    .w(12)
    .flex_none()
    .self_stretch()
    .when(kind === "│" || kind === "├", (el) => el.child(line().top(0).bottom(0).border_l(1)))
    .when(kind === "├" || kind === "└", (el) =>
      el.child(line().top(0).h(13).w(6).border_l(1).border_b(1).rounded_bl(4)),
    );
}

export function ProgramIcon(program, size = 14) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(size).flex_none()
    : image(program.icon).w(size).h(size).flex_none();
}
```

`ui.js` 需要从 `gpui-kit` 同时 import `image`。

**Step 2: main.js 删除折叠/聚合逻辑**

删除：

- `readSet`、`writeSet`、`foldedSpaces`、`foldedRepos`、`toggle`。
- 需求行、仓库行的折叠箭头与 click stopPropagation。
- 所有 `req.status` / `repo.status` / 聚合状态用法。
- `README.md` 中关于折叠和聚合状态的描述改为“始终展开”。

保留：

- `find(node, id)`、`narrow()`、`toggleSidebar()`。
- 需求选择、space 右键菜单、agent 聚焦、`setAgentOrder`、ScrollHandle。
- rail 模式。

**Step 3: 需求行改为两行**

```js
v_flex().id(`requirement-${requirement.id}`).flex_none().pb(3)
  .child(
    h_flex().id(`requirement-row-${requirement.id}`)
      .h(28).px(8).gap(7).rounded(7).items_center().cursor_pointer()
      .when(requirement.active, (el) => el.bg(t.selected))
      .when(!requirement.active, (el) => el.hover((style) => style.bg(t.hover)))
      .on_click(() => this.selectSpace(requirement.space))
      .on_mouse_down("right", () => this.openSpaceMenu(requirement.space))
      .tooltip(`${requirement.terminalCount} terminals`)
      .child(Avatar(requirement.space, 18))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(requirement.name))
      .child(CountPill(requirement.terminalCount)),
  )
  .child(
    h_flex().id(`workspace-${requirement.id}`)
      .h(24).pl(26).pr(8).gap(5).items_center()
      .child(Icon("folder", 12).text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(requirement.workspace.name))
      .when(Boolean(requirement.workspace.branch), (el) =>
        el.child(div().flex_none().max_w(110).truncate().text_size(10.5).text_color(t.dim).child(requirement.workspace.branch)),
      ),
  )
  .child(this.roots(requirement, t));
```

`roots` 渲染每个顶层终端，使用统一 `terminalRow`，并为 repo group 生成树线：

```js
roots(requirement, t) {
  const rows = [];
  requirement.roots.forEach((root, rootIndex) => {
    const rootLast = rootIndex === requirement.roots.length - 1;
    const rootLines = [rootLast ? "└" : "├"];
    rows.push(this.terminalRow(root.node, rootLines, t));
    const lead = [rootLast ? " " : "│"];
    root.repos.forEach((repo, repoIndex) => {
      const repoLast = repoIndex === root.repos.length - 1;
      const repoLines = [...lead, repoLast ? "└" : "├"];
      rows.push(this.repoRow(repo, repoLines, t));
      const agentLead = [...lead, repoLast ? " " : "│"];
      this.agentTree(repo.agents, agentLead, t, rows);
    });
  });
  return rows.length ? v_flex().pl(9).ml(9).border_l(1).border_color(t.border).children(rows) : null;
}
```

`agentTree` 递归：

```js
agentTree(agents, lead, t, rows) {
  agents.forEach((agent, index) => {
    const last = index === agents.length - 1;
    const lines = [...lead, last ? "└" : "├"];
    rows.push(this.terminalRow(agent, lines, t));
    this.agentTree(agent.children, [...lead, last ? " " : "│"], t, rows);
  });
}
```

**Step 4: 终端行与仓库行**

`terminalRow(node, lines, t)`：

```js
const icon = ProgramIcon(node.program, 14);
const title = displayName(node);
return h_flex()
  .id(`terminal-${node.key}`)
  .h(26).px(6).gap(6).rounded(6).items_center().cursor_pointer()
  .hover((style) => style.bg(t.hover))
  .on_click(() => this.focusAgent(node))
  .tooltip(`${title}${node.cwd ? ` · ${node.cwd}` : ""}${node.report ? ` · ${node.report}` : ""}`)
  .children(lines.map((line) => Rail(line)))
  .when(Boolean(icon), (el) => el.child(icon))
  .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(title))
  .when(Boolean(node.status), (el) => el.child(Status(t, node.status)));
```

`repoRow(repo, lines, t)`：

```js
const first = repo.agents[0];
return h_flex()
  .id(`repo-${repo.key}`)
  .h(27).px(6).gap(6).rounded(6).items_center().cursor_pointer()
  .hover((style) => style.bg(t.hover))
  .on_click(() => first && this.focusAgent(first))
  .tooltip(`${repo.name}${repo.branch ? ` · ${repo.branch}` : ""}`)
  .children(lines.map((line) => Rail(line)))
  .child(Icon("branch", 12).text_color(t.muted))
  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(repo.name))
  .when(repo.agents.length > 1, (el) => el.child(CountPill(repo.agents.length)))
  .when(Boolean(repo.branch), (el) =>
    el.child(div().flex_none().max_w(100).truncate().text_size(10.5).text_color(t.dim).child(repo.branch)),
  );
```

**Step 5: 更新 header 与 rail**

- Header 不再显示 blocked 聚合计数。
- rail 只显示需求头像，不显示状态点。

**Step 6: 运行检查**

Run:
```bash
./sync.sh
herdr-app check ~/.config/herdr-app/mods/multi-repo-sidebar
```

Expected: `check passed: ...`。

---

### Task 4: 接入后台 git 分支

**Files:**
- Modify: `main.js`
- Modify: `lib/model.js`（如果 Task 2 已支持 `resolveRepo`，此处只接线）

**Step 1: 初始化缓存**

在 `init` 中：

```js
this.branches = {};
this.branchQueue = [];
this.branchBusy = false;
this.watchers = new Map();
if (!checking()) {
  this.refreshBranches(cx);
  cx.timer.every(15000, (cx) => this.refreshBranches(cx));
}
```

**Step 2: 生成渲染并接线**

`render` 中：

```js
const model = buildRequirements({
  spaces: spaces(),
  agents: agents(),
  terminals: terminals(),
  panes: panes(),
  resolveRepo: (cwd, space) => this.repoInfo(cwd, space?.machine ?? null),
});
this.model = model;
```

`repoInfo`：

```js
repoInfo(cwd, machine = null) {
  if (!cwd) return null;
  const entry = this.branches[cacheKey(machine, cwd)];
  if (!entry?.repoRoot) return null;
  return {
    key: `${machine ?? ""}|${entry.repoRoot}`,
    name: entry.repoRoot.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || entry.repoRoot,
    branch: entry.branch || null,
  };
}
```

**Step 3: 收集并刷新**

```js
refreshBranches(cx) {
  const model = this.model;
  if (!model) return;
  const requests = [];
  for (const requirement of model.requirements) {
    const folder = requirement.space.folder;
    if (folder) requests.push({ machine: requirement.space.machine ?? null, cwd: folder });
    for (const root of requirement.roots) for (const repo of root.repos) requests.push({ machine: requirement.space.machine ?? null, cwd: repo.cwd });
  }
  const due = dueRequests(requests, this.branches, Date.now());
  if (!due.length) return;
  this.branchQueue.push(...due);
  if (this.branchBusy) return;
  this.branchBusy = true;
  cx.spawn(async (cx) => {
    while (this.branchQueue.length) {
      const batch = nextBatch(this.branchQueue, 6);
      await Promise.all(batch.map((request) => this.readBranch(request, cx)));
    }
    this.branchBusy = false;
    cx.notify();
  });
}
```

**Step 4: 读取 git**

```js
async readBranch(request, cx) {
  const key = cacheKey(request.machine, request.cwd);
  const previous = this.branches[key];
  try {
    const [root, head] = await Promise.all([
      exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd: request.cwd, on: request.machine }),
      exec("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: request.cwd, on: request.machine }),
    ]);
    const repoRoot = parseRepoRoot(root);
    this.branches[key] = {
      ...(previous ?? {}),
      repoRoot: repoRoot || request.cwd,
      branch: parseBranch(head) || (head.code === 0 ? "(detached)" : null),
      checkedAt: Date.now(),
      error: false,
    };
    if (!request.machine && repoRoot) this.watchRepo(repoRoot, cx);
  } catch {
    this.branches[key] = { ...(previous ?? {}), checkedAt: Date.now(), error: true };
  }
}
```

**Step 5: 监听本地仓库**

```js
watchRepo(repoRoot, cx) {
  if (this.watchers.has(repoRoot)) return;
  const pending = watchFolder(repoRoot);
  this.watchers.set(repoRoot, pending);
  cx.spawn(async (cx) => {
    let current = pending;
    try {
      for (;;) {
        await current;
        if (this.watchers.get(repoRoot) !== current) return;
        for (const [key, entry] of Object.entries(this.branches)) {
          if (entry.repoRoot === repoRoot) delete this.branches[key];
        }
        this.refreshBranches(cx);
        current = watchFolder(repoRoot);
        this.watchers.set(repoRoot, current);
      }
    } catch {}
    if (this.watchers.get(repoRoot) === current) this.watchers.delete(repoRoot);
  });
}
```

**Step 6: 导入**

From `herdr`: `checking`, `exec`, `watchFolder`。
From `lib/branches.js`: `cacheKey`, `dueRequests`, `nextBatch`, `parseBranch`, `parseRepoRoot`。

**Step 7: 检查**

Run:
```bash
./sync.sh
herdr-app check ~/.config/herdr-app/mods/multi-repo-sidebar
```

Expected: `check passed: ...`。检查阶段不会执行 git。

---

### Task 5: 更新布局、README、sync

**Files:**
- Modify: `herdr-mods/examples/multi-repo.json`
- Modify: `README.md`
- Modify: `sync.sh`（如无需变更则不改）

**Step 1: 布局**

保留单一 `multi-repo-sidebar` block。确认 sidebar 宽度 280，min 44，max 480。

**Step 2: README**

更新：

- 数据模型：需求 = space；工作区仓库信息在第二行；所有 live 终端同树；只聚类直接子终端。
- 删除折叠、聚合状态说明。
- 增加“分支由后台 git 读取，15s TTL，本地监听”。
- 保留安装、layout 接入、开发命令。

**Step 3: 检查 sync**

`sync.sh` 必须：

- 拷贝 mod 到 `~/.config/herdr-app/mods/multi-repo-sidebar`。
- 不拷贝 `tests`、`package.json`、`layouts` 到 mod 目录。
- `--with-layout` 时复制 `herdr-mods/examples/multi-repo.json`。
- 运行 `herdr-app check`。

---

### Task 6: 验证与截图

**Files:**
- Test: `tests/*.test.mjs`
- Verify: `~/.config/herdr-app/mods/multi-repo-sidebar`

**Step 1: 全部测试**

Run:
```bash
cd /Users/wangshuxin05/Desktop/study/github/tree-agent-tools/herdr-mods/multi-repo-sidebar
node --test tests/*.test.mjs
```

Expected: 全部 pass，0 fail。

**Step 2: 安装与 check**

Run:
```bash
./sync.sh --with-layout
herdr-app check ~/.config/herdr-app/mods/multi-repo-sidebar
```

Expected: `check passed: ...`。

**Step 3: 切换 layout 并截图**

Run:
```bash
herdr-app do layout.switch '{"name":"multi-repo"}'
sleep 2
herdr-app shot /tmp/multi-repo-sidebar.png
```

Expected: 输出 `/tmp/multi-repo-sidebar.png`；用读图工具检查：
- 需求行两行；
- 工作区仓库名和分支可见；
- 无折叠箭头；
- 无聚合状态；
- agent/普通终端同一种行样式。

**Step 4: 恢复原 layout**

Run:
```bash
herdr-app do layout.switch '{"name":"main"}'
```

Expected: `{"ok": true}`。

**Step 5: 检查错误文件**

Run:
```bash
ls ~/.config/herdr-app/mods/multi-repo-sidebar.error ~/.config/herdr-app/layouts/multi-repo.error 2>/dev/null || true
```

Expected: 无输出。

**Step 6: 汇报**

汇报必须包含：

- `node --test` 的实际 pass/fail 数。
- `herdr-app check` 的实际输出。
- 截图路径与观察结果。
- 未提交 git 的说明。

---

## 交付说明

- 代码路径：`herdr-mods/multi-repo-sidebar/`
- 设计文档：`docs/plans/2026-11-20-multi-repo-sidebar-design.md`
- 本文档：`docs/plans/2026-11-20-multi-repo-sidebar.md`
- 不删除现有草稿，按任务逐步修改。
- 所有 commit 步骤仅在用户明确要求时执行。
