#!/usr/bin/env node
'use strict';
/*
 * Raises the ZenithTavern version number. Run it once per change, BEFORE building.
 *
 *   node tools/bump.cjs ui "what changed"                 interface change (removed, added, changed)  -> +0.0.1
 *   node tools/bump.cjs internal "what changed"           prompts, characters, configs, phone, server  -> +0.1.0
 *   node tools/bump.cjs major "what changed"              huge change or addition                      -> +1.0.0
 *   node tools/bump.cjs ui,internal "what changed"        a change of both kinds adds both
 *
 * The numbers only add up: 0.0.1 + internal = 0.1.1, then + major = 1.1.1. Nothing resets.
 * The number and a short history are kept in core/version.json.
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'core', 'version.json');
const STEP = { ui: [0, 0, 1], internal: [0, 1, 0], major: [1, 0, 0] };

const kinds = String(process.argv[2] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const note = process.argv.slice(3).join(' ').trim();
if (!kinds.length || kinds.some((k) => !STEP[k]) || !note) {
  console.error('Usage: node tools/bump.cjs <ui|internal|major>[,...] "what changed"');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const cur = data.version.split('.').map(Number);
for (const k of kinds) STEP[k].forEach((n, i) => { cur[i] += n; });
data.version = cur.join('.');
const released = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
data.released = released;
data.history.push({ version: data.version, kinds, note, date: released });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Version is now ${data.version}  (${kinds.join(' + ')}: ${note})`);
