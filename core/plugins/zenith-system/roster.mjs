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
 *  ROSTER: core/roster/roster.json (+ one folder per character) is the catalogue. Nothing is
 *  loaded automatically. "Download" copies the card and its expression sprites into the user's
 *  own data folder and records it in <user data>/zenith-roster/installed.json.
 *  tavern.config.json -> roster.remote (an https base URL) makes the catalogue come from the web
 *  instead; every remote file must then carry a sha256 in roster.json.
 *
 * Routes (under /api/plugins/zenith-system/):
 *   GET  /strict                    { strict, allowCreate, guard }
 *   GET  /roster                    the catalogue + which entries are already in the Character List
 *   GET  /roster/thumb/:id          the card picture of an entry
 *   POST /roster/download           { ids: [...] }  -> per-character results
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import sanitize from 'sanitize-filename';

const ROOT_URL = new URL('../../../', import.meta.url); // ROOT/SillyTavern/plugins/zenith-system -> ROOT/
const CONFIG_PATH = new URL('tavern.config.json', ROOT_URL);
const ROSTER_DIR = path.resolve(fileURLToPath(new URL('core/roster/', ROOT_URL)));
const ST_SRC = new URL('../../src/endpoints/', import.meta.url);

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REL_RE = /^(?!.*\.\.)[A-Za-z0-9 _.()'&+-]+(\/[A-Za-z0-9 _.()'&+-]+)*$/;
const MAX_CARD = 25 * 1024 * 1024;
const MAX_SPRITE = 12 * 1024 * 1024;
const MAX_SPRITES = 60;
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
function remoteBase() {
    const r = String((readConfig().roster || {}).remote || '').trim();
    return /^https:\/\/[^\s]+$/i.test(r) ? r.replace(/\/+$/, '') : '';
}

// ------------------------------------------------------------------ ledger (per user)
function userRoot(request) { return request.user.directories.root; }
function ledgerFile(request) { return path.join(userRoot(request), 'zenith-roster', 'installed.json'); }
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

// ------------------------------------------------------------------ catalogue sources
async function fetchLimited(url, limit) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > limit) throw new Error('File is too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > limit) throw new Error('File is too large');
    return buf;
}

async function readAsset(rel, limit) {
    if (!REL_RE.test(rel)) throw new Error(`Unsafe path in roster: ${rel}`);
    const base = remoteBase();
    if (base) return fetchLimited(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, limit);
    const full = path.resolve(ROSTER_DIR, rel);
    if (!full.startsWith(ROSTER_DIR + path.sep)) throw new Error('Unsafe path in roster');
    const buf = fs.readFileSync(full);
    if (buf.length > limit) throw new Error('File is too large');
    return buf;
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function loadManifest() {
    const base = remoteBase();
    let raw;
    try {
        raw = base ? (await fetchLimited(`${base}/roster.json`, 4 * 1024 * 1024)).toString('utf8')
            : fs.readFileSync(path.join(ROSTER_DIR, 'roster.json'), 'utf8');
    } catch (e) {
        if (base) throw e;
        return { source: 'local', characters: [] }; // no roster.json yet = empty roster
    }
    const data = JSON.parse(raw);
    const list = Array.isArray(data.characters) ? data.characters : [];
    const seen = new Set();
    const characters = [];
    for (const c of list) {
        if (!c || typeof c.id !== 'string' || !ID_RE.test(c.id) || seen.has(c.id)) continue;
        if (typeof c.card !== 'string' || !REL_RE.test(c.card) || !/\.png$/i.test(c.card)) continue;
        seen.add(c.id);
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
        });
    }
    return { source: base ? 'remote' : 'local', characters };
}

function checkHash(buf, expected, remote, what) {
    if (expected) { if (sha256(buf) !== expected) throw new Error(`${what} did not match its checksum`); }
    else if (remote) throw new Error(`${what} has no checksum in roster.json (required for remote rosters)`);
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

async function installOne(request, entry, remote) {
    const charsDir = request.user.directories.characters;
    fs.mkdirSync(charsDir, { recursive: true });

    const card = await readAsset(entry.card, MAX_CARD);
    checkHash(card, entry.sha256, remote, 'The character card');
    const data = readCardFromPng(card);
    const cardName = String(data?.data?.name ?? data?.name ?? '').trim();
    if (!cardName) throw new Error('The file is not a valid character card');

    const sprites = [];
    for (const s of entry.sprites) {
        const buf = await readAsset(s.path, MAX_SPRITE);
        checkHash(buf, s.sha256, remote, `Expression ${s.as}`);
        sprites.push({ name: s.as, buf });
    }

    const images = [];
    for (const s of entry.images) {
        const buf = await readAsset(s.path, MAX_SPRITE);
        checkHash(buf, s.sha256, remote, `Image ${s.as}`);
        images.push({ name: s.as, buf });
    }

    const ledger = readLedger(request);
    const target = path.join(charsDir, entry.file);
    const ours = ledger.items[entry.id]?.avatar === entry.file;
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

    if (images.length) {
        const imageDir = path.join(request.user.directories.userImages, sanitize(cardName));
        fs.mkdirSync(imageDir, { recursive: true });
        for (const s of images) fs.writeFileSync(path.join(imageDir, s.name), s.buf);
    }

    ledger.items[entry.id] = { avatar: entry.file, name: cardName, version: entry.version, sprites: written, images: images.map((i) => i.name), installedAt: new Date().toISOString() };
    writeLedger(request, ledger);
    return { id: entry.id, ok: true, avatar: entry.file, name: cardName, sprites: written.length };
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
                return {
                    id: c.id, name: c.name, tagline: c.tagline, tags: c.tags, sprites: c.sprites.length,
                    installed, updateAvailable: installed && (rec.version ?? 0) < c.version,
                };
            });
            response.json({ source: manifest.source, characters });
        } catch (e) {
            console.error('[Zenith] roster list failed', e);
            response.status(502).json({ error: true, message: 'Could not read the roster: ' + (e?.message || e) });
        }
    });

    router.get('/roster/thumb/:id', async (request, response) => {
        try {
            if (!ID_RE.test(request.params.id)) return response.sendStatus(400);
            const entry = (await loadManifest()).characters.find((c) => c.id === request.params.id);
            if (!entry) return response.sendStatus(404);
            const rel = entry.thumb || entry.card;
            const buf = await readAsset(rel, MAX_CARD);
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
            const remote = manifest.source === 'remote';
            const results = [];
            for (const id of ids) {
                const entry = manifest.characters.find((c) => c.id === id);
                if (!entry) { results.push({ id, ok: false, error: 'Not in the roster' }); continue; }
                try { results.push(await installOne(request, entry, remote)); } catch (e) {
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
}
