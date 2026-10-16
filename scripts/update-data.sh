#!/usr/bin/env bash
# Rebuilds data/ from the latest battle-cats-rolls and pushes it if any
# banner changed. Meant for cron; refuses to run on a dirty tree.
#
#   scripts/update-data.sh [--no-push]
#
# Exit status: 0 = updated or nothing new, 1 = failed (nothing pushed).
set -euo pipefail
cd "$(dirname "$0")/.."

for d in "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
command -v node >/dev/null || { echo "node not found"; exit 1; }

[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty; not updating"; exit 1; }
git pull -q --ff-only

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git clone -q --depth 1 https://gitlab.com/godfat/battle-cats-rolls.git "$src"
upstream=$(git -C "$src" log -1 --format=%h)

ruby scripts/build-data.rb "$src"

# Every banner in the new data must load and build a pool.
node -e '
const fs = require("fs"), vm = require("vm"), E = require("./src/engine.js");
for (const lang of ["tw", "jp", "en", "kr"]) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(`data/bc-${lang}.js`, "utf8"), ctx);
  const d = ctx.window.BC_DATA[lang];
  for (const k of [...Object.keys(d.events), ...Object.keys(d.platinum)]) E.buildPool(d, k);
}'
node test/verify-engine.js

# Only the build date changed: nothing new upstream.
if git diff -U0 data | grep '^[-+](' | sed 's/^[-+]//; s/"built":"[0-9-]*"//' | sort | uniq -u | grep -q .; then :; else
  git checkout -q data
  echo "no banner changes (upstream $upstream)"
  exit 0
fi

latest=$(node -e '
const fs = require("fs"), vm = require("vm"), ctx = { window: {} };
vm.runInNewContext(fs.readFileSync("data/bc-tw.js", "utf8"), ctx);
console.log(Object.values(ctx.window.BC_DATA.tw.events).map((e) => e.end).sort().pop());')
git add data
git commit -q -m "Update banner data to $(date +%F)

Built from battle-cats-rolls $upstream; tw banners through $latest."
[ "${1:-}" = --no-push ] || git push -q
echo "updated: upstream $upstream, tw banners through $latest"
