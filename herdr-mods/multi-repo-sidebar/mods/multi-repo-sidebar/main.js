import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import {
  agents,
  checking,
  closeOverlay,
  exec,
  focused,
  home,
  layout,
  openOverlay,
  panes,
  props,
  run,
  setAgentOrder,
  setShared,
  shared,
  spaces,
  terminals,
  theme,
  watchFolder,
  window,
} from "herdr";
import { baseName, buildRequirements, displayName, normalizeId } from "./lib/model.js";
import {
  DOCK_OFF_KEY,
  DOCK_SEQ_KEY,
  DOCKED_KEY,
  dockGroups,
  gridPlan,
  groupName,
  nextGroupSequence,
  reconcileDocks,
} from "./lib/docking.js";
import {
  cacheKey,
  dueRequests,
  nextBatch,
  parseGitStatus,
  parseRepoRoot,
  uniqueRequests,
} from "./lib/branches.js";
import {
  PREFERENCES_KEY,
  PREFERENCE_TOGGLES,
  clampDockColumns,
  normalizePreferences,
  togglePreference as flipPreference,
} from "./lib/preferences.js";
import { Avatar, BranchStatus, CountPill, Icon, IconButton, ProgramIcon, Rail, Status, ToggleRow } from "./lib/ui.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function readSet(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function writeSet(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

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

export default class RequirementsSidebar extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    this.model = null;
    this.focusedTerminal = null;
    this.branches = {};
    this.branchQueue = [];
    this.branchBusy = false;
    this.watchers = new Map();
    this.collapsed = readSet("multi-repo.collapsed");
    this.pressed = null;
    this.over = null;
    this.dock = null;
    this.dockBase = null;
    this.dockCooldown = 0;
    this.panel = props()?.panel === "settings" ? "settings" : "sidebar";
    if (!checking() && this.panel === "sidebar") {
      cx.timer.after(500, (cx) => this.refreshBranches(cx));
      cx.timer.every(1500, (cx) => this.refreshBranches(cx));
      cx.timer.every(1000, (cx) => this.dockTick(cx));
    }
  }

  preferences() {
    return normalizePreferences(shared(PREFERENCES_KEY));
  }

  togglePreference(key) {
    setShared(PREFERENCES_KEY, flipPreference(shared(PREFERENCES_KEY), key));
  }

  openSettings() {
    openOverlay({
      mod: "multi-repo-sidebar",
      kind: "popup",
      width: 280,
      height: 320,
      props: { panel: "settings" },
    });
  }

  closeSettings() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  selectSpace(space) {
    run("space.select", { id: space.id });
  }

  selectRequirement(requirement, cx) {
    if (!requirement.active) {
      this.selectSpace(requirement.space);
      if (this.collapsed.has(requirement.id)) this.toggleCollapsed(requirement.id, cx);
      return;
    }
    this.toggleCollapsed(requirement.id, cx);
  }

  openSpaceMenu(space) {
    openOverlay({
      mod: "menu",
      kind: "popup",
      width: 200,
      height: 260,
      props: { tab: "space", target: { id: space.id } },
    });
  }

  focusAgent(node) {
    if (node.pane) run("pane.focus", { pane: node.pane });
    else run("terminal.peek", { terminal: node.address });
  }

  toggleSidebar() {
    const width = find(layout(), "sidebar")?.size?.px;
    if (narrow()) {
      run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 280 });
      return;
    }
    if (width) setShared("sidebar.width", width);
    run("layout.resize", { id: "sidebar", px: window()?.platform === "macos" ? 76 : 44 });
  }

  toggleCollapsed(id, cx) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    writeSet("multi-repo.collapsed", this.collapsed);
    cx.notify();
  }

  branchLine(info, t, indent, prefs) {
    if (!prefs.showBranch) return null;
    if (!info?.branch && !info?.dirty && !info?.ahead && !info?.behind) return null;
    return h_flex()
      .pl(indent)
      .pr(8)
      .h(20)
      .gap(5)
      .items_center()
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(10.5)
          .text_color(t.dim)
          .child(info.branch || "(no branch)"),
      );
  }

  repoInfo(cwd, machine = null) {
    if (!cwd) return null;
    const entry = this.branches[cacheKey(machine, cwd)];
    if (!entry?.repoRoot) return null;
    return {
      key: `${machine ?? ""}|${entry.repoRoot}`,
      name: baseName(entry.repoRoot),
      branch: entry.branch || null,
      upstream: entry.upstream || null,
      ahead: entry.ahead ?? 0,
      behind: entry.behind ?? 0,
      staged: Boolean(entry.staged),
      unstaged: Boolean(entry.unstaged),
      stagedCount: entry.stagedCount ?? 0,
      unstagedCount: entry.unstagedCount ?? 0,
      untrackedCount: entry.untrackedCount ?? 0,
      conflictedCount: entry.conflictedCount ?? 0,
      dirty: Boolean(entry.dirty),
    };
  }

  async readBranch(request, cx) {
    const key = cacheKey(request.machine, request.cwd);
    const previous = this.branches[key];
    try {
      const [root, status] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
          cwd: request.cwd,
          on: request.machine,
        }),
        exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=normal"], {
          cwd: request.cwd,
          on: request.machine,
        }),
      ]);
      const repoRoot = parseRepoRoot(root);
      const parsed = parseGitStatus(status);
      if (!parsed) {
        this.branches[key] = { ...(previous ?? {}), checkedAt: Date.now(), error: true };
        return false;
      }
      const next = {
        repoRoot,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        staged: parsed.staged,
        unstaged: parsed.unstaged,
        stagedCount: parsed.stagedCount,
        unstagedCount: parsed.unstagedCount,
        untrackedCount: parsed.untrackedCount,
        conflictedCount: parsed.conflictedCount,
        dirty: parsed.dirty,
        checkedAt: Date.now(),
        error: false,
      };
      const changed =
        !previous ||
        ["repoRoot", "branch", "upstream", "ahead", "behind", "staged", "unstaged", "stagedCount", "unstagedCount", "untrackedCount", "conflictedCount", "dirty"].some(
          (field) => previous[field] !== next[field],
        );
      this.branches[key] = next;
      if (!request.machine && repoRoot) this.watchRepo(repoRoot, cx);
      return changed;
    } catch {
      this.branches[key] = { ...(previous ?? {}), checkedAt: Date.now(), error: true };
      return false;
    }
  }

  watchRepo(repoRoot, cx) {
    if (!repoRoot || this.watchers.has(repoRoot) || this.watchers.size >= 64) return;
    let pending;
    try {
      pending = watchFolder(repoRoot);
    } catch {
      return;
    }
    this.watchers.set(repoRoot, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watchers.get(repoRoot) !== current) return;
          for (const [key, entry] of Object.entries(this.branches)) {
            if (entry.repoRoot === repoRoot) this.branches[key] = { ...entry, checkedAt: 0 };
          }
          this.refreshBranches(cx);
          current = watchFolder(repoRoot);
          this.watchers.set(repoRoot, current);
        }
      } catch {}
      if (this.watchers.get(repoRoot) === current) this.watchers.delete(repoRoot);
    });
  }

  refreshBranches(cx) {
    if (checking() || !this.model) return;
    const requests = [];
    for (const requirement of this.model.requirements) {
      const machine = requirement.space.machine ?? null;
      if (requirement.folder) requests.push({ machine, cwd: requirement.folder });
      for (const root of requirement.roots) {
        for (const repo of root.repos) if (repo.cwd) requests.push({ machine, cwd: repo.cwd });
      }
    }
    const due = dueRequests(requests, this.branches, Date.now());
    if (!due.length) return;
    this.branchQueue = uniqueRequests([...this.branchQueue, ...due]);
    if (this.branchBusy) return;
    this.branchBusy = true;
    cx.spawn(async (cx) => {
      let changed = false;
      try {
        while (this.branchQueue.length) {
          const batch = nextBatch(this.branchQueue, 6);
          const results = await Promise.all(batch.map((request) => this.readBranch(request, cx)));
          if (results.some(Boolean)) changed = true;
        }
      } finally {
        this.branchBusy = false;
        if (changed) cx.notify();
      }
    });
  }

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

    // Children that existed before the mod started are not moved.
    if (!this.dockBase) {
      this.dockBase = new Set(groups.flatMap((group) => group.children));
      return;
    }

    const records = reconcileDocks(
      { spaces: currentSpaces, terminals: currentTerminals, docked, off },
      groups,
    );
    if (JSON.stringify(records.docked) !== JSON.stringify(docked)) writeMap(DOCKED_KEY, records.docked);
    if (JSON.stringify(records.off) !== JSON.stringify(off)) writeMap(DOCK_OFF_KEY, records.off);

    if (Date.now() - this.dockCooldown < 3000) return;
    for (const group of groups) {
      const children = group.children.filter((address) => !this.dockBase.has(address));
      if (!children.length) continue;
      this.startDock({ ...group, tab: records.docked[group.parent] ?? null, children });
      return;
    }
  }

  startDock(group) {
    const tabId = group.tab ? normalizeId(group.tab) : null;
    if (tabId) {
      const inTab = panes().filter((pane) => normalizeId(pane.tab) === tabId);
      const anchor = inTab[inTab.length - 1]?.pane ?? null;
      if (!anchor) return;
      this.dock = {
        mode: "append",
        parent: group.parent,
        tab: tabId,
        anchor,
        children: group.children,
        index: 0,
        waiting: null,
        waitUntil: 0,
        fails: 0,
        startedAt: Date.now(),
        focus: focused(),
      };
      return;
    }

    const space = spaces().find((candidate) => normalizeId(candidate.id) === normalizeId(group.space));
    const sequence = nextGroupSequence(space?.tabs ?? [], readMap(DOCK_SEQ_KEY)[group.space]);
    const seqs = readMap(DOCK_SEQ_KEY);
    seqs[group.space] = sequence;
    writeMap(DOCK_SEQ_KEY, seqs);
    const name = groupName(sequence);
    const before = new Set((space?.tabs ?? []).map((tab) => normalizeId(tab.id)));
    this.dock = {
      mode: "create",
      parent: group.parent,
      space: group.space,
      name,
      before,
      tab: null,
      spacer: null,
      spacerPane: null,
      children: group.children,
      plan: gridPlan(group.children.length, this.preferences().dockColumns),
      index: 0,
      slots: {},
      waiting: null,
      waitingStep: null,
      waitUntil: 0,
      fails: 0,
      startedAt: Date.now(),
      focus: focused(),
    };
    run("tab.new", { name, space: group.space, focus: false });
  }

  stepDock(cx) {
    const dock = this.dock;
    if (!dock) return;
    const currentPanes = panes();
    const paneOf = (terminal) =>
      currentPanes.find(
        (pane) =>
          normalizeId(pane.terminal) === normalizeId(terminal) &&
          (dock.mode !== "append" || normalizeId(pane.tab) === dock.tab),
      )?.pane ?? null;

    if (dock.mode === "create" && !dock.tab) {
      const space = spaces().find((candidate) => normalizeId(candidate.id) === normalizeId(dock.space));
      const fresh = (space?.tabs ?? []).filter((tab) => !dock.before.has(normalizeId(tab.id)));
      const found = fresh.find((tab) => tab.name === dock.name) ?? (fresh.length === 1 ? fresh[0] : null);
      if (!found) {
        if (Date.now() - dock.startedAt > 5000) this.abortDock(false);
        return;
      }
      dock.tab = normalizeId(found.id);
      const tabPanes = currentPanes.filter((pane) => normalizeId(pane.tab) === dock.tab);
      dock.spacerPane = tabPanes[0]?.pane ?? null;
      dock.spacer = tabPanes[0]?.terminal ?? null;
      dock.startedAt = Date.now();
      if (!dock.spacerPane) return;
    }

    if (dock.waiting) {
      const pane = paneOf(dock.waiting);
      if (pane) {
        if (dock.mode === "append") dock.anchor = pane;
        else dock.slots[slotKey(dock.waitingStep)] = pane;
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

    if (dock.mode === "append") {
      if (dock.index >= dock.children.length) {
        this.finishDock(cx);
        return;
      }
      const terminal = dock.children[dock.index];
      if (!terminal) {
        dock.index += 1;
        return;
      }
      const landed = paneOf(terminal);
      if (landed) {
        dock.anchor = landed;
        dock.index += 1;
        return;
      }
      if (focused()?.pane !== dock.anchor) run("pane.focus", { pane: dock.anchor });
      run("terminal.keep", { terminal, place: "down" });
      dock.waiting = terminal;
      dock.waitUntil = Date.now() + 3000;
      dock.index += 1;
      return;
    }

    if (!dock.spacerPane) return;
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

    if (focused()?.pane !== anchor) run("pane.focus", { pane: anchor });
    run("terminal.keep", { terminal, place: step.direction });
    dock.waiting = terminal;
    dock.waitingStep = step;
    dock.waitUntil = Date.now() + 3000;
    dock.index += 1;
  }

  finishDock(cx) {
    const dock = this.dock;
    if (!dock) return;
    if (dock.mode === "create") {
      const docked = readMap(DOCKED_KEY);
      docked[dock.parent] = dock.tab;
      writeMap(DOCKED_KEY, docked);
      if (dock.spacerPane) run("pane.close", { pane: dock.spacerPane });
    }
    const focus = dock.focus;
    this.dock = null;
    this.dockCooldown = Date.now();
    this.markDocked(dock.children);
    if (focus?.pane && panes().some((pane) => pane.pane === focus.pane)) run("pane.focus", { pane: focus.pane });
    cx.notify();
  }

  abortDock(dismiss) {
    const dock = this.dock;
    this.dock = null;
    if (!dock) return;
    this.dockCooldown = Date.now();
    this.markDocked(dock.children);
    if (dismiss) {
      const off = readMap(DOCK_OFF_KEY);
      off[dock.parent] = Date.now();
      writeMap(DOCK_OFF_KEY, off);
    }
    const focus = dock.focus;
    if (focus?.pane && panes().some((pane) => pane.pane === focus.pane)) run("pane.focus", { pane: focus.pane });
  }

  markDocked(addresses) {
    this.dockBase = this.dockBase ?? new Set();
    for (const address of addresses) this.dockBase.add(address);
  }

  render(_cx) {
    const t = theme();
    if (this.panel === "settings") return this.settings(t);
    this.prefs = this.preferences();
    const model = buildRequirements({
      spaces: spaces(),
      agents: agents(),
      terminals: terminals(),
      panes: panes(),
      resolveRepo: (cwd, space) => this.repoInfo(cwd, space?.machine ?? null),
      homeFolder: home(),
    });
    this.model = model;
    const focus = focused();
    this.focusedTerminal = focus?.terminal ?? focus?.agent ?? null;
    setAgentOrder(model.order);
    if (narrow()) return this.rail(t, model);
    return this.full(t, model);
  }

  settings(t) {
    const prefs = this.preferences();
    return v_flex()
      .id("multi-repo-settings")
      .size_full()
      .p(6)
      .gap(2)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(28)
          .px(4)
          .items_center()
          .justify_between()
          .child(div().text_size(12).font_medium().child("侧边栏显示"))
          .child(
            div()
              .id("multi-repo-settings-close")
              .size(20)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .rounded(4)
              .text_size(13)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((style) => style.bg(t.hover).text_color(t.foreground))
              .on_click(() => this.closeSettings())
              .child("×"),
          ),
      )
      .children(
        PREFERENCE_TOGGLES.map(({ key, label, description }) =>
          ToggleRow({
            id: `multi-repo-pref-${key}`,
            label,
            description,
            value: prefs[key],
            onClick: () => this.togglePreference(key),
          }),
        ),
      )
      .child(
        h_flex()
          .id("multi-repo-dock-columns")
          .min_h(36)
          .py(4)
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
      .child(
        h_flex()
          .id("multi-repo-open-layout-settings")
          .h(30)
          .px(4)
          .gap(6)
          .rounded(6)
          .items_center()
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click(() => {
            this.closeSettings();
            run("app.settings", { section: "look" });
          })
          .child(Icon("folder", 12).text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child("在 Herdr 设置中切换布局"))
          .child(div().text_size(11).text_color(t.dim).child("›")),
      )
      .child(div().px(4).pt(2).text_size(10).text_color(t.dim).child("设置保存在 shared.json"));
  }

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

  full(t, model) {
    const activeIndex = model.requirements.findIndex((requirement) => requirement.active);
    const active = model.requirements[activeIndex]?.id;
    if (active && active !== this.revealed) {
      this.revealed = active;
      if (activeIndex >= 0) this.scroll.scroll_to_item(activeIndex);
    }
    return v_flex()
      .id("multi-repo-sidebar")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(
        h_flex()
          .h(40)
          .flex_none()
          .px(14)
          .pb(4)
          .items_center()
          .justify_between()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().text_size(11.5).font_medium().text_color(t.dim).child("需求"))
              .child(CountPill(model.requirements.length)),
          )
          .child(
            h_flex()
              .gap(2)
              .items_center()
              .child(
                IconButton({
                  id: "requirements-settings",
                  icon: "settings",
                  label: "Sidebar settings",
                  onClick: () => this.openSettings(),
                }),
              )
              .child(
                IconButton({
                  id: "requirements-new-space",
                  icon: "plus",
                  label: "New requirement space",
                  onClick: () => run("space.new"),
                }),
              ),
          ),
      )
      .child(
        v_flex()
          .id("requirements-list")
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(10)
          .overflow_y_scrollbar()
          .mode("always")
          .track_scroll(this.scroll)
          .children(model.requirements.map((requirement) => this.requirement(requirement, t))),
      );
  }

  requirement(requirement, t) {
    const collapsed = this.collapsed.has(requirement.id);
    const prefs = this.prefs ?? normalizePreferences();
    const workspaceBranch = this.branchLine(requirement.workspace, t, 8, prefs);
    const index = (this.model?.requirements ?? []).findIndex((candidate) => candidate.id === requirement.id);
    const fromIndex = this.pressed === null
      ? -1
      : (this.model?.requirements ?? []).findIndex((candidate) => candidate.id === this.pressed);
    return v_flex()
      .id(`requirement-${requirement.id}`)
      .flex_none()
      .pb(3)
      .child(
        h_flex()
          .id(`requirement-row-${requirement.id}`)
          .relative()
          .h(28)
          .px(8)
          .gap(7)
          .rounded(7)
          .items_center()
          .cursor_pointer()
          .when(requirement.active, (el) => el.bg(t.selected))
          .when(!requirement.active, (el) => el.hover((style) => style.bg(t.hover)))
          .when(this.pressed === requirement.id && this.over !== requirement.id, (el) => el.opacity(0.5))
          .when(this.pressed !== null && this.over === requirement.id && this.pressed !== requirement.id, (el) =>
            el.child(
              div()
                .absolute()
                .left(0)
                .right(0)
                .h(2)
                .bg(t.accent)
                .when(fromIndex < index, (line) => line.bottom(0))
                .when(fromIndex > index, (line) => line.top(0)),
            ),
          )
          .on_mouse_down("left", () => {
            this.pressed = requirement.id;
            this.over = requirement.id;
          })
          .on_mouse_move((_event, cx) => {
            const source = spaces().find((space) => space.id === this.pressed);
            const over =
              source && (source.machine ?? null) === (requirement.space.machine ?? null) ? requirement.id : null;
            if (this.pressed !== null && this.over !== over) {
              this.over = over;
              cx.notify();
            }
          })
          .on_mouse_up("left", (_event, cx) => {
            const from = this.pressed;
            const over = this.over;
            this.pressed = null;
            this.over = null;
            if (from !== null && over === requirement.id && from !== requirement.id) {
              const target = spaces().findIndex((space) => space.id === requirement.id);
              if (target !== -1) run("space.move", { id: from, index: target + 1 });
            } else if (from === requirement.id) {
              this.selectRequirement(requirement, cx);
            }
            cx.notify();
          })
          .on_mouse_down("right", () => this.openSpaceMenu(requirement.space))
          .tooltip(
            `${requirement.terminalCount} terminals · drag to reorder · ${
              requirement.active ? (collapsed ? "click again to expand" : "click again to collapse") : "click to select"
            }`,
          )
          .child(Avatar(requirement.space, 18))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(requirement.name))
          .when(requirement.terminalCount > 0, (el) => el.child(CountPill(requirement.terminalCount))),
      )
      .when(!collapsed, (el) =>
        el
          .child(
            h_flex()
              .id(`workspace-${requirement.id}`)
              .h(23)
              .pl(8)
              .pr(8)
              .gap(5)
              .items_center()
              .cursor_pointer()
              .hover((style) => style.bg(t.hover))
              .on_click(() => this.selectSpace(requirement.space))
              .tooltip(`${requirement.workspace.name}${requirement.workspace.branch ? ` · ${requirement.workspace.branch}` : ""}`)
              .child(Icon("folder", 12).text_color(t.muted))
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .text_size(11.5)
                  .text_color(t.muted)
                  .child(requirement.workspace.name),
              )
              .when(prefs.showStatus, (el) => el.child(BranchStatus(t, requirement.workspace))),
          )
          .when(Boolean(workspaceBranch), (branch) => branch.child(workspaceBranch))
          .child(this.roots(requirement, t)),
      );
  }

  roots(requirement, t) {
    if (!requirement.roots.length)
      return div().pl(26).pb(4).text_size(11).text_color(t.dim).child("No live terminals");
    const rows = [];
    const tabCounts = new Map();
    for (const root of requirement.roots) tabCounts.set(root.node.tab, (tabCounts.get(root.node.tab) ?? 0) + 1);
    requirement.roots.forEach((root) => {
      const useTab = root.node.tabNamed && tabCounts.get(root.node.tab) === 1;
      rows.push(this.terminalRow(root.node, t, useTab, 12));
      root.repos.forEach((repo) => {
        rows.push(this.repoRow(repo, t, 24));
        this.agentTree(repo.agents, [], t, rows, 24);
      });
    });
    return v_flex().pb(4).children(rows);
  }

  agentTree(nodes, lead, t, rows, indent) {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      rows.push(this.terminalRow(node, t, false, indent, [...lead, last ? "└" : "├"]));
      this.agentTree(node.children, [...lead, last ? " " : "│"], t, rows, indent);
    });
  }

  terminalRow(node, t, useTab = false, indent = 0, lines = []) {
    const icon = ProgramIcon(node.program, 14);
    const active = node.address === this.focusedTerminal;
    const title = useTab && node.tabName ? node.tabName : displayName(node);
    return h_flex()
      .id(`terminal-${node.key}`)
      .h(26)
      .pl(6 + indent)
      .pr(6)
      .gap(6)
      .rounded(6)
      .items_center()
      .cursor_pointer()
      .when(active, (el) => el.bg(t.selected))
      .hover((style) => style.bg(t.hover))
      .on_click(() => this.focusAgent(node))
      .tooltip(
        `${displayName(node)}${node.cwd ? ` · ${node.cwd}` : ""}${node.report ? ` · ${node.report}` : ""}`,
      )
      .children(lines.map((line) => Rail(line)))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
      .when(Boolean(node.status), (el) => el.child(Status(t, node.status)));
  }

  repoRow(repo, t, indent) {
    const first = repo.agents[0];
    const prefs = this.prefs ?? normalizePreferences();
    const branch = this.branchLine(repo, t, 6 + indent, prefs);
    return v_flex()
      .child(
        h_flex()
          .id(`repo-${repo.key}`)
          .h(24)
          .pl(6 + indent)
          .pr(6)
          .gap(6)
          .rounded(6)
          .items_center()
          .cursor_pointer()
          .hover((style) => style.bg(t.hover))
          .on_click(() => first && this.focusAgent(first))
          .tooltip(
            `${repo.name}${repo.branch ? ` · ${repo.branch}` : ""}${repo.ahead ? ` · ⇡${repo.ahead}` : ""}${
              repo.behind ? ` · ⇣${repo.behind}` : ""
            }`,
          )
          .child(Icon("branch", 12).text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(repo.name))
          .when(prefs.showStatus, (el) => el.child(BranchStatus(t, repo)))
          .when(repo.agents.length > 1, (el) => el.child(CountPill(repo.agents.length))),
      )
      .when(Boolean(branch), (el) => el.child(branch));
  }

  rail(t, model) {
    return v_flex()
      .id("requirements-rail")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .items_center()
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .pt(6)
          .gap(4)
          .items_center()
          .overflow_y_scrollbar()
          .mode("always")
          .children(
            model.requirements.map((requirement) =>
              h_flex()
                .id(`rail-${requirement.id}`)
                .w(32)
                .h(28)
                .flex_none()
                .justify_center()
                .items_center()
                .rounded(6)
                .when(requirement.active, (el) => el.bg(t.selected))
                .hover((style) => style.bg(t.hover))
                .on_click(() => this.selectSpace(requirement.space))
                .tooltip(`${requirement.name} · ${requirement.terminalCount} terminals`)
                .child(Avatar(requirement.space, 18)),
            ),
          ),
      )
      .child(
        h_flex()
          .h(28)
          .flex_none()
          .items_center()
          .justify_center()
          .child(
            div()
              .id("requirements-expand")
              .text_size(13)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((style) => style.text_color(t.foreground))
              .on_click(() => this.toggleSidebar())
              .child("»"),
          ),
      );
  }
}
