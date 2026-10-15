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
 * Each part counts from 0 to 20. One step past 20 carries into the part on its left and the part itself goes back to 0:
 * 0.13.20 + ui = 0.14.0, and 0.20.x + internal = 1.0.x. A higher number is still always the newer version.
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
// carry: every part holds 0..20; 21 becomes 0 and adds one to the part on its left
for (let i = cur.length - 1; i > 0; i--) while (cur[i] > 20) { cur[i] -= 21; cur[i - 1] += 1; }
data.version = cur.join('.');
const released = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
data.released = released;
data.history.push({ version: data.version, kinds, note, date: released });
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Version is now ${data.version}  (${kinds.join(' + ')}: ${note})`);
