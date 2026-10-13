'use strict';
/*
 * Shared helpers for the launcher and the repair tool.
 * Zero dependencies on purpose: this runs BEFORE SillyTavern's packages are installed.
 */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const readline = require('readline');
const os = require('os');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const ST_DIR = path.join(ROOT, 'SillyTavern');
const OVERLAY_DIR = path.join(ROOT, 'overlay'); // YOUR files
const CORE_DIR = path.join(ROOT, 'core');       // launcher-managed files (refreshed on launcher updates)
const USERDATA_DIR = path.join(ROOT, 'userdata');
const CONFIG_DIR = path.join(ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const LOG_DIR = path.join(ROOT, 'logs');
const BACKUP_DIR = path.join(ROOT, 'backups');
const STATE_FILE = path.join(ROOT, '.state.json');

const CFG_FILE = path.join(ROOT, 'tavern.config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
/** Re-read tavern.config.json (the in-app Network settings change it while the server runs). */
function reloadConfig() {
  const fresh = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  for (const k of Object.keys(cfg)) delete cfg[k];
  Object.assign(cfg, fresh);
}
/** IPv4 addresses of this computer, for telling the user where other devices can connect. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

// ---------- pretty output ----------
const tty = process.stdout.isTTY;
const c = (code) => (tty ? `\x1b[${code}m` : '');
const C = { reset: c(0), dim: c(90), red: c(31), green: c(32), yellow: c(33), accent: c('38;5;221'), bold: c(1) };
const say = (msg = '') => console.log(msg);
const ok = (msg) => say(`  ${C.green}✔${C.reset} ${msg}`);
const info = (msg) => say(`  ${C.accent}•${C.reset} ${msg}`);
const warn = (msg) => say(`  ${C.yellow}!${C.reset} ${msg}`);
const fail = (msg) => say(`  ${C.red}✘${C.reset} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- display modes ----------
// panel   = clean screen: logo, version, platform, update check, keep-open notice. Nothing else.
// console = the same steps, plus every command, download, file written and the live server output.
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'core', 'version.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
let MODE = process.argv.includes('--console') ? 'console' : 'panel';
/** Mode used when the user passed neither --panel nor --console. */
function setDefaultMode(m) {
  if (!process.argv.includes('--console') && !process.argv.includes('--panel')) MODE = m;
}
const getMode = () => MODE;

// Everything that is hidden in panel mode is still written to logs/launcher.log.
let launcherLogFd = null;
function launcherLogFile() { return path.join(LOG_DIR, 'launcher.log'); }
function logFd() {
  if (launcherLogFd === null) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(launcherLogFile(), ''); // fresh file for each launch
    launcherLogFd = fs.openSync(launcherLogFile(), 'a');
  }
  return launcherLogFd;
}
function plog(msg) {
  try { fs.writeSync(logFd(), `[${new Date().toISOString()}] ${msg}\n`); } catch { /* logging must never break the launcher */ }
}
/** A line only the console mode shows (always kept in logs/launcher.log). */
function detail(msg) {
  plog(msg);
  if (MODE === 'console') say(`    ${C.dim}${msg}${C.reset}`);
}
function trace(cmd, args, cwd) {
  const where = cwd && path.resolve(cwd) !== ROOT ? `   (in ${path.relative(ROOT, cwd) || '.'})` : '';
  plog(`$ ${[cmd, ...args].join(' ')}${where}`);
  if (MODE === 'console') say(`  ${C.dim}$ ${[cmd, ...args].join(' ')}${where}${C.reset}`);
}
function tailLauncherLog(lines = 14) {
  try { return fs.readFileSync(launcherLogFile(), 'utf8').trim().split('\n').slice(-lines).join('\n'); } catch { return '(no details yet)'; }
}

function platformName() {
  if (process.env.TERMUX_VERSION || (process.env.PREFIX || '').includes('com.termux')) return 'Android (Termux)';
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'linux') return 'Linux';
  return process.platform;
}

// ---------- questions ----------
let rl = null;
function ask(question, def) {
  if (process.argv.includes('--yes') || !process.stdin.isTTY) return Promise.resolve(def);
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => resolve((a || '').trim() || def)));
}
async function yesNo(question, def = 'Y') {
  const a = await ask(`  ${C.accent}?${C.reset} ${question} (Y/N) [${def}] `, def);
  return a.toUpperCase().startsWith('Y');
}
function closePrompt() { if (rl) { rl.close(); rl = null; } }

// ---------- running programs ----------
/** Run a program and return trimmed stdout, or null if it failed. */
function capture(cmd, args, cwd = ROOT) {
  trace(cmd, args, cwd);
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `exit ${r.status}${r.stderr ? ': ' + r.stderr.trim().split('\n')[0] : ''}`;
    detail(`  -> failed (${why})`);
    return null;
  }
  const out = (r.stdout || '').trim();
  if (out) detail(`  -> ${out.split('\n')[0].slice(0, 100)}`);
  return out;
}
const git = (args, cwd = ROOT) => capture('git', args, cwd);

/** Run a program with its output visible. Returns true on success. */
function runVisible(cmd, args, cwd = ROOT, extra = {}) {
  trace(cmd, args, cwd);
  // console: you watch the output. panel: it goes to logs/launcher.log instead.
  const stdio = MODE === 'console' ? 'inherit' : ['ignore', logFd(), logFd()];
  const r = spawnSync(cmd, args, { cwd, stdio, shell: process.platform === 'win32' && cmd === 'npm', ...extra });
  const good = !r.error && r.status === 0;
  plog(good ? '  -> done' : `  -> failed (${r.error ? r.error.message : 'exit ' + r.status})`);
  return good;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

// ---------- state ----------
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
}

// ---------- checks ----------
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    fail(`Node.js ${process.versions.node} is too old. SillyTavern needs Node 20 or newer (the LTS version is best).`);
    return false;
  }
  return true;
}
function checkGit() {
  if (git(['--version']) === null) {
    fail('Git is not installed. Install it from https://git-scm.com and try again.');
    return false;
  }
  return true;
}
function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

// ---------- upstream SillyTavern ----------
const upstreamExists = () => fs.existsSync(path.join(ST_DIR, 'server.js'));

/** Download SillyTavern (first run, or after a repair wiped it). */
function cloneUpstream() {
  const { repo, ref } = cfg.upstream;
  info(`Downloading SillyTavern (${ref}) - this can take a minute...`);
  fs.mkdirSync(ST_DIR, { recursive: true });
  return runVisible('git', ['clone', '--depth', '1', '--branch', ref, repo, ST_DIR]);
}

/**
 * Check for a newer upstream version. Returns { current, latest } short hashes,
 * or null if we could not tell. Never changes anything.
 */
function checkUpstreamUpdate() {
  const { ref } = cfg.upstream;
  const current = git(['rev-parse', 'HEAD'], ST_DIR);
  if (!current) return null;
  if (git(['fetch', '--depth', '1', 'origin', ref], ST_DIR) === null) return null;
  const latest = git(['rev-parse', 'FETCH_HEAD'], ST_DIR);
  if (!latest) return null;
  return { current, latest, changed: current !== latest };
}

/**
 * Move SillyTavern to what we just fetched. Safe because we never edit files inside
 * SillyTavern/ that git tracks (our files are copied into folders git ignores).
 */
function applyUpstreamUpdate() {
  return git(['reset', '--hard', 'FETCH_HEAD'], ST_DIR) !== null;
}

function lockHash() {
  const f = path.join(ST_DIR, 'package-lock.json');
  if (!fs.existsSync(f)) return 'none';
  return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
}

/** Install SillyTavern's packages. Skipped when nothing changed since last time. */
function installDependencies({ force = false } = {}) {
  const hash = lockHash();
  const needed = force || !fs.existsSync(path.join(ST_DIR, 'node_modules')) || readState().lockHash !== hash;
  if (!needed) return true;
  info(MODE === 'console' ? 'Installing SillyTavern packages (first time can take a few minutes)...' : 'Preparing dependencies... (first run can take a few minutes)');
  const good = runVisible('npm', ['install', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error'], ST_DIR, {
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (good) writeState({ lockHash: hash });
  return good;
}

// ---------- world info ----------
/** Adds the lorebooks from core/worlds and overlay/worlds to SillyTavern (never overwrites existing ones). */
function installWorlds() {
  const { installWorlds: install } = require('./worlds.cjs');
  return install({
    roots: [path.join(CORE_DIR, 'worlds'), path.join(OVERLAY_DIR, 'worlds')],
    destDir: path.join(USERDATA_DIR, 'default-user', 'worlds'),
  });
}

// ---------- themes ----------
/**
 * Adds the themes from core/themes and overlay/themes to SillyTavern's theme list (never overwrites:
 * if you edit "Zenith Gold" inside SillyTavern your version stays; rename it to keep it safe from anything else).
 */
function installThemes() {
  const destDir = path.join(USERDATA_DIR, 'default-user', 'themes');
  const added = [];
  for (const dir of [path.join(CORE_DIR, 'themes'), path.join(OVERLAY_DIR, 'themes')]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'))) {
      const dest = path.join(destDir, file);
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(path.join(dir, file), dest);
      added.push(file.replace(/\.json$/i, ''));
    }
  }
  return added;
}

// ---------- our own files ----------
/**
 * Copy extensions/ and plugins/ from overlay/ (yours) and core/ (managed) into the places
 * SillyTavern loads them from. core/ goes LAST so a managed file always beats a stale copy.
 */
function syncOverlay() {
  const extDest = path.join(ST_DIR, 'public', 'scripts', 'extensions', 'third-party');
  const plugDest = path.join(ST_DIR, 'plugins');
  const targets = [
    [path.join(OVERLAY_DIR, 'extensions'), extDest],
    [path.join(OVERLAY_DIR, 'plugins'), plugDest],
    [path.join(CORE_DIR, 'extensions'), extDest],
    [path.join(CORE_DIR, 'plugins'), plugDest],
  ];
  const copied = [];
  for (const [from, to] of targets) {
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dest = path.join(to, entry.name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(from, entry.name), dest, { recursive: true });
      copied.push(entry.name);
    }
  }
  return copied;
}

/**
 * Make sure config/config.yaml exists and contains the values from tavern.config.json.
 * Uses SillyTavern's own YAML library so the file's comments are kept.
 */
function patchConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) fs.copyFileSync(path.join(ST_DIR, 'default', 'config.yaml'), CONFIG_FILE);

  const requireFromST = createRequire(path.join(ST_DIR, 'package.json'));
  const YAML = requireFromST('yaml');
  const text = fs.readFileSync(CONFIG_FILE, 'utf8');
  const doc = YAML.parseDocument(text);

  // Multi-IP (Settings > Network): listen on the network and allow the extra IPs
  const net = cfg.network || {};
  const multi = !!net.multiIp;
  const wanted = {
    port: cfg.port,
    listen: !!cfg.listen || multi,
    'browserLaunch.enabled': cfg.openBrowser, // --no-browser is applied per-run in startServer, never saved
    ...cfg.stConfig,
  };
  if (multi) {
    const extra = (Array.isArray(net.ips) ? net.ips : []).filter((x) => typeof x === 'string' && x.trim());
    wanted.whitelistMode = true;
    wanted.whitelist = [...new Set(['::1', '127.0.0.1', ...extra])];
    writeState({ networkManaged: true });
  } else if (readState().networkManaged) {
    wanted.whitelist = ['::1', '127.0.0.1']; // undo what we added, once
    writeState({ networkManaged: false });
  }
  for (const [key, value] of Object.entries(wanted)) doc.setIn(key.split('.'), value);

  const out = doc.toString();
  if (out !== text) fs.writeFileSync(CONFIG_FILE, out);
}

// ---------- the server ----------
function startServer({ noBrowser = false } = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, 'server.log');
  if (fs.existsSync(logFile)) fs.copyFileSync(logFile, path.join(LOG_DIR, 'server.previous.log'));
  const out = fs.openSync(logFile, 'w');

  const args = ['server.js', '--configPath', CONFIG_FILE, '--dataRoot', USERDATA_DIR, '--port', String(cfg.port)];
  if (noBrowser || process.argv.includes('--no-browser')) args.push('--browserLaunchEnabled', 'false');
  trace(process.execPath, args, ST_DIR);
  const child = spawn(process.execPath, args, {
    cwd: ST_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  // Always saved to logs/server.log (the in-app Log Terminal reads it); console mode also prints it live.
  const sink = (d) => {
    try { fs.writeSync(out, d); } catch { /* file closed */ }
    if (MODE === 'console') {
      const text = String(d).replace(/\r?\n$/, '');
      if (text) process.stdout.write(text.split(/\r?\n/).map((l) => `  ${C.dim}server │${C.reset} ${l}`).join('\n') + '\n');
    }
  };
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);
  return { child, logFile };
}

function httpGet(pathname, port = cfg.port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function waitForServer(child, seconds = 600) {
  for (let i = 0; i < seconds / 2; i++) {
    if (child.exitCode !== null) return false;
    const res = await httpGet('/csrf-token');
    if (res && res.status === 200) return true;
    await sleep(2000);
  }
  return false;
}

function tailLog(file, lines = 15) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n'); } catch { return '(no log yet)'; }
}

const FONT = {
  Z: ['█████', '   █ ', '  █  ', ' █   ', '█████'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
};
function logoLines(word = 'ZENITH') {
  const shades = [178, 214, 220, 221, 228]; // gold, dark to light
  return shades.map((shade, row) => {
    const text = [...word].map((ch) => (FONT[ch] || FONT.Z)[row]).join(' ');
    return `  ${tty ? `\x1b[38;5;${shade}m` : ''}${text}${C.reset}`;
  });
}

/** The clean start screen (panel mode). */
function panelHeader() {
  if (tty) process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear the window
  say();
  for (const line of logoLines()) say(line);
  say();
  say(`  ${C.dim}──────  ${C.reset}${C.accent}T A V E R N${C.reset}${C.dim}  ──────${C.reset}`);
  say(`  ${C.dim}V${VERSION}${C.reset}`);
  say();
  say(`  ${C.yellow}▌${C.reset} Keep this window open while using`);
  say(`  ${C.yellow}▌${C.reset} ${cfg.name}. Closing it shuts down`);
  say(`  ${C.yellow}▌${C.reset} the server.`);
  say();
}

function banner(title) {
  say();
  say(`  ${C.accent}${C.bold}${cfg.name}${C.reset} ${C.dim}${title}${C.reset}`);
  say(`  ${C.dim}${'─'.repeat(44)}${C.reset}`);
}

module.exports = {
  VERSION, setDefaultMode, getMode, plog, detail, tailLauncherLog, launcherLogFile, platformName, panelHeader,
  reloadConfig, lanAddresses, ROOT, ST_DIR, USERDATA_DIR, CONFIG_DIR, CONFIG_FILE, LOG_DIR, BACKUP_DIR, cfg, C,
  say, ok, info, warn, fail, sleep, ask, yesNo, closePrompt, git, runVisible, killTree,
  readState, writeState, checkNode, checkGit, portIsFree, upstreamExists, cloneUpstream,
  checkUpstreamUpdate, applyUpstreamUpdate, installDependencies, syncOverlay, installWorlds, installThemes, patchConfig,
  startServer, httpGet, waitForServer, tailLog, banner,
};
