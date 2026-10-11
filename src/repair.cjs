#!/usr/bin/env node
'use strict';
/*
 * Repair tool. Fixes "it won't start" problems by throwing away the downloaded SillyTavern
 * copy and getting a fresh one. Your chats, characters and settings live in userdata/ and
 * config/, which this tool never deletes - it backs them up first anyway.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');
const { C } = L;
L.setDefaultMode('console'); // repair shows everything unless you pass --panel

async function main() {
  L.banner('repair');
  if (!L.checkNode() || !L.checkGit()) return;

  L.say('  This will:');
  L.say(`   1. back up your data (userdata/ and config/) into backups/`);
  L.say(`   2. delete the downloaded SillyTavern folder and download a fresh copy`);
  L.say(`   3. reinstall its packages and re-add your extensions/plugins`);
  L.say();
  if (!(await L.yesNo('Continue?', 'Y'))) { L.info('Cancelled. Nothing was changed.'); return; }

  if (!(await L.portIsFree(L.cfg.port))) {
    L.fail(`Port ${L.cfg.port} is in use - close ${L.cfg.name} first, then run Repair again.`);
    return;
  }

  // 1. backup
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(L.BACKUP_DIR, stamp);
  fs.mkdirSync(dest, { recursive: true });
  for (const dir of [L.USERDATA_DIR, L.CONFIG_DIR]) {
    if (fs.existsSync(dir)) fs.cpSync(dir, path.join(dest, path.basename(dir)), { recursive: true });
  }
  L.ok(`Backup saved: backups/${stamp}`);

  // 2. wipe + re-download
  fs.rmSync(L.ST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  fs.rmSync(path.join(L.ROOT, '.state.json'), { force: true });
  if (!L.cloneUpstream()) { L.fail('Download failed. Check your internet connection and run Repair again.'); return; }
  L.ok('Fresh SillyTavern downloaded.');

  // 3. reinstall
  if (!L.installDependencies({ force: true })) { L.fail('Package install failed. Run Repair again once your connection is stable.'); return; }
  L.ok('Packages reinstalled.');
  L.syncOverlay();
  L.patchConfig();
  L.ok('Your extensions/plugins and settings were re-applied.');

  L.say();
  L.say(`  ${C.green}${C.bold}Repair finished.${C.reset} Start ${L.cfg.name} as usual.`);
}

main().catch((e) => L.fail(`Repair failed: ${e.message}`)).finally(() => L.closePrompt());
