#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is required (v20+). Install it from https://nodejs.org"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Git is required. Install it with your package manager."; exit 1; }
[ -f ZenithTavern.cjs ] || { echo "Getting the ZenithTavern launcher, so it can update itself from now on..."; curl -fsSL -o ZenithTavern.cjs.tmp "https://raw.githubusercontent.com/higorgaeloliveira-cloud/ZenithTavern/main/dist/ZenithTavern.cjs" && mv ZenithTavern.cjs.tmp ZenithTavern.cjs || { rm -f ZenithTavern.cjs.tmp; echo "Could not download it. Starting the local copy instead; it will not check for updates."; }; }
if [ -f ZenithTavern.cjs ]; then exec node ZenithTavern.cjs --panel "$@"; else exec node src/launcher.cjs --panel "$@"; fi
