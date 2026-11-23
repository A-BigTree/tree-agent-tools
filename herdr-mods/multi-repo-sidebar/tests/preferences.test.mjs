import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREFERENCE_DEFAULTS,
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
  });
  assert.equal(isVisible({ showBranch: false }, "showBranch"), false);
  assert.equal(isVisible({ showBranch: 0 }, "showBranch"), true);
});

test("toggle flips one preference and leaves the other alone", () => {
  assert.deepEqual(togglePreference({ showBranch: true, showStatus: true }, "showBranch"), {
    showBranch: false,
    showStatus: true,
  });
  assert.deepEqual(togglePreference({ showBranch: false, showStatus: true }, "showBranch"), {
    showBranch: true,
    showStatus: true,
  });
});

test("unknown keys do not change preferences", () => {
  assert.deepEqual(togglePreference({ showBranch: false }, "nope"), {
    showBranch: false,
    showStatus: true,
  });
});
