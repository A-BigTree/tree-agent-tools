export const PREFERENCES_KEY = "multi-repo.preferences";

export const PREFERENCE_DEFAULTS = {
  showBranch: true,
  showStatus: true,
};

export const PREFERENCE_TOGGLES = [
  { key: "showBranch", label: "仓库分支名", description: "在仓库行下方显示分支名" },
  { key: "showStatus", label: "Git 状态", description: "在仓库名后显示改动、同步状态" },
];

export function normalizePreferences(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    showBranch: raw.showBranch !== false,
    showStatus: raw.showStatus !== false,
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
