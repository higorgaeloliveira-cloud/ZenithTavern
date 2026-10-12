#!/usr/bin/env node
'use strict';
/*
 * Adds (or updates) a character in the ZenithTavern roster.
 *   node tools/roster-add.cjs "Kinji.png" --sprites "./kinji-expressions" --tagline "Quiet, sharp-tongued" --tags "campus,slow-burn"
 * Options: --images <folder of pictures used inside messages>  --id <slug>  --file <Name.png>  --version <n>  --thumb <image>  --roster <folder (default core/roster)>
 * The card is a normal SillyTavern character PNG. Sprites are the expression images (neutral.png, joy.png, ...).
 * Every character in the roster must be an ADULT (18+).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i]; else rest.push(args[i]);
}
const cardPath = rest[0];
if (!cardPath || !fs.existsSync(cardPath)) { console.error('Usage: node tools/roster-add.cjs <Card.png> [--sprites dir] [--tagline text] [--tags a,b] [--id slug] [--version n]'); process.exit(1); }

const rosterDir = path.resolve(flags.roster || path.join(__dirname, '..', 'core', 'roster'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function readCard(buf) {
  if (buf.length < 16 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let found = null;
  for (let pos = 8; pos + 12 <= buf.length;) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tEXt') {
      const d = buf.subarray(pos + 8, pos + 8 + len); const nul = d.indexOf(0);
      const key = d.toString('latin1', 0, nul).toLowerCase();
      if (key === 'ccv3' || (key === 'chara' && !found)) { try { found = JSON.parse(Buffer.from(d.toString('latin1', nul + 1), 'base64').toString('utf8')); } catch { /* ignore */ } }
    }
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return found;
}

const card = fs.readFileSync(cardPath);
const data = readCard(card);
const name = String(data?.data?.name ?? data?.name ?? '').trim();
if (!name) { console.error('That PNG has no character card inside it (export it from SillyTavern as PNG).'); process.exit(1); }

const id = (flags.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) { console.error('Could not make an id from the name. Pass --id.'); process.exit(1); }

const dir = path.join(rosterDir, id);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'sprites'), { recursive: true });
fs.writeFileSync(path.join(dir, 'card.png'), card);

const sprites = [];
if (flags.sprites) {
  for (const f of fs.readdirSync(flags.sprites).sort()) {
    if (!/\.(png|webp|gif|jpe?g)$/i.test(f)) continue;
    const buf = fs.readFileSync(path.join(flags.sprites, f));
    fs.writeFileSync(path.join(dir, 'sprites', f), buf);
    sprites.push({ path: `${id}/sprites/${f}`, as: f, sha256: sha(buf) });
  }
}
const images = [];
if (flags.images) {
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  for (const f of fs.readdirSync(flags.images).sort()) {
    if (!/\.(png|webp|gif|jpe?g)$/i.test(f)) continue;
    const buf = fs.readFileSync(path.join(flags.images, f));
    fs.writeFileSync(path.join(dir, 'images', f), buf);
    images.push({ path: `${id}/images/${f}`, as: f, sha256: sha(buf) });
  }
}
let thumb;
if (flags.thumb) { const ext = path.extname(flags.thumb); fs.copyFileSync(flags.thumb, path.join(dir, 'thumb' + ext)); thumb = `${id}/thumb${ext}`; }

const file = path.join(rosterDir, 'roster.json');
const roster = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, characters: [] };
const entry = {
  id, name, file: flags.file || `${name.replace(/[\\/:*?"<>|]/g, '')}.png`,
  tagline: flags.tagline || String(data?.data?.creator_notes || '').split('\n')[0].slice(0, 120),
  tags: (flags.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
  version: Number(flags.version) || 1,
  card: `${id}/card.png`, sha256: sha(card), ...(thumb ? { thumb } : {}), sprites, ...(images.length ? { images } : {}),
};
const i = roster.characters.findIndex((c) => c.id === id);
if (i >= 0) { entry.version = Number(flags.version) || (roster.characters[i].version || 1) + 1; roster.characters[i] = entry; } else roster.characters.push(entry);
fs.mkdirSync(rosterDir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(roster, null, 2) + '\n');
console.log(`${i >= 0 ? 'Updated' : 'Added'} "${name}" (id ${id}, ${sprites.length} expression image(s)) in ${rosterDir}`);
console.log('Reminder: every roster character must be an adult (18+).');
