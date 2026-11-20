export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function normalizeId(value) {
  const text = String(value ?? "");
  const at = text.lastIndexOf("/");
  return at === -1 ? text : text.slice(at + 1);
}

export function rankOf(status) {
  return RANK[status] ?? 0;
}

export function normalizeStatus(value) {
  const status = typeof value === "object" && value !== null ? value.state : value;
  if (status === "error") return "blocked";
  return status === "blocked" || status === "done" || status === "working" || status === "idle" ? status : null;
}

export function topStatus(statuses) {
  let top = null;
  for (const status of statuses) if (rankOf(status) > rankOf(top)) top = status;
  return top;
}

export function baseName(path) {
  return (
    String(path ?? "")
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? ""
  );
}

export function displayName(node) {
  return node?.name || node?.title || node?.program?.name || node?.address || "";
}

function reportText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.msg || value.summary || value.title || null;
  return null;
}

function descendants(node, result = []) {
  for (const child of node?.children ?? []) {
    result.push(child);
    descendants(child, result);
  }
  return result;
}

function sortNodes(nodes) {
  nodes.sort((a, b) => a.created - b.created || a.local.localeCompare(b.local));
  for (const node of nodes) sortNodes(node.children);
}

export function buildRequirements({
  spaces = [],
  agents = [],
  terminals = [],
  panes = [],
  resolveRepo = () => null,
  homeFolder = null,
} = {}) {
  const listed = new Map();
  for (const agent of agents) listed.set(normalizeId(agent.address), agent);
  const paneByTerminal = new Map();
  for (const pane of panes) if (pane.terminal) paneByTerminal.set(normalizeId(pane.terminal), pane);
  const spaceById = new Map(spaces.map((space) => [normalizeId(space.id), space]));

  const rawNodes = [];
  const byAddress = new Map();
  const byLocal = new Map();
  const spaceByWhere = new Map(spaces.map((space) => [space.name, space]));

  for (const terminal of terminals) {
    if (!terminal || terminal.state !== "live") continue;
    const local = normalizeId(terminal.address);
    const agent = listed.get(local);
    const explicitSpace = normalizeId(terminal.labels?.["herdr.space"] ?? agent?.space);
    const pane = paneByTerminal.get(local);
    const where = String(terminal.labels?.where ?? "");
    const whereParts = where.split(" / ");
    const node = {
      key: null,
      address: String(terminal.address),
      local,
      space: explicitSpace || null,
      machine: explicitSpace ? (spaceById.get(explicitSpace)?.machine ?? null) : null,
      name: terminal.name || null,
      title: terminal.title || null,
      cwd: pane?.cwd || terminal.cwd || null,
      parentAddress: terminal.parent ? String(terminal.parent) : null,
      parent: terminal.parent ? normalizeId(terminal.parent) : null,
      parentNode: null,
      status: normalizeStatus(agent?.status ?? terminal.status),
      report: reportText(terminal.report),
      program: terminal.program || agent?.program || null,
      pane: agent?.pane || pane?.pane || null,
      tab: normalizeId(terminal.labels?.["herdr.tab"] ?? agent?.tab),
      branch: pane?.branch || null,
      created: Number(terminal.created_ms ?? 0),
      seq: Number(agent?.seq ?? 0),
      children: [],
      whereSpace: whereParts.length > 1 ? whereParts[0] : null,
      whereTab: whereParts.length > 1 ? whereParts.slice(1).join(" / ") : null,
      tabName: null,
      tabNamed: false,
    };
    rawNodes.push(node);
    byAddress.set(node.address, node);
    if (!byLocal.has(local)) byLocal.set(local, node);
  }

  for (const node of rawNodes) {
    if (!node.parentAddress || node.parent === node.local) continue;
    const parent = byAddress.get(node.parentAddress) || byLocal.get(node.parent);
    if (parent && parent !== node) node.parentNode = parent;
  }

  for (const node of rawNodes) {
    if (node.space) continue;
    let ancestor = node.parentNode;
    const seen = new Set([node]);
    while (ancestor && !ancestor.space && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = ancestor.parentNode;
    }
    if (ancestor?.space) {
      let cursor = node;
      while (cursor && !cursor.space) {
        cursor.space = ancestor.space;
        cursor.machine = ancestor.machine;
        if (!cursor.tab) cursor.tab = ancestor.tab;
        cursor = cursor.parentNode;
      }
      continue;
    }
    if (node.whereSpace) {
      const space = spaceByWhere.get(node.whereSpace);
      if (space) {
        node.space = normalizeId(space.id);
        node.machine = space.machine ?? null;
        if (!node.tab && node.whereTab) {
          const tab = (space.tabs ?? []).find((candidate) => candidate.name === node.whereTab);
          if (tab) node.tab = normalizeId(tab.id);
        }
      }
    }
  }

  for (const node of rawNodes) {
    if (!node.space) continue;
    const space = spaceById.get(node.space);
    const tab = (space?.tabs ?? []).find((candidate) => normalizeId(candidate.id) === node.tab);
    node.tabName = tab?.name || null;
    node.tabNamed = Boolean(tab?.named);
  }

  const kept = new Set();
  const nodes = [];
  for (const node of rawNodes) {
    if (!node.space || !spaceById.has(node.space)) continue;
    node.key = `${node.space}|${node.local}`;
    kept.add(node);
    nodes.push(node);
  }

  for (const node of nodes) {
    const parent = node.parentNode;
    if (parent && parent !== node && kept.has(parent) && parent.space === node.space) {
      parent.children.push(node);
    }
  }
  sortNodes(nodes);

  const tabOrder = new Map();
  for (const space of spaces) {
    const index = new Map();
    for (const [position, tab] of (space.tabs ?? []).entries()) index.set(normalizeId(tab.id), position);
    tabOrder.set(normalizeId(space.id), index);
  }

  const requirements = spaces.map((space) => {
    const id = normalizeId(space.id);
    const mine = nodes.filter((node) => node.space === id);
    const roots = mine.filter((node) => {
      const parent = node.parentNode;
      return !parent || !kept.has(parent) || parent.space !== node.space || parent === node;
    });
    roots.sort((a, b) => {
      const order = tabOrder.get(id);
      return (
        (order?.get(a.tab) ?? 999) - (order?.get(b.tab) ?? 999) ||
        a.created - b.created ||
        a.local.localeCompare(b.local)
      );
    });

    const folder =
      roots.map((root) => root.cwd).find((cwd) => cwd && cwd !== homeFolder) ||
      roots[0]?.cwd ||
      space.folder ||
      "";
    const workspaceInfo = resolveRepo(folder, space);
    const workspace = {
      name: workspaceInfo?.name || (folder && folder === homeFolder ? "~" : baseName(folder)) || space.name || "",
      branch: workspaceInfo?.branch || null,
    };

    const rootGroups = roots.map((root) => {
      const byRepo = new Map();
      const repos = [];
      for (const child of root.children) {
        const info = resolveRepo(child.cwd, space);
        const key = info?.key || `${space.machine ?? ""}|${child.cwd || child.address}`;
        let repo = byRepo.get(key);
        if (!repo) {
          repo = {
            key,
            name: info?.name || baseName(child.cwd) || displayName(child),
            branch: info?.branch || child.branch || null,
            cwd: child.cwd || null,
            agents: [],
            terminalCount: 0,
          };
          byRepo.set(key, repo);
          repos.push(repo);
        }
        if (!repo.branch && child.branch) repo.branch = child.branch;
        if (!repo.cwd && child.cwd) repo.cwd = child.cwd;
        repo.agents.push(child);
      }
      for (const repo of repos) {
        repo.agents.sort((a, b) => a.created - b.created || a.local.localeCompare(b.local));
        repo.terminalCount = repo.agents.reduce((count, agent) => count + 1 + descendants(agent).length, 0);
      }
      return { key: root.key, address: root.address, node: root, repos };
    });

    return {
      id,
      space,
      name: space.name || space.folder || "",
      active: Boolean(space.active),
      folder,
      workspace,
      terminalCount: mine.length,
      roots: rootGroups,
    };
  });

  const order = [];
  for (const requirement of requirements) {
    for (const root of requirement.roots) {
      order.push(root.address);
      for (const repo of root.repos) {
        for (const agent of repo.agents) {
          order.push(agent.address);
          for (const child of descendants(agent)) order.push(child.address);
        }
      }
    }
  }

  return {
    requirements,
    order,
    totalTerminals: nodes.length,
  };
}
