#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mod_name="multi-repo-sidebar"
layout_name="multi-repo"
source="$here/mods/$mod_name"
target="$app_home/mods/$mod_name"

mkdir -p "$app_home/mods"
rm -rf "$target"
mkdir -p "$target"
cp -R "$source"/. "$target"/

herdr-app check "$target"

mkdir -p "$app_home/layouts"
cp "$here/layouts/$layout_name.json" "$app_home/layouts/$layout_name.json"

echo "Installed $mod_name in $target"
echo "Installed layout '$layout_name' (settings card: $layout_name)"
echo
echo "Switch in Herdr: Settings > Look > Layout > $layout_name"
echo "Or run: herdr-app do layout.switch '{\"name\":\"$layout_name\"}'"

if [[ "${1:-}" == "--use" || "${1:-}" == "--with-layout" ]]; then
  herdr-app do layout.switch "{\"name\":\"$layout_name\"}"
  echo "Switched to layout '$layout_name'"
fi
