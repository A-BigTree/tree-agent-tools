# Multi-Repo Sidebar 自动停靠实现计划

> **For the executor:** 按任务顺序做，每个任务先写失败测试再实现。测试命令统一在 `herdr-mods/multi-repo-sidebar/` 下执行。

**Goal:** 让 mod 自动把同一父 agent 的无 pane 子 agent 停靠到新建 tab，并按可配置列数排成网格。

**Architecture:** 纯函数放 `lib/docking.js`（候选识别、分组、网格规划、记录回收）；`main.js` 用 1 秒轮询状态机执行 `tab.new` / `pane.focus` / `terminal.keep` / `pane.close`，记录存 `localStorage`。

**Tech Stack:** Herdr mod（JavaScript、gpui-kit）、Node `node:test`。

---

## Task 1: 偏好新增 autoDock 与 dockColumns

**Files:**
- Modify: `herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/lib/preferences.js`
- Test: `herdr-mods/multi-repo-sidebar/tests/preferences.test.mjs`

**Step 1: 写失败测试**

在 `tests/preferences.test.mjs` 追加：

```js
test("auto docking defaults on with two columns", () => {
  assert.equal(PREFERENCE_DEFAULTS.autoDock, true);
  assert.equal(PREFERENCE_DEFAULTS.dockColumns, 2);
  assert.deepEqual(normalizePreferences({}), PREFERENCE_DEFAULTS);
  assert.equal(normalizePreferences({ autoDock: false }).autoDock, false);
});

test("dock columns clamp to 1..4 and ignore junk", () => {
  assert.equal(normalizePreferences({ dockColumns: 0 }).dockColumns, 1);
  assert.equal(normalizePreferences({ dockColumns: 9 }).dockColumns, 4);
  assert.equal(normalizePreferences({ dockColumns: "3" }).dockColumns, 3);
  assert.equal(normalizePreferences({ dockColumns: 2.6 }).dockColumns, 3);
  assert.equal(normalizePreferences({ dockColumns: "x" }).dockColumns, 2);
  assert.equal(clampDockColumns(undefined), 2);
});
```

同时把 import 改成：

```js
import {
  PREFERENCE_DEFAULTS,
  clampDockColumns,
  isVisible,
  normalizePreferences,
  togglePreference,
} from "../mods/multi-repo-sidebar/lib/preferences.js";
```

**Step 2: 跑测试确认失败**

Run: `node --test tests/preferences.test.mjs`
Expected: FAIL，`clampDockColumns is not a function` / 缺失字段。

**Step 3: 实现**

`lib/preferences.js` 改为：

```js
export const PREFERENCES_KEY = "multi-repo.preferences";

export const DOCK_COLUMN_RANGE = { min: 1, max: 4 };

export const PREFERENCE_DEFAULTS = {
  showBranch: true,
  showStatus: true,
  autoDock: true,
  dockColumns: 2,
};

export const PREFERENCE_TOGGLES = [
  { key: "showBranch", label: "仓库分支名", description: "在仓库行下方显示分支名" },
  { key: "showStatus", label: "Git 状态", description: "在仓库名后显示改动、同步状态" },
  { key: "autoDock", label: "自动停靠子 agent", description: "为同一父 agent 的子 agent 新建 tab 并排成网格" },
];

export function clampDockColumns(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return PREFERENCE_DEFAULTS.dockColumns;
  return Math.min(DOCK_COLUMN_RANGE.max, Math.max(DOCK_COLUMN_RANGE.min, number));
}

export function normalizePreferences(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    showBranch: raw.showBranch !== false,
    showStatus: raw.showStatus !== false,
    autoDock: raw.autoDock !== false,
    dockColumns: clampDockColumns(raw.dockColumns),
  };
}

export function togglePreference(value, key) {
  const current = normalizePreferences(value);
  if (!(key in current)) return current;
  return { ...current, [key]: !current[key] };
}

export function isVisible(value, key) {
  return Boolean(normalizePreferences(value)[key]);
}
```

注意：`clampDockColumns(undefined)` 必须先于默认值判断返回 2；`Number(undefined)` 是 `NaN` 已被覆盖。

**Step 4: 跑测试**

Run: `node --test tests/*.test.mjs`
Expected: 全绿（原 23 个 + 新增）。

**Step 5: 提交**

```bash
git add herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/lib/preferences.js \
  herdr-mods/multi-repo-sidebar/tests/preferences.test.mjs
git commit -m "feat(herdr): add auto-dock preferences"
```

---

## Task 2: 纯函数 docking 模块

**Files:**
- Create: `herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/lib/docking.js`
- Test: `herdr-mods/multi-repo-sidebar/tests/docking.test.mjs`

**Step 1: 写失败测试**

新建 `tests/docking.test.mjs`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_OFF_TTL,
  dockGroups,
  gridPlan,
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
    terminal("t1", "t0"),
    terminal("t2", "t1"),
    terminal("t3", "t1", { state: "finished" }),
    terminal("t4", null),
  ];
  const groups = dockGroups({
    terminals,
    panes,
    docked: {},
    off: {},
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].children, ["t2"]);
  assert.equal(groups[0].parent, "t1");
  assert.equal(groups[0].space, null);
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
  assert.match(groups[0].name, /^子代理 · /);
});

test("dismissed parents and unknown spaces are skipped", () => {
  const terminals = [terminal("t2", "t1")];
  assert.equal(dockGroups({ terminals, panes: [], docked: {}, off: { t1: 1 } }).length, 0);
  assert.equal(dockGroups({ terminals, panes: [], docked: {}, off: {} }).length, 0);
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
  const terminals = [terminal("t1", null), terminal("t2", "t1")];
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
});
```

**Step 2: 跑测试确认失败**

Run: `node --test tests/docking.test.mjs`
Expected: FAIL，`Cannot find module .../lib/docking.js`。

**Step 3: 实现**

新建 `lib/docking.js`：

```js
import { displayName, normalizeId } from "./model.js";

export const DOCKED_KEY = "multi-repo.docked";
export const DOCK_OFF_KEY = "multi-repo.dockOff";
export const DOCK_OFF_TTL = 24 * 60 * 60 * 1000;

function hasPane(terminal, paneTerminals) {
  return paneTerminals.has(normalizeId(terminal.address));
}

export function spaceFromChain(terminal, byId) {
  let cursor = terminal;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const space = cursor.labels?.["herdr.space"];
    if (space) return normalizeId(space);
    cursor = byId.get(normalizeId(cursor.parent));
  }
  return null;
}

export function dockGroups({ terminals = [], panes = [], docked = {}, off = {} } = {}) {
  const paneTerminals = new Set(
    panes
      .filter((pane) => pane && pane.terminal)
      .map((pane) => normalizeId(pane.terminal)),
  );
  const byId = new Map();
  for (const terminal of terminals) {
    if (terminal) byId.set(normalizeId(terminal.address), terminal);
  }

  const groups = new Map();
  for (const terminal of terminals) {
    if (!terminal || terminal.state !== "live" || !terminal.parent) continue;
    if (hasPane(terminal, paneTerminals)) continue;
    const parent = normalizeId(terminal.parent);
    if (off[parent]) continue;
    const space = spaceFromChain(terminal, byId);
    if (!space) continue;
    let group = groups.get(parent);
    if (!group) {
      const parentTerminal = byId.get(parent);
      group = {
        parent,
        space,
        name: `子代理 · ${parentTerminal ? displayName(parentTerminal) : parent}`,
        tab: docked[parent] ? normalizeId(docked[parent]) : null,
        children: [],
      };
      groups.set(parent, group);
    }
    group.children.push(String(terminal.address));
  }
  return [...groups.values()];
}

export function gridPlan(count, columns) {
  const plan = [];
  if (!(count > 0)) return plan;
  const cols = Math.min(Math.max(1, Math.floor(Number(columns)) || 1), count);
  const rows = Math.ceil(count / cols);
  const anchor = (row, col) => ({ row, col });

  plan.push({ row: 0, col: 0, direction: "right", anchor: null, child: 0 });
  for (let row = 1; row < rows; row++) {
    plan.push({ row, col: 0, direction: "down", anchor: anchor(row - 1, 0), child: row * cols });
  }
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, count - row * cols);
    for (let col = 1; col < inRow; col++) {
      plan.push({
        row,
        col,
        direction: "right",
        anchor: anchor(row, col - 1),
        child: row * cols + col,
      });
    }
  }
  return plan;
}

export function reconcileDocks(
  { spaces = [], terminals = [], docked = {}, off = {} } = {},
  groups = [],
  now = Date.now(),
) {
  const tabs = new Set();
  for (const space of spaces) {
    for (const tab of space?.tabs ?? []) tabs.add(normalizeId(tab.id));
  }
  const live = new Set(
    terminals.filter((terminal) => terminal?.state === "live").map((terminal) => normalizeId(terminal.address)),
  );
  const waiting = new Set(groups.map((group) => group.parent));
  const nextDocked = {};
  const nextOff = { ...off };

  for (const [parent, tab] of Object.entries(docked)) {
    const tabId = normalizeId(tab);
    if (tabs.has(tabId)) nextDocked[parent] = tabId;
    else if (waiting.has(parent)) nextOff[parent] = now;
  }
  for (const [parent, at] of Object.entries(nextOff)) {
    if (!live.has(parent) || now - Number(at) > DOCK_OFF_TTL) delete nextOff[parent];
  }
  return { docked: nextDocked, off: nextOff };
}
```

**Step 4: 跑测试**

Run: `node --test tests/docking.test.mjs`
Expected: PASS。

**Step 5: 提交**

```bash
git add herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/lib/docking.js \
  herdr-mods/multi-repo-sidebar/tests/docking.test.mjs
git commit -m "feat(herdr): plan child-agent docking groups"
```

---

## Task 3: 接入状态机与设置面板

**Files:**
- Modify: `herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/main.js`
- Modify: `herdr-mods/multi-repo-sidebar/tests/model.test.mjs`（可选：只补导入，不改行为）

**Step 1: 引入模块与记录读写**

顶部 import 增加：

```js
import {
  DOCK_OFF_KEY,
  DOCKED_KEY,
  dockGroups,
  gridPlan,
  reconcileDocks,
} from "./lib/docking.js";
```

`lib/model.js` 的 import 追加 `normalizeId`。

模块级 helper（放在 `writeSet` 后）：

```js
function readMap(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeMap(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function slotKey(slot) {
  return `${slot.row}:${slot.col}`;
}
```

**Step 2: init 注册轮询**

`init` 中在现有 `cx.timer.every(1500, ...)` 后追加：

```js
    this.dock = null;
    if (!checking() && this.panel === "sidebar") {
      cx.timer.every(1000, (cx) => this.dockTick(cx));
    }
```

**Step 3: 状态机方法**

在 `refreshBranches` 后加入：

```js
  dockTick(cx) {
    if (checking()) return;
    if (!this.preferences().autoDock) return;
    if (this.dock) {
      this.stepDock(cx);
      return;
    }

    const currentSpaces = spaces();
    const currentTerminals = terminals();
    const currentPanes = panes();
    const docked = readMap(DOCKED_KEY);
    const off = readMap(DOCK_OFF_KEY);
    const groups = dockGroups({ terminals: currentTerminals, panes: currentPanes, docked, off });
    const records = reconcileDocks(
      { spaces: currentSpaces, terminals: currentTerminals, docked, off },
      groups,
    );
    if (JSON.stringify(records.docked) !== JSON.stringify(docked)) writeMap(DOCKED_KEY, records.docked);
    if (JSON.stringify(records.off) !== JSON.stringify(off)) writeMap(DOCK_OFF_KEY, records.off);

    const next = groups
      .map((group) => ({ ...group, tab: records.docked[group.parent] ?? null }))
      .find((group) => group.children.length && !group.tab);
    if (next) this.startDock(next);
  }

  startDock(group) {
    const plan = gridPlan(group.children.length, this.preferences().dockColumns);
    let created = null;
    try {
      created = run("tab.new", { name: group.name, space: group.space, focus: false });
    } catch {
      return;
    }
    if (!created?.tab || !created?.terminal) return;
    this.dock = {
      parent: group.parent,
      tab: created.tab,
      spacer: created.terminal,
      spacerPane: null,
      children: group.children,
      plan,
      index: 0,
      slots: {},
      waiting: null,
      waitingStep: null,
      waitUntil: 0,
      fails: 0,
      focus: focused(),
    };
  }

  stepDock(cx) {
    const dock = this.dock;
    if (!dock) return;
    const currentPanes = panes();
    const paneOf = (terminal) =>
      currentPanes.find((pane) => normalizeId(pane.terminal) === normalizeId(terminal))?.pane ?? null;

    if (!dock.spacerPane) {
      dock.spacerPane = paneOf(dock.spacer);
      if (!dock.spacerPane) {
        if (Date.now() - dock.startedAt > 10_000) this.abortDock(false);
        return;
      }
    }

    if (dock.waiting) {
      const pane = paneOf(dock.waiting);
      if (pane) {
        dock.slots[slotKey(dock.waitingStep)] = pane;
        dock.waiting = null;
        dock.waitingStep = null;
        dock.fails = 0;
      } else if (Date.now() > dock.waitUntil) {
        dock.fails += 1;
        if (dock.fails >= 2) {
          this.abortDock(true);
          return;
        }
        dock.waitUntil = Date.now() + 3000;
        return;
      } else {
        return;
      }
    }

    if (dock.index >= dock.plan.length) {
      this.finishDock(cx);
      return;
    }

    const step = dock.plan[dock.index];
    const anchor = step.anchor ? dock.slots[slotKey(step.anchor)] : dock.spacerPane;
    if (!anchor) return;
    const terminal = dock.children[step.child];
    if (!terminal) {
      dock.index += 1;
      return;
    }

    const landed = paneOf(terminal);
    if (landed) {
      dock.slots[slotKey(step)] = landed;
      dock.index += 1;
      return;
    }

    try {
      if (focused()?.pane !== anchor) run("pane.focus", { pane: anchor });
      const result = run("terminal.keep", { terminal, place: step.direction });
      if (result?.error) {
        dock.fails += 1;
        if (dock.fails >= 2) this.abortDock(true);
        return;
      }
    } catch {
      dock.fails += 1;
      if (dock.fails >= 2) this.abortDock(true);
      return;
    }
    dock.waiting = terminal;
    dock.waitingStep = step;
    dock.waitUntil = Date.now() + 3000;
    dock.index += 1;
  }

  finishDock(cx) {
    const dock = this.dock;
    if (!dock) return;
    const docked = readMap(DOCKED_KEY);
    docked[dock.parent] = dock.tab;
    writeMap(DOCKED_KEY, docked);
    const spacer = dock.spacerPane;
    const focus = dock.focus;
    this.dock = null;
    if (spacer && panes().some((pane) => pane.pane === spacer)) run("pane.close", { pane: spacer });
    if (focus?.pane && panes().some((pane) => pane.pane === focus.pane)) run("pane.focus", { pane: focus.pane });
    cx.notify();
  }

  abortDock(dismiss) {
    const dock = this.dock;
    this.dock = null;
    if (!dock) return;
    if (dismiss) {
      const off = readMap(DOCK_OFF_KEY);
      off[dock.parent] = Date.now();
      writeMap(DOCK_OFF_KEY, off);
    }
    const focus = dock.focus;
    if (focus?.pane && panes().some((pane) => pane.pane === focus.pane)) run("pane.focus", { pane: focus.pane });
  }
```

在 `this.dock = null;` 初始化对象里补 `startedAt: Date.now()`。

**Step 4: 设置面板**

`settings(t)` 的 `.children(PREFERENCE_TOGGLES.map(...))` 后追加列数行：

```js
      .child(
        h_flex()
          .id("multi-repo-dock-columns")
          .h(36)
          .px(6)
          .gap(8)
          .rounded(6)
          .items_center()
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(1)
              .child(div().text_size(12).text_color(t.foreground).child("每个 tab 的 pane 列数"))
              .child(div().text_size(10).text_color(t.dim).child("自动停靠时使用的网格列数")),
          )
          .child(this.stepButton("multi-repo-dock-columns-minus", "−", () => this.setDockColumns(prefs.dockColumns - 1)))
          .child(div().w(18).text_center().text_size(12).text_color(t.foreground).child(String(prefs.dockColumns)))
          .child(this.stepButton("multi-repo-dock-columns-plus", "+", () => this.setDockColumns(prefs.dockColumns + 1))),
      )
```

`settings` 前加方法（`stepButton` 可放在 `settings` 之后）：

```js
  setDockColumns(value) {
    const prefs = this.preferences();
    setShared(PREFERENCES_KEY, { ...prefs, dockColumns: clampDockColumns(value) });
  }

  stepButton(id, label, onClick) {
    const t = theme();
    return div()
      .id(id)
      .size(18)
      .flex_none()
      .rounded(4)
      .border(1)
      .border_color(t.border)
      .flex()
      .items_center()
      .justify_center()
      .text_size(11)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((style) => style.bg(t.hover).text_color(t.foreground))
      .on_click(onClick)
      .child(label);
  }
```

`preferences.js` 的 import 追加 `clampDockColumns`。设置 overlay 高度从 196 改为 268。

**Step 5: 验证**

Run: `node --test tests/*.test.mjs && herdr-app check mods/multi-repo-sidebar`
Expected: 单测全绿，`check passed: mods/multi-repo-sidebar`。

**Step 6: 提交**

```bash
git add herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/main.js
git commit -m "feat(herdr): auto-dock child agents into a grid tab"
```

---

## Task 4: 文档、版本与真实链路验证

**Files:**
- Modify: `herdr-mods/multi-repo-sidebar/mods/multi-repo-sidebar/mod.json`
- Modify: `herdr-mods/multi-repo-sidebar/README.md`
- Modify: `herdr-mods/multi-repo-sidebar/RECIPE.md`

**Step 1: 版本与文档**

- `mod.json` 的 `version` 改为 `0.4.0`。
- README「功能」补一条：无 pane 的子 agent 会在同 space 新建 `子代理 · <父名>` tab，按设置面板的列数排成网格；关闭该 tab 后不再重建。
- RECIPE 增加一节「Auto docking」：`tab.new → pane.focus → terminal.keep → pane.close(spacer)`，记录键 `multi-repo.docked` / `multi-repo.dockOff`，以及轮询间隔。

**Step 2: 安装到本机并检查**

Run: `./sync.sh && herdr-app status`
Expected: 安装成功，`errors: []`。

**Step 3: 真实链路验证**

```bash
hc run --bg "sleep 120"
hc run --bg "sleep 120"
sleep 4
herdr-app ls | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d.get('spaces',[]):
  for t in s.get('tabs',[]):
    if (t.get('name') or '').startswith('子代理'):
      print(t.get('name'), t.get('id'), 'panes-ish:', len(t.get('terminals',[])))
"
```

Expected: 出现一个 `子代理 · ...` tab，含 2 个 pane（默认 2 列），且父 agent 的 tab 未变。

再验证关掉后不重建：`herdr-app do tab.close '{"id":"<自动 tab id>"}'`，再 `hc run --bg "sleep 120"`，等 3 秒，确认没有新 tab。

**Step 4: 清理测试终端**

`hc kill <address>` 逐个清理 sleep 终端。

**Step 5: 提交并推送**

```bash
git add -A
git commit -m "docs(herdr): document child-agent auto docking"
git push -u origin feat/multi-repo-sidebar-auto-dock
```

---

## 验收标准

- `node --test tests/*.test.mjs` 全绿。
- `herdr-app check mods/multi-repo-sidebar` 通过，`herdr-app status` 为 `errors: []`。
- 连续创建 2–5 个 hc 子 agent 后，自动出现一个 `子代理 · <父名>` tab，pane 数量与子 agent 一致，默认 2 列。
- 手动关闭自动 tab 后，同一父 agent 再创建子 agent 不会重建。
- 关闭 `自动停靠子 agent` 开关后不再新建 tab。
