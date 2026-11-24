# Multi-Repo Sidebar

A Herdr sidebar mod for requirements that fan out across several repositories. Each space becomes a requirement, the workspace repository and its agents sit underneath it, and the repositories that the workspace agent spawned its sub-agents into are shown as dim labels above those agents. Powerlevel10k-style git state sits after each repository name; branch names stay on their own line, so long project names no longer hide them. A gear button opens a small display-settings panel. The share also installs a layout card named `Multi-Repo-Sidebar` under `Settings → Look → Layout`, which is the manual switch entry; it keeps Herdr's default thumbnail, and a mod-only install has no entry at all.

![Multi-Repo Sidebar](preview.png)

## What you see

The mod fills one sidebar block. The recommended width is 280px; the block needs `min: 90`, and below 160px it switches to a compact rail.

- **Header**, 40px tall: a 11.5px `dim` label `需求`, a 16px-tall count pill, and 26px gear and `+` buttons.
- **Requirement row**, 28px tall: an 18px colored avatar, the requirement name in `foreground`, a live-terminal count pill, and — when the row is the active space — the `selected` background. The avatar color is the stored `space.colors` value or a deterministic color from the name. Drag it up or down to reorder spaces; the drop edge shows a 2px `accent` line.
- **Workspace repository line**, 23px tall, flush left with the requirement name: a 12px folder icon in `muted`, the workspace repository name in `muted`, then git state on the right.
- **Workspace branch line**, 20px tall, left-aligned with the folder icon: 10.5px branch name in `dim`. Long branches get their own line instead of being truncated behind the repository name.
- **Top-level agent**, 26px tall, indented 12px, with no tree glyph. When the tab has one top-level agent and is named, the row uses the tab name; otherwise it uses the terminal title. It shows the program icon and agent status on the right.
- **Repository label**, 24px tall, indented 24px: a 12px branch icon and repository name both in `dim`, git state on the right, and a count pill when more than one direct agent lives in that repository.
- **Repository branch line**, 20px tall, left-aligned with the repository icon: branch name in `dim`.
- **Repository agents and sub-agents**, 26px tall: repository agents are indented 24px and use a 12px tree rail; deeper sub-agents keep the same rail style at 12px per level. Agent names use `foreground`, so agents read as the subject and repositories read as descriptions. Agent status is on the right.
- **Rail below 160px**: 32×28 requirement cells with the 18px avatar and a `»` control at the bottom.

All colors come from `theme()`: `chrome`, `border`, `foreground`, `muted`, `dim`, `selected`, `hover`, `working`, `accent`, `blocked`, `ansi1`, `ansi2`.

## How it behaves

Agent status, right side of terminal rows:

- `blocked`: 14px rounded badge with `!` on a `blocked` tint.
- `working`: 12px spinner, `900ms` rotation.
- `done`: 7px filled `done` dot.
- `idle`: 7px ring in `idle`/`dim`.
- Plain terminals with no agent status show nothing.

Git state, after the repository name:

- `!N` uncommitted changes, `working` color.
- `+N` staged changes, `accent` color.
- `?N` untracked files, `muted` color.
- `✘N` conflicts, `blocked` color.
- `⇡N` commits to push, `ansi2` color.
- `⇣N` commits to pull, `ansi1` color.
- Icon and number are separate 10.5px text nodes with `gap(2)`; status groups have `gap(7)`.

Clicks and keys:

- Requirement row drag: mouse down stores the space id, mouse move marks the row under the pointer when it is on the same machine, mouse up runs `run("space.move", { id: from, index: target + 1 })`; a 2px `accent` line marks the drop edge and the dragged row dims to 0.5 opacity.
- Requirement row, inactive: `run("space.select", { id })`.
- Requirement row, active: toggles collapse. Collapsed IDs persist in `localStorage` under `multi-repo.collapsed`.
- Header gear button: `openOverlay` with this same mod, `kind: "popup"`, `width: 280`, `height: 320`, `props: { panel: "settings" }`. The copy renders three checkbox rows and a column stepper instead of the sidebar; a click toggles `shared("multi-repo.preferences")` through `setShared`, and `×` or Esc closes it.
- Requirement row, right click: `openOverlay` with the `menu` mod, `props: { tab: "space", target: { id } }`.
- Workspace repository line: `run("space.select", { id })`.
- Repository label: focuses its first agent.
- Terminal with a pane: `run("pane.focus", { pane })`.
- Terminal with no pane (a child sub-agent): `run("terminal.peek", { terminal })`, which opens the peek window.
- Narrow rail avatar: selects the space. `»`: restores `sidebar.width` from `shared()` or calls `run("layout.resize", { id: "sidebar", px: 76/44 })`.

Right-click an agent row opens this mod's small popup (`props: { panel: "actions", terminal }`). Its item dock count comes from `dockableChildren(terminals(), panes(), address)`; clicking it writes `shared("multi-repo.dockRequest")` and closes the popup. The sidebar instance picks the request up on its next tick, clears it, drops any `dockOff` entry for that parent, and runs the same `startDock` state machine (create or append).

Auto docking runs on a 1000ms tick while `autoDock` is on:

- The first tick records every live child terminal without a pane as a baseline and moves nothing.
- New children are grouped by their direct parent; the parent space comes from `labels["herdr.space"]` or the parent chain.
- A new tab is named `子代理组-N`, where N is one past the highest existing `子代理组-N` in that space and is stored per space under `multi-repo.dockSeq`.
- A new tab is created with `run("tab.new", { name, space, focus: false })`. Because `run()` returns `null`, the next tick finds it by comparing the space's tab ids with the snapshot taken before the call.
- Children are placed with `pane.focus` + `run("terminal.keep", { terminal, place })` following `gridPlan`: stack the first column downwards, then split each row to the right. The tab's initial shell pane is the spacer and is closed at the end.
- Later batches for the same parent reuse the recorded tab and append downwards from its last pane.
- A tab the person closes is recorded under `multi-repo.dockOff`; its parent is not docked again for 24 hours or until the parent exits.

Branch data loads after 500ms, then a 1500ms tick checks the 15s TTL. Up to six git reads run at once. Local repository roots are watched with `watchFolder`; a change only marks the cache stale, so the last branch/status stays visible while the next read runs. The view only redraws when a visible branch or status value actually changes.

## Built from

```text
layouts/Multi-Repo-Sidebar.json
mods/multi-repo-sidebar/
  mod.json
  main.js
  lib/model.js
  lib/branches.js
  lib/preferences.js
  lib/ui.js
  icons/{branch,chevron-down,chevron-right,folder,plus,settings,spinner}.svg
  THIRD_PARTY.md
```

`mod.json`:

```json
{ "version": "0.3.0", "place": "none", "title": "Multi-Repo Sidebar" }
```

## Install

Copy both parts: the mod draws the sidebar, the layout gives Herdr Settings an entry.

```sh
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app/mods" "$app/layouts"
rm -rf "$app/mods/multi-repo-sidebar"
cp -R mods/multi-repo-sidebar "$app/mods/multi-repo-sidebar"
cp "layouts/Multi-Repo-Sidebar.json" "$app/layouts/Multi-Repo-Sidebar.json"
herdr-app check "$app/mods/multi-repo-sidebar"
```

Then switch with `Settings → Look → Layout → Multi-Repo-Sidebar` or:

```sh
herdr-app do layout.switch '{"name":"Multi-Repo-Sidebar"}'
```

A mod-only install leaves Settings unchanged; the layout file is the manual entry point.

Add the mod to any layout:

```json
{
  "id": "requirements",
  "type": "block",
  "size": { "weight": 1 },
  "min": 90,
  "content": { "mod": "multi-repo-sidebar" }
}
```

The share also ships `layouts/Multi-Repo-Sidebar.json`. Herdr Settings lists layouts, not mods: without that file there is no Settings entry. The card's label is the layout filename (`Multi-Repo-Sidebar`), and it deliberately has no `"preview"`, so Herdr draws its default thumbnail instead of a screenshot. The install script must copy the layout file and the mod folder; switching is `Settings → Look → Layout → Multi-Repo-Sidebar` or `run("layout.switch", { name: "Multi-Repo-Sidebar" })`.

Data path:

- `spaces()`, `agents()`, `terminals()`, `panes()`, `focused()`, `layout()` from `herdr`.
- All live terminals in a space enter one tree. A terminal without `herdr.space` inherits the space from its parent; if the parent is gone, the `where` label is a fallback.
- Workspace repository: the first live top-level terminal's `cwd` that is not `home()`, else `space.folder`. Repository name and branch come from git.
- Direct children of each top-level agent are grouped by their git root (`git rev-parse --path-absolute --show-toplevel`), not by the immediate `cwd`. Same root means one repository label. Deeper sub-agents stay under their parent.
- The workspace repository's branch status is read from its own `cwd`; each repository label reads its own first agent `cwd`.

Herdr API and commands used:

- Views: `View`, `div`, `v_flex`, `h_flex`, `ScrollHandle`.
- Read: `spaces`, `agents`, `terminals`, `panes`, `focused`, `layout`, `theme`, `home`, `window`, `shared`, `checking`.
- Actions: `run("space.select")`, `run("space.new")`, `run("pane.focus")`, `run("terminal.peek")`, `run("layout.resize")`, `openOverlay`, `closeOverlay`, `setAgentOrder`, `setShared`, `props`.
- Process/files: `exec("git", ...)` and `watchFolder(repoRoot)`.

Git reads, per repository `cwd`:

```sh
git rev-parse --path-format=absolute --show-toplevel
git --no-optional-locks status --porcelain=v2 --branch --untracked-files=normal
```

`lib/branches.js` parses porcelain v2: `# branch.head`, `# branch.upstream`, `# branch.ab`, `1`/`2` entries, `u` conflicts, `?` untracked. Cache key is `[machine ?? "", cwd]`; entries are `{ repoRoot, branch, upstream, ahead, behind, stagedCount, unstagedCount, untrackedCount, conflictedCount, checkedAt }`.

No `keys.json`: this mod defines no default shortcuts.

Display preferences live in `shared("multi-repo.preferences")`, `{ showBranch, showStatus }`, both defaulting to true. `lib/preferences.js` normalizes malformed values and flips one key at a time; the sidebar reads it on every render, so the settings panel updates every open copy without a custom event.

Icons are seven Lucide SVG files, ISC licensed; `THIRD_PARTY.md` carries the notice.

## Watch out

- **This mod runs programs and reads outside its own folder.** It calls `exec("git", ...)` in each visible repository `cwd`, and watches local repository roots with `watchFolder`. It makes no network requests. Git failures keep the last successful value and retry later.
- `git --no-optional-locks status` is required. Without the flag, Herdr's git process can create `.git/index.lock` when the project being viewed is the same repository that contains the mod, which blocks other git commands and causes the sidebar to look like it is twitching.
- `git status --porcelain=v2` must be supported. Parse failures leave the previous branch/status in place.
- The mod folder name is part of every icon path (`mods/multi-repo-sidebar/icons/...`). Renaming the folder requires changing `Icon()` and `ProgramIcon` asset paths.
- `place: "none"` means the mod draws nothing until a layout block points at it. The shipped layout is the entry point; installing only `mods/multi-repo-sidebar` leaves Settings unchanged and gives the person no place to switch.
- The settings panel is the same mod under `props().panel === "settings"`; that copy must render no tree and start no git timers. Keep the `shared` key shape stable, or old `shared.json` values will silently reset.
- There is no aggregate status and no repository/sub-agent fold. Only requirement collapse exists.
- Only `state: "live"` terminals are shown. Finished sub-agents disappear; the branch cache is in memory and disappears on reload.
- The workspace repository line follows the first live top-level terminal, not `space.folder`, unless all live terminals are in `home()`. A space whose agent moved to another repository will show the moved repository.
- A child sub-agent with no pane cannot be focused like a pane; `terminal.peek` opens its peek window instead.
- `watchFolder` is capped at 64 roots. Remote repositories rely on the 15s TTL instead of local folder watching.
- The preview uses test agents created with `hc run`; they are not part of the build.

## Done when

1. `herdr-app check mods/multi-repo-sidebar` prints `check passed`.
2. Installing the share puts a card named `Multi-Repo-Sidebar` with Herdr's default thumbnail under `Settings → Look → Layout`; switching to it shows requirement rows, a workspace repository line, a branch line, and top-level agents.
3. A repository with more than one live child agent shows one dim repository label and one agent row per child; a child sub-agent under an agent has a tree rail and opens a peek window when clicked.
4. Each repository name shows git state right after it; the branch line below shows only the branch and never repeats the status. Toggling `Git 状态` off hides every status but keeps branch lines; toggling `仓库分支名` off hides every branch line but keeps status.
5. Clicking the active requirement row collapses and expands the workspace; clicking an inactive one selects it. Narrowing the sidebar below 160px shows the rail. The settings panel's `在 Herdr 设置中切换布局` row closes it and opens `Settings → Look`.
6. `herdr-app status` reports `errors: []` after switching layouts.
