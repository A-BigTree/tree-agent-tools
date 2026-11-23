#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mod_name="multi-repo-sidebar"
source="$here/mods/$mod_name"
target="$app_home/mods/$mod_name"

mkdir -p "$app_home/mods"
rm -rf "$target"
mkdir -p "$target"
cp -R "$source"/. "$target"/

herdr-app check "$target"

if [[ "${1:-}" == "--with-layout" ]]; then
  mkdir -p "$app_home/layouts"
  cp "$here/../examples/multi-repo.json" "$app_home/layouts/multi-repo.json"
  echo "Installed layout. Switch with:"
  echo "  herdr-app do layout.switch '{\"name\":\"multi-repo\"}'"
fi

echo "Installed $mod_name in $target"
