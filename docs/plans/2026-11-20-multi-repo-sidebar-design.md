# Multi-Repo Sidebar 设计

日期：2026-11-20
状态：已确认，待实现
分支：feature_herdr_mods

## 背景

Herdr 默认侧边栏把 spaces 和 agents 分成两块平铺列表，无法表达“一个需求涉及多个仓库、每个仓库有 agent 和子 agent”的结构。目标是在 `herdr-mods/{mod}/` 下实现一个侧边栏 mod：以需求为顶层，展示工作区仓库、代码仓库、agent 与 sub-agent 的关联，并补充仓库分支信息。

## 目标

- 一个需求用一个 Herdr space 表示。
- 需求下展示工作区仓库信息，再展示代码仓库及其实体。
- agent、普通终端与 sub-agent 使用同一种行样式。
- 直接子终端按所在仓库目录聚类；深层 sub-agent 保持父子关系，不跨仓库重排。
- 仓库分支通过后台 git 读取，缓存、监听并容错。
- 不折叠、不显示聚合状态。

## 非目标

- 不新增 Herdr 数据模型，不修改 herdr-core。
- 不改变终端渲染、不引入 HTML/CSS/WebView。
- 不执行 git 写操作（不 checkout、不 commit）。
- 不实现 PR、issue、文件树等额外面板。

## 数据模型

### 需求

- 一个 `space` = 一个需求。
- 需求第一行：space 头像、需求名、该 space 内 live 终端总数。
- 需求第二行：工作区仓库名 + 分支。仓库名取 `space.folder` 或首个终端 `cwd` 的目录名；不绑定某个 agent，不显示状态。
- 点击第一行切换 space；右键打开 Herdr 原生 space 菜单。

### 终端树

数据来源：`spaces()`、`agents()`、`terminals()`、`panes()`。

- `terminals()` 中 `state === "live"` 且属于该 space 的终端全部进入树；agent 与普通终端同类型展示。
- 顶层节点：`parent` 为空，或 parent 不在本 space 的终端。
- 子节点：按 `parent` 构建父子关系，保持原始层级。
- 一个 space 可以有多个顶层节点，不假设只有一个工作区 agent。
- 终端行展示：程序图标、名称/标题、自身状态（普通终端无状态）、树线；hover 显示完整名称、cwd、报告；点击聚焦。

### 仓库聚类

- 对每个顶层节点的**直接子终端**按仓库目录聚类。
- 仓库目录优先使用后台 git 得到的 `git rev-parse --show-toplevel`；拿不到时回退到 `cwd`。
- 同一仓库目录的多个直接子终端合并为一个仓库组。
- 仓库组行：仓库名 + 分支；不显示聚合状态。
- 仓库组下按 agent → sub-agent 原树展示；更深层 sub-agent 不重新聚类。
- 顶层节点本身不参与仓库聚类；它只作为其直接子终端的父节点。

## 视觉与交互

- 顶部：`需求` 标题、需求数量、新建 space 按钮。
- 需求行两行；工作区仓库名和分支使用第二行，避免长工程名被右侧信息挤压。
- 仓库组行使用分支图标、仓库名、分支；参考 better-sidebar / herca 的 icon 和缩进风格。
- agent / sub-agent 行沿用 Herdr 默认 agents 列表风格：程序图标、名称/标题、状态、树线。
- 状态仅在终端行显示：`blocked` 红色徽标、`working` spinner、`done` 实心点、`idle` 圆环。
- 不显示聚合状态，不提供折叠箭头，不持久化折叠状态，始终完整展开。
- 侧边栏宽度小于 160px 时切换为 rail：需求头像、点击选择 space、底部 `»` 展开。
- 颜色全部来自 `theme()`；图标使用 mod 自带 SVG。

## 分支读取

- 对工作区仓库、每个仓库组的 `cwd` 后台执行 git。
- 每个仓库两次读取：
  - `git rev-parse --path-format=absolute --show-toplevel`
  - `git symbolic-ref -q --short HEAD`
- 缓存键：`[machine ?? null, cwd]`，值包含 `repoRoot`、`branch`、`checkedAt`。
- TTL 15 秒；最多同时 6 个 git 读取，其余排队；相同 cwd 去重。
- 本地仓库首次读取后 `watchFolder(repoRoot)`；目录变化时标记过期并重读；远程机器靠定时回退。
- 失败保留上一次成功结果，记录重试时间；不弹错、不阻塞渲染。
- `herdr-app check` 时跳过 exec、timer 和 watcher。

## 组件与文件结构

```text
herdr-mods/multi-repo-sidebar/
  mod.json
  main.js                 # View、渲染、交互、分支刷新调度
  lib/model.js            # 纯函数：终端树、需求、仓库聚类
  lib/branches.js         # 纯函数：缓存、TTL、待刷新计划
  lib/ui.js               # 设计 token、Avatar、Status、图标按钮
  icons/*.svg
  layouts/requirements.json
  tests/model.test.mjs
  tests/branches.test.mjs
  README.md
  sync.sh
```

## 错误处理

- 缺少 space 标签、cwd 或 parent 的终端：跳过或用已知字段降级，不抛错。
- git 失败：保留旧分支，显示为空或 `detached`，稍后重试。
- 终端消失：从树中移除；缓存保留至过期。
- 渲染异常：Herdr 保留上一版 UI 并写 `.error` 文件；开发时用 `herdr-app check` 与截图验证。

## 测试

- 模型测试：
  - agent 与普通终端进入同一棵树。
  - 多个顶层节点。
  - 直接子终端按仓库根聚类；同仓库合并。
  - 深层 sub-agent 不跨仓库重排。
  - git 仓库根与 cwd 不同时按仓库根分组。
- 分支缓存测试：
  - TTL、去重、失败保留旧值、并发上限。
- 集成验证：
  - `node --test`
  - `herdr-app check ~/.config/herdr-app/mods/multi-repo-sidebar`
  - `herdr-app shot` 截图确认布局。

## 布局集成

- 提供独立示例 layout `layouts/requirements.json`，侧边栏只放一个 `multi-repo-sidebar` block。
- 也可把现有 layout 的 `spaces` + `agents` 两个 block 替换为单个 block。
- 默认宽度 280px，min 44px，max 480px。
