# Multi-Repo Sidebar 自动停靠子 agent 设计

日期：2026-11-20
状态：已确认，待实现
分支：`feat/multi-repo-sidebar-auto-dock`

## 背景

`hc` 创建的子 agent 默认没有 pane：它们只存在于终端列表里，Herdr 不会自动为它们停靠 tab 或 pane。父 agent 在 tab 里创建 5 个子 agent 后，用户只能逐个 `terminal.keep` 手动摆放。

目标是在 `multi-repo-sidebar` mod 里自动发现这类子 agent，并为同一父 agent 的子 agent 建一个 tab，把它们停靠成 2 列网格。

## 目标

- 同一父 agent 的无 pane 子 agent 自动停靠到新建 tab。
- 默认 2 列网格，列数可在 mod 设置面板调整（1–4）。
- 功能默认开启，可在设置面板关闭。
- 分批创建的子 agent 复用同一个 tab。
- 用户手动关闭自动停靠 tab 后，不再为该父 agent 重建。
- 不抢焦点、不打断用户当前操作。

## 非目标

- 不修改 herdr-core，不新增数据模型。
- 不改变父 agent 所在 tab，不移动已有 pane。
- 不处理非 `hc` 来源、没有 `parent` 的普通终端。
- 不做像素级等分（Herdr 不暴露 pane 尺寸）。

## 数据来源

全部来自 mod 运行时可读的 API：

- `terminals()`：`address`、`parent`、`state`、`name`、`title`、`labels["herdr.space"]`。
- `panes()`：`terminal`、`pane`、`tab`、`focused`。
- `spaces()`：`id`、`tabs[].id`、`tabs[].name`、`machine`。
- `focused()`：启动停靠前记录焦点，收尾恢复。

## 分组规则

候选子 agent 需同时满足：

1. `state === "live"`；
2. 有 `parent`；
3. `panes()` 中不存在它，即没有 pane。

分组的键是**直接父地址**。孙辈会为它自己的父 agent 另开 tab，不合并到祖父的 tab。

父 agent 的 space 解析顺序：

1. `labels["herdr.space"]`；
2. 沿 `parent` 链向上找到有 space 的终端；
3. 都找不到则跳过该组。

## 状态机

`init` 注册 `cx.timer.every(1000, ...)`。每个 tick 读取一次实时数据，只推进一步，避免 `terminal.keep` 的 `pending` 竞态。

**实现修正：** mod 里的 `run()` 返回 `null`，拿不到 `tab.new` 的返回值。因此建 tab 前先快照目标 space 的 tab id，下一 tick 用 diff + 名称找到新 tab；`terminal.keep` 的效果也只看 `panes()`。

**只处理新子 agent：** mod 启动后的第一个 tick 记录当前所有无 pane 子 agent 作为基线，不移动已存在的子 agent；之后只停靠基线之外的新子 agent。

一组子 agent 的步骤：

1. 快照目标 space 的 tab id，`tab.new { name: "子代理组-N", space, focus: false }`（N 在同一 space 内递增）。
2. 下一 tick 用 diff 找到新 tab，取它的初始 shell pane 作为 spacer。
3. 按 `gridPlan` 顺序逐个停靠：`pane.focus` 目标 pane → `terminal.keep { terminal, place }`。
4. 下一 tick 用 `panes()` 确认子 agent 已落位；3 秒未落位则重试该步。
5. 全部落位后关闭 spacer。
6. 恢复 `focused()` 记录的 pane/terminal。

同一父 agent 后续再创建子 agent 时复用已记录的 tab：每个新子 agent 在 tab 最后一个 pane 上向下切分。

单步连续失败 2 次即放弃该组并记入 `dockOff`，避免每秒重试刷屏。任何 aborted 组都会把子 agent 加入基线，配合 `dockCooldown` 防止重复建 tab。

## 网格规划

`gridPlan(n, columns)` 为纯函数：

- 行数 `rows = ceil(n / columns)`。
- 先把每行第一个 pane 在左列向下切分（`place:"down"`）。
- 再对每行向右切出剩余 pane（`place:"right"`）。
- 例：5 个、2 列 → `c1|c4`、`c2|c5`、`c3`。

关闭 spacer 后两列精确 50/50；行高沿用 Herdr 默认分割比例（3 行约 50/25/25）。Herdr 不暴露 pane 尺寸，`pane.resize` 只能猜像素，因此不做归一化。

## 懒等分

Herdr 的 split 固定 50/50，3 列会变成 50/25/25。mod 在建好网格后记录每个 tab 的 `rows`（终端地址二维数组）到 `multi-repo.grids`，并在该 tab 被显示时逐 tick 移动分隔线：

- 反馈来自终端可读的 `cols` / `rows` 整数，不需要窗口尺寸。
- 同一行按从左到右修分隔线；同一列按从上到下。
- 放大第 j 个 pane：对 pane j 执行 `pane.resize direction:"right"`；缩小它：对 pane j+1 执行 `direction:"left"`，竖向同理用 `down`/`up`。始终用正 px。
- 学到的“每字符像素”存进 spec；符号相反时步长乘以 0.6 阻尼，单次最多 200px。
- 收敛条件：同一行/列相差 ≤1 个字符；2 列或 2 行天然相等，直接跳过。
- tab 被关闭或重建时清理 spec；pane 被 zoom 时暂停。
- 后续批次改为整组 relayout（`terminal.park` 收回 pane，再重新停靠），保证新网格也有 spec。

## 设置

偏好继续存 `shared("multi-repo.preferences")`，新增：

- `autoDock`：布尔，默认 `true`。
- `dockColumns`：整数 1–4，默认 `2`，`normalizePreferences` 做范围收敛。

设置面板新增两行：

- `自动停靠子 agent` 开关。
- `每个 tab 的 pane 列数` 的 `− / 2 / +` 步进器。

## 持久化

- `localStorage["multi-repo.docked"]`：父地址 → tabId。
- `localStorage["multi-repo.dockOff"]`：父地址 → 关闭时间戳。

每个 tick 清理：

- tabId 已不在 `spaces().tabs` 中且子 agent 仍存在 → 转为 `dockOff`，不再重建。
- 父终端已消失或记录超过 24 小时 → 删除。
- `dockOff` 的父终端消失 → 删除。

## 失败与边界

- 建 tab 失败：保留组状态，下一 tick 重试，最多 2 次。
- keep 落位超时：重试该步 2 次后放弃整组。
- 设置关闭：状态机直接返回，不新增记录，不清理已有 tab。
- 多 machine：只为当前连接的 space 建 tab；跨机器父终端不处理。

## 测试

新增 `tests/docking.test.mjs`（纯函数）：

- 候选识别：无 pane、有 parent、live 才入选。
- 分组：按直接父地址；孙辈单独成组。
- 父无 space 时跳过。
- `gridPlan`：1–6 个 × 1–3 列的停靠顺序。
- 复用：已有 tabId 只追加新子 agent。
- 关闭：tab 消失后有子 agent → `dockOff`，不重建。
- 清理：失效 tab、消失的父、过期记录。

同时更新 `README.md`、`RECIPE.md`，`mod.json` 版本升到 `0.4.0`。
