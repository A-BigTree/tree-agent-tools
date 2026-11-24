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
