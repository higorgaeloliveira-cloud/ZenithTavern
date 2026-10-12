#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required (v20+)."; exit 1; }
if [ -f ZenithTavern.cjs ]; then exec node ZenithTavern.cjs --repair "$@"; else exec node src/repair.cjs "$@"; fi
