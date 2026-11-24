import { normalizeId } from "./model.js";

export const DOCKED_KEY = "multi-repo.docked";
export const DOCK_OFF_KEY = "multi-repo.dockOff";
export const DOCK_OFF_TTL = 24 * 60 * 60 * 1000;
export const DOCK_SEQ_KEY = "multi-repo.dockSeq";

export function groupName(sequence) {
  return `子代理组-${sequence}`;
}

export function nextGroupSequence(tabs = [], stored = 0) {
  let max = Number(stored) || 0;
  for (const tab of tabs) {
    const match = /^子代理组-(\d+)$/.exec(tab?.name ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function dockableChildren(terminals = [], panes = [], parent = "") {
  const key = normalizeId(parent);
  const paneTerminals = new Set(
    panes.filter((pane) => pane && pane.terminal).map((pane) => normalizeId(pane.terminal)),
  );
  return terminals
    .filter(
      (terminal) =>
        terminal &&
        terminal.state === "live" &&
        terminal.parent &&
        normalizeId(terminal.parent) === key &&
        !paneTerminals.has(normalizeId(terminal.address)),
    )
    .map((terminal) => String(terminal.address));
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
    panes.filter((pane) => pane && pane.terminal).map((pane) => normalizeId(pane.terminal)),
  );
  const byId = new Map();
  for (const terminal of terminals) {
    if (terminal) byId.set(normalizeId(terminal.address), terminal);
  }

  const groups = new Map();
  for (const terminal of terminals) {
    if (!terminal || terminal.state !== "live" || !terminal.parent) continue;
    if (paneTerminals.has(normalizeId(terminal.address))) continue;
    const parent = normalizeId(terminal.parent);
    if (off[parent]) continue;
    const space = spaceFromChain(terminal, byId);
    if (!space) continue;

    let group = groups.get(parent);
    if (!group) {
      group = {
        parent,
        space,
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
    terminals
      .filter((terminal) => terminal?.state === "live")
      .map((terminal) => normalizeId(terminal.address)),
  );
  const waiting = new Set(groups.map((group) => group.parent));
  const nextDocked = {};
  const nextOff = { ...off };

  for (const [parent, tab] of Object.entries(docked)) {
    const tabId = normalizeId(tab);
    if (tabs.has(tabId) && live.has(parent)) nextDocked[parent] = tabId;
    else if (waiting.has(parent)) nextOff[parent] = now;
  }
  for (const [parent, at] of Object.entries(nextOff)) {
    if (!live.has(parent) || now - Number(at) > DOCK_OFF_TTL) delete nextOff[parent];
  }
  return { docked: nextDocked, off: nextOff };
}
