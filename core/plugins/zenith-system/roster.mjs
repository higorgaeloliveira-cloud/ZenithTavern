/*
 * Zenith Roster - "strict characters" + the Roster-Downloader (server side).
 * Managed by the launcher (refreshed on every launcher update). Imported by index.mjs.
 *
 *  STRICT: this fork only accepts the characters it ships. The server refuses
 *    - character import (file, URL, UUID, drag and drop - they all end in these endpoints)
 *    - character export
 *    - creating / duplicating cards (create can be re-enabled with characters.allowCreate)
 *  and /api/characters/all only lists cards that were installed by the Roster-Downloader.
 *  The guards are put in FRONT of SillyTavern's own routers, so no SillyTavern file is edited.
 *
 *  ROSTER: the catalogue (core/roster/roster.json + one folder per character with card.png, sprites/, images/ and sets/) is the copy
 *  that ships INSIDE the launcher. Updating the launcher updates the roster.
 *  Optional: tavern.config.json -> "roster": { "remote": "https://..." } reads the catalogue from a web address instead (a storage Worker,
 *  see community/worker.js; every file is then checked against its sha256). If that address cannot be reached, or it is empty,
 *  the bundled copy is used and the list says so ("fallback"). Leave "remote" empty (the default) to use only the bundled copy.
 *  Nothing is loaded automatically. "Download" copies the card and its expression sprites into the user's own data folder
 *  and records it in <user data>/zenith-roster/installed.json.
 *
 *  OUTFITS: a character can have several outfits ("sets"), each one a zip of expression images (casual.zip, lingerie.zip ...).
 *  All of them are unpacked into <user data>/zenith-roster/sets/<id>/<set>/ and the ACTIVE one is copied into characters/<Name>/,
 *  where SillyTavern's Expressions look for sprites. POST /roster/outfit switches the active one. The zip is read by a small
 *  reader below (stored and deflated entries only; only image files; folders inside the zip are ignored; size limits).
 *
 *  UPDATES: every download records which files it wrote. When a newer version no longer has some of
 *  them (a removed sprite, a renamed card), they are listed as "outdated" and removed by /roster/cleanup.
 *  Only files this roster itself wrote are ever removed. A changed outfit zip (different sha256) also shows as an update.
 *
 * Routes (under /api/plugins/zenith-system/):
 *   GET  /strict                    { strict, allowCreate, guard }
 *   GET  /roster                    the catalogue + which entries are already in the Character List ({ source, fallback, characters })
 *   GET  /roster/thumb/:id          the card picture of an entry
 *   POST /roster/download           { ids: [...] }  -> per-character results
 *   POST /roster/outfit             { id, set }     -> switches the active outfit of a downloaded character
 *   POST /roster/cleanup            { ids: [...] }  -> removes outdated files left by an update -> { removed }
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sanitize from 'sanitize-filename';

const ROOT_URL = new URL('../../../', import.meta.url); // ROOT/SillyTavern/plugins/zenith-system -> ROOT/
const CONFIG_PATH = new URL('tavern.config.json', ROOT_URL);
const ROSTER_DIR = path.resolve(fileURLToPath(new URL('core/roster/', ROOT_URL)));
const ST_SRC = new URL('../../src/endpoints/', import.meta.url);

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SET_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REL_RE = /^(?!.*\.\.)[A-Za-z0-9 _.()'&+-]+(\/[A-Za-z0-9 _.()'&+-]+)*$/;
const MAX_CARD = 25 * 1024 * 1024;
const MAX_ZIP = 25 * 1024 * 1024;
const MAX_SPRITE = 12 * 1024 * 1024;
const MAX_SPRITES = 60;
const MAX_SETS = 12;
const MAX_SET_FILES = 120;
const MAX_SET_TOTAL = 160 * 1024 * 1024;
const IMAGE_RE = /\.(png|webp|gif|jpe?g)$/i;

export const STRICT_MESSAGE = 'This ZenithTavern fork does not accept characters other than the ones it provides. '
    + 'To import characters from another source, please use normal SillyTavern.';

function readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
export function strictSettings() {
    const c = readConfig().characters || {};
    return { strict: c.strict !== false, allowCreate: c.allowCreate === true };
}
// ------------------------------------------------------------------ ledger (per user)
function userRoot(request) { return request.user.directories.root; }
function ledgerFile(request) { return path.join(userRoot(request), 'zenith-roster', 'installed.json'); }
function setsRoot(request) { return path.join(userRoot(request), 'zenith-roster', 'sets'); }
function readLedger(request) {
    try {
        const data = JSON.parse(fs.readFileSync(ledgerFile(request), 'utf8'));
        return data && typeof data === 'object' && data.items && typeof data.items === 'object' ? data : { items: {} };
    } catch { return { items: {} }; }
}
function writeLedger(request, ledger) {
    const file = ledgerFile(request);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, file);
}
/** SillyTavern keeps a small cached picture of every card. When a card is replaced by a newer version the old picture would stay
 *  (a placeholder if the first version had no image), so any cached picture older than its card is deleted and made again. */
function dropStaleThumbs(request, force = false) {
    try {
        const dirs = request.user.directories;
        if (!dirs.thumbnailsAvatar) return;
        for (const item of Object.values(readLedger(request).items)) {
            if (!item?.avatar) continue;
            const thumb = path.join(dirs.thumbnailsAvatar, item.avatar);
            if (!fs.existsSync(thumb)) continue;
            const card = path.join(dirs.characters, item.avatar);
            if (force || !fs.existsSync(card) || fs.statSync(thumb).mtimeMs < fs.statSync(card).mtimeMs) fs.unlinkSync(thumb);
        }
    } catch (e) { console.warn('[Zenith] thumbnail refresh failed', e?.message || e); }
}
function installedAvatars(request) {
    return new Set(Object.values(readLedger(request).items).map((i) => i.avatar));
}

// ------------------------------------------------------------------ PNG card reading
/** Returns the character card JSON embedded in a PNG ("chara" / "ccv3" text chunk), or null. */
export function readCardFromPng(buf) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.length < 16 || !buf.subarray(0, 8).equals(sig)) return null;
    let found = null;
    for (let pos = 8; pos + 12 <= buf.length;) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        if (pos + 12 + len > buf.length) break;
        if (type === 'tEXt') {
            const data = buf.subarray(pos + 8, pos + 8 + len);
            const nul = data.indexOf(0);
            const key = data.toString('latin1', 0, nul).toLowerCase();
            if (key === 'ccv3' || (key === 'chara' && !found)) {
                try { found = { key, json: JSON.parse(Buffer.from(data.toString('latin1', nul + 1), 'base64').toString('utf8')) }; } catch { /* ignore */ }
            }
        }
        if (type === 'IEND') break;
        pos += 12 + len;
    }
    return found ? found.json : null;
}

// ------------------------------------------------------------------ zip reading (outfits)
/** Reads the image files of an outfit zip. Stored and deflated entries only. Only the file name is used (folders inside the zip, "../" tricks,
 *  hidden files and macOS leftovers are ignored). Throws on anything damaged, encrypted, too big or with too many files. Returns Map(name -> Buffer). */
function unzipImages(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('The outfit file is not a valid zip');
    const total = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    let pos = buf.readUInt32LE(eocd + 16);
    if (pos + cdSize > buf.length || total > 2000) throw new Error('The outfit zip is damaged');
    const out = new Map();
    let totalBytes = 0;
    for (let n = 0; n < total; n++) {
        if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('The outfit zip is damaged');
        const flags = buf.readUInt16LE(pos + 8);
        const method = buf.readUInt16LE(pos + 10);
        const csize = buf.readUInt32LE(pos + 20);
        const usize = buf.readUInt32LE(pos + 24);
        const nlen = buf.readUInt16LE(pos + 28);
        const xlen = buf.readUInt16LE(pos + 30);
        const clen = buf.readUInt16LE(pos + 32);
        const local = buf.readUInt32LE(pos + 42);
        const rawName = buf.toString((flags & 0x800) ? 'utf8' : 'latin1', pos + 46, pos + 46 + nlen);
        pos += 46 + nlen + xlen + clen;
        const base = rawName.split(/[\\/]/).pop();
        if (!base || rawName.endsWith('/') || base.startsWith('.') || rawName.includes('__MACOSX')) continue;
        if (!IMAGE_RE.test(base)) continue;
        const name = sanitize(base);
        if (!name || !IMAGE_RE.test(name)) continue;
        if (flags & 1) throw new Error('The outfit zip is password protected');
        if (method !== 0 && method !== 8) throw new Error('The outfit zip uses an unsupported compression');
        if (usize > MAX_SPRITE) throw new Error(`${name} is too large`);
        totalBytes += usize;
        if (totalBytes > MAX_SET_TOTAL) throw new Error('The outfit zip is too large when unpacked');
        if (!out.has(name) && out.size >= MAX_SET_FILES) throw new Error('The outfit zip has too many images');
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The outfit zip is damaged');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        if (start + csize > buf.length) throw new Error('The outfit zip is damaged');
        const raw = buf.subarray(start, start + csize);
        const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: MAX_SPRITE + 1 });
        if (data.length !== usize || data.length > MAX_SPRITE) throw new Error(`${name} is damaged or too large`);
        out.set(name, data);
    }
    if (!out.size) throw new Error('The outfit zip has no images');
    return out;
}

// ------------------------------------------------------------------ catalogue sources
/** Reads one file of the bundled catalogue. */
async function readAsset(rel, limit) {
    if (!REL_RE.test(rel)) throw new Error(`Unsafe path in roster: ${rel}`);
    const full = path.resolve(ROSTER_DIR, rel);
    if (!full.startsWith(ROSTER_DIR + path.sep)) throw new Error('Unsafe path in roster');
    const buf = fs.readFileSync(full);
    if (buf.length > limit) throw new Error('File is too large');
    return buf;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/** Cleans a roster.json (untrusted when it comes from the web) into a list of safe entries. */
function normalizeManifest(data) {
    const list = Array.isArray(data?.characters) ? data.characters : [];
    const seen = new Set();
    const characters = [];
    for (const c of list) {
        if (!c || typeof c.id !== 'string' || !ID_RE.test(c.id) || seen.has(c.id)) continue;
        if (typeof c.card !== 'string' || !REL_RE.test(c.card) || !/\.png$/i.test(c.card)) continue;
        seen.add(c.id);
        const setIds = new Set();
        characters.push({
            id: c.id,
            name: String(c.name || c.id).slice(0, 80),
            file: typeof c.file === 'string' && c.file.trim() ? sanitize(c.file.trim()).replace(/\.png$/i, '') + '.png' : `${sanitize(String(c.name || c.id))}.png`,
            tagline: String(c.tagline || '').slice(0, 240),
            tags: Array.isArray(c.tags) ? c.tags.map(String).slice(0, 8) : [],
            version: Number.isFinite(c.version) ? c.version : 1,
            card: c.card,
            thumb: typeof c.thumb === 'string' && REL_RE.test(c.thumb) && IMAGE_RE.test(c.thumb) ? c.thumb : '',
            sha256: typeof c.sha256 === 'string' ? c.sha256.toLowerCase() : '',
            sprites: (Array.isArray(c.sprites) ? c.sprites : [])
                .filter((s) => s && typeof s.path === 'string' && REL_RE.test(s.path) && IMAGE_RE.test(s.path))
                .slice(0, MAX_SPRITES)
                .map((s) => ({ path: s.path, as: sanitize(String(s.as || path.posix.basename(s.path))), sha256: typeof s.sha256 === 'string' ? s.sha256.toLowerCase() : '' })),
            // pictures used inside the character's messages (e.g. the greeting image); installed to <user>/images/<Name>/
            images: (Array.isArray(c.images) ? c.images : [])
                .filter((s) => s && typeof s.path === 'string' && REL_RE.test(s.path) && IMAGE_RE.test(s.path))
                .slice(0, 30)
                .map((s) => ({ path: s.path, as: sanitize(String(s.as || path.posix.basename(s.path))), sha256: typeof s.sha256 === 'string' ? s.sha256.toLowerCase() : '' })),
            // outfits: one zip of expression images each
            sets: (Array.isArray(c.sets) ? c.sets : [])
                .filter((s) => s && typeof s.id === 'string' && SET_ID_RE.test(s.id) && typeof s.path === 'string' && REL_RE.test(s.path) && /\.zip$/i.test(s.path) && !setIds.has(s.id) && setIds.add(s.id))
                .slice(0, MAX_SETS)
                .map((s) => ({ id: s.id, name: String(s.name || s.id).slice(0, 40), path: s.path, sha256: typeof s.sha256 === 'string' ? s.sha256.toLowerCase() : '' })),
            defaultSet: typeof c.defaultSet === 'string' && SET_ID_RE.test(c.defaultSet) ? c.defaultSet : '',
        });
    }
    return characters;
}

/** The catalogue is always the bundled copy shipped with ZenithTavern. */
async function loadManifest() {
    const file = path.join(ROSTER_DIR, 'roster.json');
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch { return { source: 'local', characters: [] }; }
    return { source: 'local', characters: normalizeManifest(JSON.parse(raw)) };
}

function checkHash(buf, expected, what) {
    if (expected && sha256(buf) !== expected) throw new Error(`${what} did not match its checksum`);
}

// ------------------------------------------------------------------ embedded lorebook -> World Info file
function toWorldInfo(book) {
    const entries = {};
    book.entries.forEach((e, index) => {
        const x = e.extensions || {};
        const uid = e.id ?? index;
        entries[uid] = {
            uid, key: e.keys || [], keysecondary: e.secondary_keys || [], comment: e.comment || '', content: e.content || '',
            constant: !!e.constant, vectorized: false, selective: !!e.selective, selectiveLogic: x.selectiveLogic ?? 0,
            addMemo: !!e.comment, order: e.insertion_order ?? 100, position: x.position ?? (e.position === 'before_char' ? 0 : 1),
            disable: e.enabled === false, excludeRecursion: x.exclude_recursion ?? false, preventRecursion: x.prevent_recursion ?? false,
            delayUntilRecursion: x.delay_until_recursion ?? false, probability: x.probability ?? 100, useProbability: x.useProbability ?? true,
            depth: x.depth ?? 4, group: x.group ?? '', groupOverride: false, groupWeight: 100, scanDepth: x.scan_depth ?? null,
            caseSensitive: x.case_sensitive ?? null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: x.role ?? 0,
            sticky: x.sticky ?? null, cooldown: x.cooldown ?? null, delay: x.delay ?? null, displayIndex: x.display_index ?? index,
            ignoreBudget: false, triggers: [], matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false, outletName: '', characterFilter: { isExclude: false, names: [], tags: [] },
        };
    });
    return { entries };
}

// ------------------------------------------------------------------ install
let busy = Promise.resolve();

async function installOne(request, entry) {
    const charsDir = request.user.directories.characters;
    fs.mkdirSync(charsDir, { recursive: true });

    const card = await readAsset(entry.card, MAX_CARD);
    checkHash(card, entry.sha256, 'The character card');
    const data = readCardFromPng(card);
    const cardName = String(data?.data?.name ?? data?.name ?? '').trim();
    if (!cardName) throw new Error('The file is not a valid character card');

    // expressions: outfits (zips) when the character has them, loose sprites otherwise
    const sprites = [];
    const outfits = new Map(); // set id -> { name, sha256, files: Map(name -> Buffer) }
    if (entry.sets.length) {
        for (const s of entry.sets) {
            const zip = await readAsset(s.path, MAX_ZIP);
            checkHash(zip, s.sha256, `Outfit ${s.name}`);
            outfits.set(s.id, { name: s.name, sha256: sha256(zip), files: unzipImages(zip) });
        }
    } else {
        for (const s of entry.sprites) {
            const buf = await readAsset(s.path, MAX_SPRITE);
            checkHash(buf, s.sha256, `Expression ${s.as}`);
            sprites.push({ name: s.as, buf });
        }
    }

    const images = [];
    for (const s of entry.images) {
        const buf = await readAsset(s.path, MAX_SPRITE, base);
        checkHash(buf, s.sha256, `Image ${s.as}`);
        images.push({ name: s.as, buf });
    }

    const ledger = readLedger(request);
    const prev = ledger.items[entry.id] || {};

    // the outfit that is active: the one the player already wears, else the character's default, else the first
    let activeSet = '';
    if (outfits.size) {
        activeSet = outfits.has(prev.activeSet) ? prev.activeSet : (outfits.has(entry.defaultSet) ? entry.defaultSet : (outfits.has('casual') ? 'casual' : [...outfits.keys()][0]));
        for (const [name, buf] of outfits.get(activeSet).files) sprites.push({ name, buf });
    }

    const target = path.join(charsDir, entry.file);
    const ours = prev.avatar === entry.file;
    if (fs.existsSync(target) && !ours) fs.renameSync(target, `${target}.zenith-bak`); // never destroy a file we did not write
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, card);
    fs.renameSync(tmp, target);

    // A card with an embedded lorebook: write it as a World Info file (the card's "world" points at it), so it is active without any import step.
    const book = data?.data?.character_book;
    if (book?.entries?.length && data?.data?.extensions?.world) {
        const worldsDir = request.user.directories.worlds;
        fs.mkdirSync(worldsDir, { recursive: true });
        fs.writeFileSync(path.join(worldsDir, `${sanitize(data.data.extensions.world)}.json`), JSON.stringify(toWorldInfo(book), null, 2));
    }

    const written = [];
    if (sprites.length) {
        const spriteDir = path.join(charsDir, sanitize(cardName));
        fs.mkdirSync(spriteDir, { recursive: true });
        for (const s of sprites) {
            fs.writeFileSync(path.join(spriteDir, s.name), s.buf);
            written.push(s.name);
        }
    }

    // every outfit is kept unpacked (so switching is instant and offline); the active one was just copied above
    const setRecs = {};
    if (outfits.size) {
        const root = path.join(setsRoot(request), entry.id);
        fs.mkdirSync(root, { recursive: true });
        for (const [sid, s] of outfits) {
            const dir = path.join(root, sid);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
            for (const [name, buf] of s.files) fs.writeFileSync(path.join(dir, name), buf);
            setRecs[sid] = { name: s.name, sha256: s.sha256, files: [...s.files.keys()] };
        }
    }
    for (const sid of Object.keys(prev.sets || {})) {
        if (!outfits.has(sid) && SET_ID_RE.test(sid)) fs.rmSync(path.join(setsRoot(request), entry.id, sid), { recursive: true, force: true }); // an outfit the storage no longer has
    }

    if (images.length) {
        const imageDir = path.join(request.user.directories.userImages, sanitize(cardName));
        fs.mkdirSync(imageDir, { recursive: true });
        for (const s of images) fs.writeFileSync(path.join(imageDir, s.name), s.buf);
    }

    // What an older version wrote and this one no longer has (a removed sprite, a renamed character): remembered here, removed by /roster/cleanup.
    const imageNames = images.map((i) => i.name);
    const prevFolder = prev.name ? sanitize(prev.name) : '';
    const nowFolder = sanitize(cardName);
    const stale = Array.isArray(prev.stale) ? prev.stale.filter((s) => !(s.kind !== 'card' && s.folder === nowFolder && (s.kind === 'sprites' ? written : imageNames).includes(s.file))) : [];
    const keep = (kind, folder, file) => !stale.some((s) => s.kind === kind && s.folder === folder && s.file === file);
    for (const file of prev.sprites || []) if ((prevFolder !== nowFolder || !written.includes(file)) && keep('sprites', prevFolder, file)) stale.push({ kind: 'sprites', folder: prevFolder, file });
    for (const file of prev.images || []) if ((prevFolder !== nowFolder || !imageNames.includes(file)) && keep('images', prevFolder, file)) stale.push({ kind: 'images', folder: prevFolder, file });
    if (prev.avatar && prev.avatar !== entry.file && !stale.some((s) => s.kind === 'card' && s.file === prev.avatar)) stale.push({ kind: 'card', folder: '', file: prev.avatar });

    ledger.items[entry.id] = { avatar: entry.file, name: cardName, version: entry.version, sprites: written, images: imageNames, sets: setRecs, activeSet, stale, installedAt: new Date().toISOString() };
    writeLedger(request, ledger);
    dropStaleThumbs(request, true);
    return {
        id: entry.id, ok: true, avatar: entry.file, name: cardName, sprites: written.length, activeSet,
        sets: Object.entries(setRecs).map(([id, r]) => ({ id, name: r.name, files: r.files.length })),
    };
}

/** Makes one of the downloaded outfits the active one: its images replace the ones this roster put in characters/<Name>/. */
function applyOutfit(request, id, setId) {
    const ledger = readLedger(request);
    const rec = ledger.items[id];
    if (!rec || !rec.sets || !rec.sets[setId]) throw new Error('That outfit is not downloaded');
    const dirs = request.user.directories;
    const src = path.join(setsRoot(request), id, setId);
    if (!fs.existsSync(src)) throw new Error('The outfit files are missing. Download the character again.');
    const files = fs.readdirSync(src).filter((f) => IMAGE_RE.test(f));
    if (!files.length) throw new Error('The outfit has no images');
    const folder = path.join(dirs.characters, sanitize(rec.name));
    fs.mkdirSync(folder, { recursive: true });
    for (const old of rec.sprites || []) if (!files.includes(old)) fs.rmSync(path.join(folder, sanitize(old)), { force: true }); // only files this roster wrote
    for (const f of files) fs.copyFileSync(path.join(src, f), path.join(folder, f));
    rec.sprites = files;
    rec.activeSet = setId;
    writeLedger(request, ledger);
    return { ok: true, id, set: setId, name: rec.sets[setId].name, files: files.length };
}

/** Removes the outdated files recorded by installOne for the given ids. Returns how many files were removed. */
function cleanupOutdated(request, ids) {
    const ledger = readLedger(request);
    const dirs = request.user.directories;
    let removed = 0;
    for (const id of ids) {
        const rec = ledger.items[id];
        if (!rec || !Array.isArray(rec.stale) || !rec.stale.length) continue;
        for (const s of rec.stale) {
            try {
                if (!s || typeof s.file !== 'string' || !s.file) continue;
                let target = null;
                if (s.kind === 'card') target = s.file === rec.avatar ? null : path.join(dirs.characters, sanitize(s.file));
                else if (s.kind === 'sprites' && s.folder) target = path.join(dirs.characters, sanitize(s.folder), sanitize(s.file));
                else if (s.kind === 'images' && s.folder) target = path.join(dirs.userImages, sanitize(s.folder), sanitize(s.file));
                if (!target) continue;
                if (fs.existsSync(target)) { fs.rmSync(target, { force: true }); removed++; }
                if (s.kind !== 'card') {
                    const folder = path.dirname(target);
                    if (fs.existsSync(folder) && !fs.readdirSync(folder).length) fs.rmdirSync(folder);
                }
            } catch (e) { console.warn('[Zenith] could not remove an outdated file', e?.message || e); }
        }
        rec.stale = [];
    }
    writeLedger(request, ledger);
    return removed;
}

// ------------------------------------------------------------------ strict guards
function blockWith(kind, request, response) {
    // an upload that was already received by multer is not needed any more
    try { if (request.file?.path) fs.rmSync(request.file.path, { force: true }); } catch { /* ignore */ }
    console.warn(`[Zenith] strict characters: blocked "${kind}"`);
    response.status(403).json({ error: true, zenithStrict: kind, message: kind === 'edit' || kind === 'delete' ? 'ZenithTavern characters are read-only (no editing or deleting). Use normal SillyTavern to change a character.' : STRICT_MESSAGE });
}

/** merge-attributes is also how SillyTavern remembers the open chat and extension data, so only the card text is refused. */
function mergeAllowed(body) {
    if (!body || typeof body !== 'object') return true;
    const topOk = new Set(['avatar', 'chat', 'fav', 'data']);
    for (const k of Object.keys(body)) if (!topOk.has(k)) return false;
    if (body.data !== undefined) {
        if (typeof body.data !== 'object' || body.data === null) return false;
        for (const k of Object.keys(body.data)) if (k !== 'extensions') return false;
    }
    return true;
}

async function prependGuard(routerObject, mw) {
    const tmp = express.Router();
    tmp.use(mw);
    routerObject.stack.unshift(tmp.stack[0]);
}

export async function installStrictGuards() {
    try {
        const characters = await import(new URL('characters.js', ST_SRC).href);
        const content = await import(new URL('content-manager.js', ST_SRC).href);
        if (!characters.router?.stack || !content.router?.stack) throw new Error('SillyTavern routers not found');

        await prependGuard(characters.router, (request, response, next) => {
            const { strict, allowCreate } = strictSettings();
            if (!strict || request.method !== 'POST') return next();
            switch (request.path) {
                case '/import': return blockWith('import', request, response);
                case '/export': return blockWith('export', request, response);
                case '/duplicate': return blockWith('duplicate', request, response);
                case '/create': return allowCreate ? next() : blockWith('create', request, response);
                // the card itself is read-only: no editing, renaming, new avatar or deleting
                // SillyTavern also saves the card by itself when a chat is opened (to remember the chat), through this same route.
                // Refusing it showed "Something went wrong while saving the character... webp", so it is quietly accepted and ignored:
                // the card is never written, and nothing in the interface lets anyone edit it anyway.
                case '/edit': console.warn('[Zenith] strict characters: ignored an automatic card save'); return response.status(200).send('ok');
                case '/edit-avatar': return blockWith('edit', request, response);
                case '/rename': return blockWith('edit', request, response);
                case '/delete': return blockWith('delete', request, response);
                // only "favorite", the remembered chat file and extension data may be saved on a card
                case '/edit-attribute': return ['fav', 'chat'].includes(request.body?.field) ? next() : blockWith('edit', request, response);
                case '/merge-attributes': return mergeAllowed(request.body) ? next() : blockWith('edit', request, response);
                case '/all': {
                    dropStaleThumbs(request);
                    const send = response.send.bind(response);
                    response.send = (body) => {
                        try {
                            if (Array.isArray(body)) {
                                const keep = installedAvatars(request);
                                body = body.filter((c) => keep.has(c?.avatar));
                            }
                        } catch (e) { console.warn('[Zenith] roster filter failed', e); }
                        return send(body);
                    };
                    return next();
                }
                default: return next();
            }
        });
        await prependGuard(content.router, (request, response, next) => {
            if (!strictSettings().strict || request.method !== 'POST') return next();
            if (request.path === '/importURL' || request.path === '/importUUID') return blockWith('import', request, response);
            return next();
        });
        return true;
    } catch (e) {
        console.error('[Zenith] Could not attach the strict-characters guard. Characters are NOT locked!', e);
        return false;
    }
}

// ------------------------------------------------------------------ routes
export function setupRoster(router, guardState) {
    router.get('/strict', (_request, response) => response.json({ ...strictSettings(), guard: guardState.ok }));

    router.get('/roster', async (request, response) => {
        try {
            const manifest = await loadManifest();
            const ledger = readLedger(request);
            const charsDir = request.user.directories.characters;
            const characters = manifest.characters.map((c) => {
                const rec = ledger.items[c.id];
                const installed = !!rec && rec.avatar === c.file && fs.existsSync(path.join(charsDir, c.file));
                const recSets = (installed && rec.sets) || {};
                // a changed, added or removed outfit counts as an update (only judged against the storage, never against the bundled copy)
                const setsChanged = false
                    && (c.sets.some((s) => !recSets[s.id] || (s.sha256 && recSets[s.id].sha256 !== s.sha256)) || Object.keys(recSets).some((sid) => !c.sets.some((s) => s.id === sid)));
                return {
                    id: c.id, name: c.name, tagline: c.tagline, tags: c.tags, sprites: c.sprites.length,
                    version: c.version, installedVersion: installed ? (rec.version ?? 0) : null,
                    installed, updateAvailable: installed && ((rec.version ?? 0) < c.version || setsChanged),
                    outdatedFiles: Array.isArray(rec?.stale) ? rec.stale.length : 0,
                    sets: c.sets.map((s) => ({ id: s.id, name: s.name })), installedSets: Object.keys(recSets), activeSet: installed ? (rec.activeSet || '') : '',
                };
            });
            response.json({ source: manifest.source, fallback: manifest.fallback, fallbackReason: manifest.fallbackReason, characters });
        } catch (e) {
            console.error('[Zenith] roster list failed', e);
            response.status(502).json({ error: true, message: 'Could not read the roster: ' + (e?.message || e) });
        }
    });

    router.get('/roster/thumb/:id', async (request, response) => {
        try {
            if (!ID_RE.test(request.params.id)) return response.sendStatus(400);
            const manifest = await loadManifest();
            const entry = manifest.characters.find((c) => c.id === request.params.id);
            if (!entry) return response.sendStatus(404);
            const rel = entry.thumb || entry.card;
            const buf = await readAsset(rel, MAX_CARD, manifest.base);
            response.set('Cache-Control', 'private, max-age=300');
            response.type(path.extname(rel).slice(1).toLowerCase() === 'jpg' ? 'jpeg' : path.extname(rel).slice(1).toLowerCase());
            response.send(buf);
        } catch { response.sendStatus(404); }
    });

    router.post('/roster/download', express.json({ limit: '64kb' }), async (request, response) => {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, 500) : [];
        if (!ids.length) return response.status(400).json({ error: true, message: 'Nothing selected.' });
        const run = busy.then(async () => {
            const manifest = await loadManifest();
            const results = [];
            for (const id of ids) {
                const entry = manifest.characters.find((c) => c.id === id);
                if (!entry) { results.push({ id, ok: false, error: 'Not in the roster' }); continue; }
                try { results.push(await installOne(request, entry)); } catch (e) {
                    console.error(`[Zenith] roster install of "${id}" failed`, e);
                    results.push({ id, ok: false, error: String(e?.message || e) });
                }
            }
            return results;
        });
        busy = run.catch(() => { /* keep the queue alive */ });
        try { response.json({ results: await run }); } catch (e) {
            response.status(502).json({ error: true, message: 'Download failed: ' + (e?.message || e) });
        }
    });

    router.post('/roster/outfit', express.json({ limit: '16kb' }), async (request, response) => {
        const id = String(request.body?.id || '');
        const setId = String(request.body?.set || '');
        if (!ID_RE.test(id) || !SET_ID_RE.test(setId)) return response.status(400).json({ error: true, message: 'Bad character or outfit.' });
        try {
            const run = busy.then(() => applyOutfit(request, id, setId));
            busy = run.catch(() => { /* keep the queue alive */ });
            response.json(await run);
        } catch (e) {
            response.status(400).json({ error: true, message: String(e?.message || e) });
        }
    });

    router.post('/roster/cleanup', express.json({ limit: '64kb' }), async (request, response) => {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, 500) : Object.keys(readLedger(request).items);
        try {
            const run = busy.then(() => cleanupOutdated(request, ids));
            busy = run.catch(() => { /* keep the queue alive */ });
            const removed = await run;
            if (removed) dropStaleThumbs(request, true);
            response.json({ ok: true, removed });
        } catch (e) {
            console.error('[Zenith] roster cleanup failed', e);
            response.status(500).json({ error: true, message: 'Cleanup failed: ' + (e?.message || e) });
        }
    });
}
