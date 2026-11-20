import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import {
  agents,
  checking,
  exec,
  focused,
  home,
  layout,
  openOverlay,
  panes,
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
import { baseName, buildRequirements, displayName } from "./lib/model.js";
import {
  cacheKey,
  dueRequests,
  nextBatch,
  parseBranch,
  parseRepoRoot,
  uniqueRequests,
} from "./lib/branches.js";
import { Avatar, CountPill, Icon, IconButton, ProgramIcon, Rail, Status } from "./lib/ui.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

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
    if (!checking()) {
      cx.timer.after(500, (cx) => this.refreshBranches(cx));
      cx.timer.every(1500, (cx) => this.refreshBranches(cx));
    }
  }

  selectSpace(space) {
    run("space.select", { id: space.id });
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
    else run("agent.focus", { terminal: node.address });
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

  repoInfo(cwd, machine = null) {
    if (!cwd) return null;
    const entry = this.branches[cacheKey(machine, cwd)];
    if (!entry?.repoRoot) return null;
    return {
      key: `${machine ?? ""}|${entry.repoRoot}`,
      name: baseName(entry.repoRoot),
      branch: entry.branch || null,
    };
  }

  async readBranch(request, cx) {
    const key = cacheKey(request.machine, request.cwd);
    const previous = this.branches[key];
    try {
      const [root, head] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
          cwd: request.cwd,
          on: request.machine,
        }),
        exec("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
          cwd: request.cwd,
          on: request.machine,
        }),
      ]);
      const repoRoot = parseRepoRoot(root);
      this.branches[key] = {
        repoRoot,
        branch: parseBranch(head) ?? (head.code === 0 ? "(detached)" : null),
        checkedAt: Date.now(),
        error: false,
      };
      if (!request.machine && repoRoot) this.watchRepo(repoRoot, cx);
    } catch {
      this.branches[key] = { ...(previous ?? {}), checkedAt: Date.now(), error: true };
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
      try {
        while (this.branchQueue.length) {
          const batch = nextBatch(this.branchQueue, 6);
          await Promise.all(batch.map((request) => this.readBranch(request, cx)));
        }
      } finally {
        this.branchBusy = false;
        cx.notify();
      }
    });
  }

  render(_cx) {
    const t = theme();
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
            IconButton({
              id: "requirements-new-space",
              icon: "plus",
              label: "New requirement space",
              onClick: () => run("space.new"),
            }),
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
    return v_flex()
      .id(`requirement-${requirement.id}`)
      .flex_none()
      .pb(3)
      .child(
        h_flex()
          .id(`requirement-row-${requirement.id}`)
          .h(28)
          .px(8)
          .gap(7)
          .rounded(7)
          .items_center()
          .cursor_pointer()
          .when(requirement.active, (el) => el.bg(t.selected))
          .when(!requirement.active, (el) => el.hover((style) => style.bg(t.hover)))
          .on_click(() => this.selectSpace(requirement.space))
          .on_mouse_down("right", () => this.openSpaceMenu(requirement.space))
          .tooltip(`${requirement.terminalCount} terminals`)
          .child(Avatar(requirement.space, 18))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(requirement.name))
          .when(requirement.terminalCount > 0, (el) => el.child(CountPill(requirement.terminalCount))),
      )
      .child(
        h_flex()
          .id(`workspace-${requirement.id}`)
          .h(24)
          .pl(26)
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
          .when(Boolean(requirement.workspace.branch), (el) =>
            el.child(
              div()
                .flex_none()
                .max_w(110)
                .truncate()
                .text_size(10.5)
                .text_color(t.dim)
                .child(requirement.workspace.branch),
            ),
          ),
      )
      .child(this.roots(requirement, t));
  }

  roots(requirement, t) {
    if (!requirement.roots.length)
      return div().pl(26).pb(4).text_size(11).text_color(t.dim).child("No live terminals");
    const rows = [];
    const tabCounts = new Map();
    for (const root of requirement.roots) tabCounts.set(root.node.tab, (tabCounts.get(root.node.tab) ?? 0) + 1);
    requirement.roots.forEach((root, rootIndex) => {
      const rootLast = rootIndex === requirement.roots.length - 1;
      const useTab = root.node.tabNamed && tabCounts.get(root.node.tab) === 1;
      rows.push(this.terminalRow(root.node, [rootLast ? "└" : "├"], t, useTab));
      const rootLead = [rootLast ? " " : "│"];
      root.repos.forEach((repo, repoIndex) => {
        const repoLast = repoIndex === root.repos.length - 1;
        rows.push(this.repoRow(repo, [...rootLead, repoLast ? "└" : "├"], t));
        this.agentTree(repo.agents, [...rootLead, repoLast ? " " : "│"], t, rows);
      });
    });
    return v_flex()
      .pl(9)
      .ml(9)
      .pb(4)
      .border_l(1)
      .border_color(t.border)
      .children(rows);
  }

  agentTree(nodes, lead, t, rows) {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      rows.push(this.terminalRow(node, [...lead, last ? "└" : "├"], t));
      this.agentTree(node.children, [...lead, last ? " " : "│"], t, rows);
    });
  }

  terminalRow(node, lines, t, useTab = false) {
    const icon = ProgramIcon(node.program, 14);
    const active = node.address === this.focusedTerminal;
    const title = useTab && node.tabName ? node.tabName : displayName(node);
    return h_flex()
      .id(`terminal-${node.key}`)
      .h(26)
      .px(6)
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
      .child(div().flex_1().min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(title))
      .when(Boolean(node.status), (el) => el.child(Status(t, node.status)));
  }

  repoRow(repo, lines, t) {
    const first = repo.agents[0];
    return h_flex()
      .id(`repo-${repo.key}`)
      .h(27)
      .px(6)
      .gap(6)
      .rounded(6)
      .items_center()
      .cursor_pointer()
      .hover((style) => style.bg(t.hover))
      .on_click(() => first && this.focusAgent(first))
      .tooltip(`${repo.name}${repo.branch ? ` · ${repo.branch}` : ""}`)
      .children(lines.map((line) => Rail(line)))
      .child(Icon("branch", 12).text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(repo.name))
      .when(repo.agents.length > 1, (el) => el.child(CountPill(repo.agents.length)))
      .when(Boolean(repo.branch), (el) =>
        el.child(
          div()
            .flex_none()
            .max_w(100)
            .truncate()
            .text_size(10.5)
            .text_color(t.dim)
            .child(repo.branch),
        ),
      );
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
