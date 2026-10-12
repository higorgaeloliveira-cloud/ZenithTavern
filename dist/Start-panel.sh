#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required (v20+). Install it from https://nodejs.org"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Git is required. Install it with your package manager."; exit 1; }
if [ -f ZenithTavern.cjs ]; then exec node ZenithTavern.cjs --panel "$@"; else exec node src/launcher.cjs --panel "$@"; fi
