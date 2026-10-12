#!/usr/bin/env node
'use strict';
/*
 * Builds dist/ZenithTavern.cjs: ONE file that contains this whole project.
 * Put that file (plus the Start-panel / Start-console files) in any folder and run it - it unpacks itself
 * and installs everything into that same folder.
 *
 * Run:  node tools/build.cjs
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Only these are bundled (so personal data, SillyTavern/, logs etc. can never leak in).
const INCLUDE = ['src', 'core', 'overlay', 'tools', 'tavern.config.json', 'README.md', 'LICENSE', '.gitignore',
  'Start-panel.bat', 'Start-panel.sh', 'Start-console.bat', 'Start-console.sh', 'Repair.bat', 'Repair.sh'];

function collect(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  if (rel.split(path.sep).join('/').startsWith('core/roster/source')) return; // creator-side source files (portable JSON, originals) are not shipped
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) collect(path.posix.join(rel.split(path.sep).join('/'), name), out);
  } else {
    // pictures (roster cards, expressions) are binary: stored as base64 and decoded on install
    const binary = /\.(png|jpe?g|webp|gif|ico)$/i.test(rel);
    out[rel.split(path.sep).join('/')] = binary ? 'base64:' + fs.readFileSync(abs).toString('base64') : fs.readFileSync(abs, 'utf8');
  }
}

const files = {};
for (const item of INCLUDE) collect(item, files);

const selfUpdatePart = fs.readFileSync(path.join(__dirname, 'selfupdate.part.cjs'), 'utf8');
const builtAt = new Date().toISOString();
let defaultUpdate = { repo: 'higorgaeloliveira-cloud/ZenithTavern', ref: 'main', mode: 'ask' };
try { Object.assign(defaultUpdate, JSON.parse(fs.readFileSync(path.join(ROOT, 'tavern.config.json'), 'utf8')).zenithUpdates || {}); } catch { /* keep defaults */ }

const version = crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 12);

const bundle = `#!/usr/bin/env node
'use strict';
/*
 * ZenithTavern - single-file launcher (bundle ${version}).
 * Run it from any folder: it installs into the folder THIS FILE is in.
 *   node ZenithTavern.cjs            start
 *   node ZenithTavern.cjs --repair   repair
 * (Start-panel / Start-console next to it do the same with a double-click.)
 */
const fs = require('fs');
const path = require('path');

const VERSION = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files)};
const BUILT = ${JSON.stringify(builtAt)};
const DEFAULT_UPDATE = ${JSON.stringify(defaultUpdate)};

// The install folder is wherever this file lives - never the "current directory".
const ROOT = __dirname;

${selfUpdatePart}

function main() {

// src/, core/ and tools/ belong to the launcher and are refreshed when this file is newer.
// Everything else (overlay/, tavern.config.json, ...) is YOURS: written once, never overwritten.
const stampFile = path.join(ROOT, '.bundle-version');
let installed = '';
try { installed = fs.readFileSync(stampFile, 'utf8').trim(); } catch { /* first run */ }

for (const [rel, content] of Object.entries(FILES)) {
  const dest = path.join(ROOT, ...rel.split('/'));
  const managed = rel.startsWith('src/') || rel.startsWith('core/') || rel.startsWith('tools/');
  const write = managed ? (installed !== VERSION || !fs.existsSync(dest)) : !fs.existsSync(dest);
  if (!write) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content.startsWith('base64:') && /\\.(png|jpe?g|webp|gif|ico)$/i.test(rel) ? Buffer.from(content.slice(7), 'base64') : content);
  if (rel.endsWith('.sh')) fs.chmodSync(dest, 0o755);
}

// One-time cleanups of files that older launcher versions put in the wrong place.
if (installed !== VERSION) {
  // zenith-welcome used to live in overlay/; it is launcher-managed now (core/).
  fs.rmSync(path.join(ROOT, 'overlay', 'extensions', 'zenith-welcome'), { recursive: true, force: true });
  // the launcher file was renamed from MyTavern.cjs
  if (path.basename(__filename) !== 'MyTavern.cjs') fs.rmSync(path.join(ROOT, 'MyTavern.cjs'), { force: true });
  // the project name used to default to "MyTavern"
  const cfgFile = path.join(ROOT, 'tavern.config.json');
  try {
    const text = fs.readFileSync(cfgFile, 'utf8');
    if (/"name"\\s*:\\s*"MyTavern"/.test(text)) fs.writeFileSync(cfgFile, text.replace(/"name"\\s*:\\s*"MyTavern"/, '"name": "ZenithTavern"'));
  } catch { /* no config yet */ }
}
fs.writeFileSync(stampFile, VERSION);

require(path.join(ROOT, 'src', process.argv.includes('--repair') ? 'repair.cjs' : 'launcher.cjs'));
}

const updateOnly = process.argv.includes('--update-only');
selfUpdate().then((done) => { if (!done && !updateOnly) main(); }, () => { if (!updateOnly) main(); });
`;

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'ZenithTavern.cjs'), bundle);
fs.writeFileSync(path.join(DIST, 'zenith-version.json'), JSON.stringify({ version, built: builtAt, size: Buffer.byteLength(bundle), sha256: crypto.createHash('sha256').update(bundle).digest('hex') }, null, 2) + '\n');
for (const wrapper of ['Start-panel.bat', 'Start-panel.sh', 'Start-console.bat', 'Start-console.sh', 'Repair.bat', 'Repair.sh']) {
  fs.copyFileSync(path.join(ROOT, wrapper), path.join(DIST, wrapper));
}
console.log(`Built dist/ZenithTavern.cjs (${Object.keys(files).length} files, ${(bundle.length / 1024).toFixed(0)} KB, version ${version})`);
