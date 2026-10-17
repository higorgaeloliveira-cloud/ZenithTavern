#!/usr/bin/env node
'use strict';
/*
 * Builds a ZenithTavern roster character from its portable record (the *.json made for the project).
 *
 *   node tools/character-build.cjs core/roster/source/mara-venn
 *
 * The folder holds:   character.json   portrait.png   images/ (pictures used inside messages)   sprites/ (expression images, optional)
 * It writes a SillyTavern character card (PNG with the card embedded, V2 + V3) and adds it to core/roster/roster.json
 * through tools/roster-add.cjs. Run it again whenever character.json, the portrait, images or sprites change:
 * the roster version goes up and players see "Update available" in the Roster-Downloader.
 * Every roster character must be an adult (18+); the builder refuses anything else.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(dir, 'character.json'))) { console.error('Usage: node tools/character-build.cjs <folder with character.json and portrait.png>'); process.exit(1); }
const rec = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8'));
const portrait = path.join(dir, 'portrait.png');
if (!fs.existsSync(portrait)) { console.error('portrait.png is missing in ' + dir); process.exit(1); }
if (!(Number(rec.identity?.age) >= 18)) { console.error(`Refusing to build "${rec.name}": the character must be a clear adult (18+). identity.age is ${rec.identity?.age}.`); process.exit(1); }

const { describe } = require('./character-text.cjs');
const { description, list } = describe(rec);
const id = rec.identity || {};
const extra = rec.card || {};   // optional: scenario, system_prompt, post_history_instructions, mes_example
const bookPath = path.join(dir, 'lorebook.json'); // optional: embedded lorebook (SillyTavern character_book)
const book = fs.existsSync(bookPath) ? JSON.parse(fs.readFileSync(bookPath, 'utf8')) : null;
const g = rec.greetings || {};
const firstMes = g.standard?.text || '';
const alternates = [g.dating?.text, g.custom_scenario?.text].filter(Boolean);
const tags = ['Asterhaven', 'ZenithTavern', 'university', ...list(rec.tags)];
const v2 = {
  spec: 'chara_card_v2', spec_version: '2.0',
  data: {
    name: rec.name, description, personality: '', scenario: extra.scenario || '', first_mes: firstMes, mes_example: extra.mes_example || '',
    creator_notes: rec.tagline || '',
    system_prompt: extra.system_prompt || '', post_history_instructions: extra.post_history_instructions || '', ...(book ? { character_book: book } : {}), alternate_greetings: alternates, tags,
    creator: 'ZenithTavern', character_version: String(rec.schema_version || '1.0'),
    extensions: { talkativeness: '0.5', fav: false, world: book ? book.name : '', depth_prompt: { prompt: '', depth: 4, role: 'system' }, zenith: { id: rec.id } },
  },
};
const v3 = JSON.parse(JSON.stringify(v2)); v3.spec = 'chara_card_v3'; v3.spec_version = '3.0';
Object.assign(v3.data, { group_only_greetings: [], nickname: '', source: [], creation_date: Math.floor(Date.now() / 1000), modification_date: Math.floor(Date.now() / 1000) });
Object.assign(v2, { name: v2.data.name, description: v2.data.description, personality: '', scenario: extra.scenario || '', first_mes: firstMes, mes_example: extra.mes_example || '' });

// ---- PNG: drop old text chunks, add chara (v2) + ccv3 (v3) before IEND
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
const textChunk = (key, value) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(Buffer.from(JSON.stringify(value), 'utf8').toString('base64'), 'latin1')]));

const src = fs.readFileSync(portrait);
if (src.readUInt32BE(0) !== 0x89504e47) { console.error('portrait.png is not a PNG'); process.exit(1); }
const out = [src.subarray(0, 8)];
for (let pos = 8; pos + 12 <= src.length;) {
  const len = src.readUInt32BE(pos); const type = src.toString('latin1', pos + 4, pos + 8);
  const whole = src.subarray(pos, pos + 12 + len);
  if (type === 'IEND') { out.push(textChunk('chara', v2), textChunk('ccv3', v3), whole); break; }
  if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') out.push(whole);
  pos += 12 + len;
}
const cardPath = path.join(dir, 'card.build.png');
fs.writeFileSync(cardPath, Buffer.concat(out));

// ---- into the roster
const args = [path.join(__dirname, 'roster-add.cjs'), cardPath, '--id', String(rec.id).replace(/_/g, '-'), '--file', `${rec.name.replace(/[\\/:*?"<>|]/g, '')}.png`];
if (fs.existsSync(path.join(dir, 'images'))) args.push('--images', path.join(dir, 'images'));
if (fs.existsSync(path.join(dir, 'sprites'))) args.push('--sprites', path.join(dir, 'sprites'));
if (rec.tagline) args.push('--tagline', rec.tagline);
args.push('--tags', tags.join(','));
if (process.argv.includes('--roster')) args.push('--roster', process.argv[process.argv.indexOf('--roster') + 1]);
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
fs.rmSync(cardPath, { force: true });
process.exit(r.status ?? 1);
