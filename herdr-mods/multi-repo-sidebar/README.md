# Multi-Repo Sidebar

Herdr 侧边栏 mod：按「需求 → 工作区仓库 → 代码仓库 → agent / sub-agent」展示多仓库、多 agent 的工作现场。

## 数据模型

Herdr 现有的 `spaces` / `agents` 是两个平铺列表；这个 mod 把同一份 live 数据重新组织成一棵树。

| Herdr 实体 | 在侧边栏中的角色 |
|---|---|
| space | 一个需求 |
| 首个顶层终端的实时 cwd（无终端时回退 `space.folder`） | 需求第二行的工作区仓库名与分支 |
| space 内的顶层终端（parent 为空） | 需求下的顶层节点；可以有多个 |
| 顶层节点的直接子终端 | 按 `cwd` 所在的仓库聚类；同仓库合并 |
| 更深的 sub-agent | 保持 agent → sub-agent 父子关系，不跨仓库重排 |

- 工作区仓库行与需求名齐平；git 状态紧跟仓库名右侧，分支单独一行展示，不再被同一行宽度截断。
- 仓库行同样是仓库名在左、git 状态在右；分支在下一行。
- 顶层 agent 前不画树线；仓库 agent 是工作区 Agent 的子 Agent，和更深 sub-agent 一样用树线表达层级。
- 视觉主体是 agent：agent 使用主文本色；仓库名、分支和工作区描述使用弱化色。
- `hc ls` 里的 agent 和普通终端/命令行都进入同一棵树，使用同一种行样式；普通终端没有状态就不显示状态。
- 仓库名优先取 `git rev-parse --show-toplevel` 的目录名；拿不到时回退到 cwd 目录名。
- 只展示 `state: "live"` 的终端；已结束的终端不显示。
- 不显示聚合状态；需求行支持点击折叠/展开。

## 安装

```bash
cd herdr-mods/multi-repo-sidebar
./sync.sh                 # 只安装 mod
./sync.sh --with-layout   # 同时安装示例 layout
```

安装后热加载。切换到示例 layout：

```bash
herdr-app do layout.switch '{"name":"multi-repo"}'
```

回到原 layout：

```bash
herdr-app do layout.switch '{"name":"main"}'
```

## 接入现有 layout

示例 layout 在 `herdr-mods/examples/multi-repo.json`。如果只想改自己的 layout：

1. 克隆当前 layout：`herdr-app do layout.clone '{"name":"main","as":"my-multi-repo"}'`
2. 编辑 `~/.config/herdr-app/layouts/my-multi-repo.json`
3. 把侧边栏里的 `spaces` 和 `agents` 两个 block 换成一个：

```json
{
  "id": "requirements",
  "type": "block",
  "size": { "weight": 1 },
  "min": 90,
  "content": { "mod": "multi-repo-sidebar" }
}
```

4. `herdr-app do layout.switch '{"name":"my-multi-repo"}'`

## 交互

- 点击需求行：如果它不是当前 space，切换到该 space；如果已经是当前 space，再点一次折叠/展开。
- 点击工作区仓库行：切换 space；tooltip 显示完整工作区仓库名和分支。
- 点击顶层终端 / 仓库 / agent / sub-agent 行：聚焦对应终端；没有 pane 的 sub-agent 用 `terminal.peek` 打开 peek 窗口。
- 点击需求第一行右侧的齿轮按钮：打开显示设置面板，可分别隐藏/显示仓库分支名和 git 状态。
- 点击需求第一行右键：打开 Herdr 原生 space 菜单。
- 侧边栏窄于 160px 时变成 rail：显示需求头像，点击选择 space，底部 `»` 展开。

## 分支和状态

- 后台对工作区仓库和每个仓库组的 cwd 执行 `git`，读取仓库根、当前分支、ahead/behind 和工作区状态。
- git 状态展示在仓库名称右侧；分支单独一行展示，并与仓库/文件夹 icon 左侧对齐。状态参考 powerlevel10k：
  - `!N`：N 个未暂存改动。
  - `+N`：N 个已暂存、待提交改动。
  - `?N`：N 个未跟踪文件。
  - `✘N`：N 个冲突。
  - `⇡N`：N 个提交待推送。
  - `⇣N`：落后远端 N 个提交。
- 显示设置保存在 `shared()` 的 `multi-repo.preferences`，默认两项都显示；设置面板里点一下立即生效，对已经打开的侧边栏同样生效。
- 缓存按 `[machine, cwd]` 保存，15 秒 TTL；最多 6 个读取并发，其余排队。
- 本地仓库读取成功后监听目录变化；远程机器靠定时回退。
- git 失败时保留上一次成功结果，稍后重试；不阻塞渲染。
- `herdr-app check` 期间不会执行 git、timer 或 watcher。

## 开发

```bash
cd herdr-mods/multi-repo-sidebar
node --test tests/*.test.mjs
./sync.sh
herdr-app check ~/.config/herdr-app/mods/multi-repo-sidebar
```

修改 `mods/multi-repo-sidebar/main.js` 或 `mods/multi-repo-sidebar/lib/*.js` 后 Herdr 会热加载。若渲染出错，检查
`~/.config/herdr-app/mods/multi-repo-sidebar.error`（如存在）。

设计文档：`docs/plans/2026-11-20-multi-repo-sidebar-design.md`。
实施计划：`docs/plans/2026-11-20-multi-repo-sidebar.md`。
