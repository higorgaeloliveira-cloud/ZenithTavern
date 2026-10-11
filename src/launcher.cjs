#!/usr/bin/env node
'use strict';
/*
 * The launcher. Double-click Start-panel.bat or Start-console.bat (Windows), or run ./Start-panel.sh / ./Start-console.sh (Mac/Linux).
 *
 * Steps: check tools -> download SillyTavern if missing -> offer updates -> install packages
 * -> copy our extension/plugin in -> write config -> start the server -> open the browser.
 *
 * Looks: --panel (default, clean screen)  --console (shows every step, command and server line)
 * Flags: --yes (accept defaults, ask nothing)   --no-browser   --no-update
 *        --stay (keep running without waiting for Enter, for non-interactive use)
 *        --smoke-test (start, run self-checks, stop, exit with a pass/fail code)
 */
const L = require('./lib.cjs');
const { C, cfg } = L;

const smoke = process.argv.includes('--smoke-test');
const consoleMode = () => L.getMode() === 'console';
const fs = require('fs');
const path = require('path');
let server = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (server) L.killTree(server.child.pid);
  L.closePrompt();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => { L.say(); L.info('Shutting down...'); stop(0); });
process.on('SIGTERM', () => stop(0));

async function updateStep() {
  if (process.argv.includes('--no-update') || cfg.upstream.updates === 'never') return;
  L.info(consoleMode() ? 'Checking for SillyTavern updates...' : 'Checking for updates...');
  const result = L.checkUpstreamUpdate();
  if (!result) { L.warn('Could not check for updates (offline?). Continuing with what you have.'); return; }
  if (!result.changed) {
    const stVersion = stVersionText();
    L.ok(consoleMode()
      ? `SillyTavern is up to date ${C.dim}(${result.current.slice(0, 7)})${C.reset}`
      : `${cfg.name} is up to date. ${C.dim}(SillyTavern ${stVersion}${stVersion ? ' · ' : ''}${result.current.slice(0, 7)})${C.reset}`);
    return;
  }

  L.say(`     ${C.dim}installed ${result.current.slice(0, 7)} → available ${result.latest.slice(0, 7)}${C.reset}`);
  const apply = cfg.upstream.updates === 'auto' || await L.yesNo('A SillyTavern update is available. Install it?', 'Y');
  if (!apply) { L.info('Skipping the update.'); return; }
  if (L.applyUpstreamUpdate()) L.ok('Updated.');
  else L.warn('Update failed. If things break later, run Repair.');
}

let restarts = 0;

function stVersionText() {
  try { return JSON.parse(fs.readFileSync(path.join(L.ST_DIR, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

/** Shown when a step fails: the reason, plus where the hidden details are. */
function failWithDetails(message) {
  L.fail(message);
  if (!consoleMode()) {
    L.say(`     ${C.dim}Details (logs/launcher.log):${C.reset}`);
    L.say(`${C.dim}${L.tailLauncherLog()}${C.reset}`);
  }
}

/** Starts the server, waits for it, prints the banner and watches it. Returns false if it never came up. */
async function boot() {
  server = L.startServer({ noBrowser: restarts > 0 }); // don't open a new tab on every restart
  const up = await L.waitForServer(server.child);
  if (!up) {
    L.fail('The server did not start. Last lines of logs/server.log:');
    L.say(`${C.dim}${L.tailLog(server.logFile)}${C.reset}`);
    stop(1);
    return false;
  }

  L.say();
  L.say(`  ${C.green}${C.bold}● ${cfg.name} is running${C.reset}  →  http://localhost:${cfg.port}`);
  if (cfg.network?.multiIp) {
    const ips = (cfg.network.ips || []).join(', ') || 'none yet';
    L.say(`  ${C.accent}Multi-IP is ON${C.reset}  allowed devices: ${ips}`);
    for (const a of L.lanAddresses()) L.say(`  ${C.dim}this computer is also at http://${a}:${cfg.port}${C.reset}`);
  }
  L.say(`  ${C.dim}Logs: logs/server.log${consoleMode() ? '' : ' · logs/launcher.log'}${C.reset}`);
  L.say();

  server.child.on('exit', async (code) => {
    if (stopping) return;
    if (code === 42) { // the server plugin uses 42 for "the user answered No on the first-run notice"
      L.say();
      L.info(`Confirmation declined. Closing ${cfg.name}...`);
      await L.sleep(2500);
      return stop(0);
    }
    if (code === 43) { // 43 = "restart me" (the Network settings ask for this to apply changes)
      L.say();
      L.info('Restarting to apply your changes...');
      restarts++;
      try { L.reloadConfig(); L.patchConfig(); } catch (e) { L.warn(`Could not re-read settings: ${e.message}`); }
      await L.sleep(800);
      await boot();
      return;
    }
    L.fail(`The server stopped unexpectedly (code ${code}). Last lines of logs/server.log:`);
    L.say(`${C.dim}${L.tailLog(server.logFile)}${C.reset}`);
    stop(1);
  });
  return true;
}

async function main() {
  if (consoleMode()) {
    L.banner(smoke ? 'self-check (console)' : 'launcher (console)');
    L.detail(`${cfg.name} v${L.VERSION} · Node ${process.versions.node} · ${L.platformName()} (${process.platform}/${process.arch})`);
    L.detail(`Install folder: ${L.ROOT}`);
    L.detail(`Options: ${process.argv.slice(2).join(' ') || '(none)'}`);
    L.say();
  } else {
    L.panelHeader();
  }
  L.plog(`${cfg.name} v${L.VERSION} starting on ${L.platformName()}`);
  L.info(`Detected platform: ${C.accent}${L.platformName()}${C.reset}`);

  if (!L.checkNode() || !L.checkGit()) return stop(1);

  if (!L.upstreamExists()) {
    if (!L.cloneUpstream()) { failWithDetails('Could not download SillyTavern. Check your internet connection and try again.'); return stop(1); }
    L.ok('SillyTavern downloaded.');
  } else {
    await updateStep();
  }

  if (!consoleMode()) L.say(`\n  ${C.dim}${'─'.repeat(44)}${C.reset}\n`);
  if (!L.installDependencies()) { failWithDetails('Installing packages failed. Run Repair, or check your internet connection.'); return stop(1); }
  L.ok(consoleMode() ? 'Packages ready.' : 'Dependencies ready.');

  const copied = L.syncOverlay();
  L.detail(`Added your files: ${copied.length ? copied.join(', ') : '(none)'}`);
  const worlds = L.installWorlds();
  L.detail(`World Info added: ${worlds.length ? worlds.join(', ') : '(nothing new)'}`);
  const themes = L.installThemes();
  L.detail(`Themes added: ${themes.length ? themes.join(', ') : '(nothing new)'}`);
  L.patchConfig();
  L.detail(`Settings written to config/config.yaml (port ${cfg.port}, listen ${!!cfg.listen || !!cfg.network?.multiIp})`);

  if (!(await L.portIsFree(cfg.port))) {
    L.fail(`Port ${cfg.port} is already in use. Is ${cfg.name} (or another SillyTavern) already running?`);
    L.say(`     ${C.dim}Close it, or change "port" in tavern.config.json.${C.reset}`);
    return stop(1);
  }

  L.info('Starting the server... (the very first start can take a few minutes)');
  if (!(await boot())) return;

  if (smoke) return stop(await smokeTest());

  if (process.argv.includes('--stay')) return new Promise(() => {}); // runs until the server exits
  await L.ask(`  ${C.dim}Press Enter to shut down.${C.reset}`, '');
  stop(0);
}

/** Verifies that our extension and server plugin were really picked up. */
async function smokeTest() {
  let failures = 0;
  const check = (name, pass, detail = '') => {
    if (pass) L.ok(name); else { failures++; L.fail(`${name} ${detail}`); }
  };

  const manifest = await L.httpGet('/scripts/extensions/third-party/zenith-branding/manifest.json');
  check('Extension files are being served', manifest?.status === 200, `(HTTP ${manifest?.status})`);

  const ping = await L.httpGet('/api/plugins/zenith-system/ping');
  let pong = null;
  try { pong = JSON.parse(ping?.body); } catch { /* not json */ }
  check('Server plugin (zenith-system) answers /ping', ping?.status === 200 && pong?.ok === true, `(HTTP ${ping?.status})`);

  const page = await L.httpGet('/');
  check('Main page loads', page?.status === 200, `(HTTP ${page?.status})`);

  L.say();
  L[failures ? 'fail' : 'ok'](failures ? `${failures} check(s) failed.` : 'All checks passed.');
  return failures ? 1 : 0;
}

main().catch((err) => {
  L.fail(`Unexpected error: ${err.message}`);
  stop(1);
});
