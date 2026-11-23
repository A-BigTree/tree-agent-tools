# tree-agent-tools

用于树状 Agent 工作流的工具集合，目前包含 Herdr Desktop 的侧边栏 mod。

## Herdr mods

### Multi-Repo Sidebar

把 Herdr 的 space 组织成「需求 → 工作区仓库 → 代码仓库 → Agent / 子 Agent」的侧边栏。需求行展示工作区仓库；直接子 Agent 按其 git 仓库聚类，仓库名作为弱化描述，Agent 作为视觉主体；分支单独一行，并显示 powerlevel10k 风格的 git 状态（`!N`、`+N`、`?N`、`✘N`、`⇡N`、`⇣N`）。

![Multi-Repo Sidebar](herdr-mods/multi-repo-sidebar/preview.png)

- 源码和分享包：`herdr-mods/multi-repo-sidebar/`
- 构建说明：`herdr-mods/multi-repo-sidebar/RECIPE.md`
- 示例 layout：`herdr-mods/examples/multi-repo.json`
- 安装：

```bash
cd herdr-mods/multi-repo-sidebar
./sync.sh                 # 安装 mod
./sync.sh --with-layout   # 同时安装示例 layout
```

然后在自己的 layout 中加入：

```json
{
  "id": "requirements",
  "type": "block",
  "size": { "weight": 1 },
  "min": 90,
  "content": { "mod": "multi-repo-sidebar" }
}
```

注意：该 mod 会通过 `exec("git")` 读取仓库状态，并用 `watchFolder` 监听本地仓库目录；不发起网络请求。详见 `RECIPE.md` 的 **Watch out**。

## 仓库结构

```text
herdr-mods/
  examples/                # 示例 layout
  multi-repo-sidebar/      # Herdr mod 分享包
    mods/multi-repo-sidebar/
    RECIPE.md
    preview.png
    sync.sh
    tests/
docs/plans/                # 设计与实施计划
```

## 开发

```bash
cd herdr-mods/multi-repo-sidebar
node --test tests/*.test.mjs
herdr-app check mods/multi-repo-sidebar
```

## License

Apache License 2.0，见 `LICENSE`。
