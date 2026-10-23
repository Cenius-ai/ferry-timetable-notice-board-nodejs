#!/usr/bin/env bash
# Ferry Timetable Notice Board — project-level install.
# Installs Node dependencies (there are none at runtime), creates the data
# directory and seeds the demo board. Never starts the server, never uses sudo.
# Written to run under both `sh install.sh` and `bash install.sh`.
set -eu
cd "$(dirname "$0")"

echo "==> Ferry Timetable Notice Board: install"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. See INSTALL.md for prerequisites." >&2
  exit 1
fi

node -e '
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error("Node.js 20 or newer is required, found " + process.versions.node + ". See INSTALL.md.");
  process.exit(1);
}
'

echo "==> Installing project dependencies"
# node version advisory (auto-added by cenius)
if command -v node >/dev/null 2>&1; then
  _REQ_NODE="$(node -p "(require('./package.json').engines||{}).node||''" 2>/dev/null || true)"
  [ -n "$_REQ_NODE" ] && echo "-> This app requires Node $_REQ_NODE (you have $(node -v)). If install fails with EBADENGINE, upgrade Node: https://nodejs.org"
fi
npm install --no-audit --no-fund

mkdir -p data

echo "==> Seeding the demo board"
node seed.js

echo
echo "Install complete. Start the board with:  node ."
echo "Demo staff login: cenius@cenius.ai / cenius"
