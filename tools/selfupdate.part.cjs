// ---- ZenithTavern self-update: checks the project's GitHub repo for a newer launcher ---------------------------
// Runs first, before anything is unpacked. Offline, blocked, or no newer version => it silently does nothing.
// Settings (tavern.config.json): "zenithUpdates": { "repo": "owner/name", "ref": "main", "mode": "ask" | "auto" | "off" }
async function selfUpdate() {
  const args = process.argv.slice(2);
  if (process.env.ZENITH_SKIP_UPDATE === '1' || args.includes('--no-update') || args.includes('--smoke-test') || args.includes('--repair')) return false;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tavern.config.json'), 'utf8')); } catch { /* first run: defaults */ }
  const u = Object.assign({}, DEFAULT_UPDATE, cfg.zenithUpdates || {});
  if (u.mode === 'off' || !/^[\w.-]+\/[\w.-]+$/.test(String(u.repo)) || !/^[\w./-]+$/.test(String(u.ref))) return false;
  const base = process.env.ZENITH_UPDATE_BASE || `https://raw.githubusercontent.com/${u.repo}/${u.ref}/dist/`; // the env variable is a test hook
  const only = args.includes('--update-only');

  let meta;
  try {
    const res = await fetch(`${base}zenith-version.json?t=${Date.now()}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) { console.log(`  • ZenithTavern update check: no update information (HTTP ${res.status}).`); return false; }
    meta = await res.json();
  } catch (e) { console.log('  • ZenithTavern update check: could not reach GitHub (' + (e && e.message || e) + '). Continuing.'); return false; }
  if (!meta || typeof meta.version !== 'string' || !/^[a-f0-9]{64}$/.test(String(meta.sha256))) return false;
  if (meta.version === VERSION || !(Date.parse(meta.built) > Date.parse(BUILT))) { console.log('  ✔ ZenithTavern is up to date.'); return false; }

  const when = new Date(meta.built).toLocaleString();
  if (u.mode !== 'auto') {
    if (!process.stdin.isTTY) { console.log('  • A newer ZenithTavern exists but this window cannot ask. Use Start-console to update.'); return false; }
    const answer = await new Promise((resolve) => {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      const timer = setTimeout(() => { rl.close(); resolve('n'); }, 30000);
      rl.question(`\nA newer ZenithTavern is available (${when}). Update now? [Y/n] `, (a) => { clearTimeout(timer); rl.close(); resolve(a.trim().toLowerCase()); });
    });
    if (answer && !/^y/.test(answer)) { console.log('Okay, staying on the current version.'); return false; }
  }

  try {
    console.log(`Updating ZenithTavern (${when})...`);
    const res = await fetch(`${base}ZenithTavern.cjs?t=${Date.now()}`, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (require('crypto').createHash('sha256').update(buf).digest('hex') !== meta.sha256) throw new Error('the download did not match its checksum');
    const text = buf.toString('utf8');
    if (!text.includes('ZenithTavern - single-file launcher') || !text.includes(JSON.stringify(meta.version))) throw new Error('the download is not a ZenithTavern launcher');
    const tmp = `${__filename}.update`;
    fs.writeFileSync(tmp, buf);
    try { fs.renameSync(tmp, __filename); } catch { fs.copyFileSync(tmp, __filename); fs.rmSync(tmp, { force: true }); }
    console.log('Updated. Starting the new version...\n');
  } catch (e) {
    console.log(`Could not update (${e && e.message || e}). Continuing with the current version.`);
    return false;
  }
  if (only) return true;
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename, ...args], { stdio: 'inherit', env: { ...process.env, ZENITH_SKIP_UPDATE: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}
