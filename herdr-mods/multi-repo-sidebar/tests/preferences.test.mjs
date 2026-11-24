import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREFERENCE_DEFAULTS,
  clampDockColumns,
  isVisible,
  normalizePreferences,
  togglePreference,
} from "../mods/multi-repo-sidebar/lib/preferences.js";

test("missing or malformed preferences fall back to showing both", () => {
  assert.deepEqual(normalizePreferences(undefined), PREFERENCE_DEFAULTS);
  assert.deepEqual(normalizePreferences(null), PREFERENCE_DEFAULTS);
  assert.deepEqual(normalizePreferences("nope"), PREFERENCE_DEFAULTS);
  assert.deepEqual(normalizePreferences({}), PREFERENCE_DEFAULTS);
});

test("explicit false hides a part, anything else keeps it visible", () => {
  assert.deepEqual(normalizePreferences({ showBranch: false, showStatus: "no" }), {
    showBranch: false,
    showStatus: true,
    autoDock: true,
    dockColumns: 2,
  });
  assert.equal(isVisible({ showBranch: false }, "showBranch"), false);
  assert.equal(isVisible({ showBranch: 0 }, "showBranch"), true);
});

test("toggle flips one preference and leaves the other alone", () => {
  assert.deepEqual(togglePreference({ showBranch: true, showStatus: true }, "showBranch"), {
    showBranch: false,
    showStatus: true,
    autoDock: true,
    dockColumns: 2,
  });
  assert.deepEqual(togglePreference({ showBranch: false, showStatus: true }, "showBranch"), {
    showBranch: true,
    showStatus: true,
    autoDock: true,
    dockColumns: 2,
  });
});

test("unknown keys do not change preferences", () => {
  assert.deepEqual(togglePreference({ showBranch: false }, "nope"), {
    showBranch: false,
    showStatus: true,
    autoDock: true,
    dockColumns: 2,
  });
});

test("auto docking defaults on with two columns", () => {
  assert.equal(PREFERENCE_DEFAULTS.autoDock, true);
  assert.equal(PREFERENCE_DEFAULTS.dockColumns, 2);
  assert.deepEqual(normalizePreferences({}), PREFERENCE_DEFAULTS);
  assert.equal(normalizePreferences({ autoDock: false }).autoDock, false);
});

test("dock columns clamp to 1..4 and ignore junk", () => {
  assert.equal(normalizePreferences({ dockColumns: 0 }).dockColumns, 1);
  assert.equal(normalizePreferences({ dockColumns: 9 }).dockColumns, 4);
  assert.equal(normalizePreferences({ dockColumns: "3" }).dockColumns, 3);
  assert.equal(normalizePreferences({ dockColumns: 2.6 }).dockColumns, 3);
  assert.equal(normalizePreferences({ dockColumns: "x" }).dockColumns, 2);
  assert.equal(clampDockColumns(undefined), 2);
});
