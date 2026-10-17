/*
 * EX-Roster (server side). Managed by the launcher. Imported by index.mjs.
 *
 * The phone app "EX-Roster" lets people share characters and places as lorebooks.
 * The shared items live on a small community server (a Cloudflare Worker, see community/worker.js).
 * This file (a) talks to that server for the browser, so the browser never needs CORS or the server address, and
 * (b) turns a downloaded item into lorebook entries in the user's own World Info folder:
 *     character -> "Community Characters" (full profile) + "Community Sub-bots" (short cast card keyed by place)
 *     location  -> "Community Locations"
 *     pictures  -> <user data>/zenith-roster/exroster/<id>/   and expressions -> characters/<Name>/<expression>.webp
 *
 * The server address is  tavern.config.json -> exroster.url  (a built-in default is used when empty).
 *
 * Routes (under /api/plugins/zenith-system/exroster/):
 *   GET  config | list | item/:id | img/:id/:name     (proxied from the community server)
 *   POST publish | delete                             (proxied)
 *   POST install    { id }                            download an item and install it
 *   POST lorebook   { name, data }                    install a whole lorebook file (SillyTavern World Info format)
 *   GET  installed                                    what is installed
 *   POST uninstall  { id }
 *   GET  local/:id/:name                              a picture of an installed item
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import sanitize from 'sanitize-filename';

const DEFAULT_URL = 'https://zenith-exroster.f30680230.workers.dev';
const CONFIG_PATH = new URL('../../../tavern.config.json', import.meta.url);
const W = { char: 'Community Characters', bots: 'Community Sub-bots', place: 'Community Locations' };

function baseUrl() {
    let u = '';
    try { u = String((JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).exroster || {}).url || ''); } catch { /* default */ }
    u = (u.trim() || DEFAULT_URL).replace(/\/+$/, '');
    return /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:|\/|$))/.test(u) ? u : DEFAULT_URL;
}
const dataRoot = (req) => {
    const dir = path.join(req.user.directories.root, 'zenith-roster', 'exroster');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const ID_RE = /^[CL]-[A-Z0-9]{12}$/;
const first = (n) => String(n).split(/\s+/)[0];
const splitList = (t) => String(t || '').split(/[,;\n/]+/).map((x) => x.trim()).filter(Boolean);

async function remote(pathname, init) {
    const r = await fetch(baseUrl() + pathname, { ...init, signal: AbortSignal.timeout(25000) });
    return r;
}

// ---------------------------------------------------------------- lorebook entries
const entry = (uid, over) => ({
    uid, key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true, selectiveLogic: 0,
    addMemo: true, order: 50, position: 0, disable: false, ignoreBudget: false, excludeRecursion: false, preventRecursion: true,
    matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
    matchScenario: false, matchCreatorNotes: false, delayUntilRecursion: 0, probability: 100, useProbability: true, depth: 4, outletName: '',
    group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: false, matchWholeWords: true, useGroupScoring: null,
    automationId: '', role: 0, sticky: null, cooldown: null, delay: null, displayIndex: uid,
    characterFilter: { isExclude: false, names: [], tags: [] }, triggers: [], ...over,
});

/** The entries a bundle becomes. Returns { Characters:[...], Bots:[...], Places:[...] } (plain objects, no uid yet). */
export function buildEntries(id, b) {
    const d = b.data || {};
    const name = b.name;
    const out = { char: [], bots: [], place: [] };
    if (b.kind === 'character') {
        const f = first(name);
        const exprs = Object.keys(b.images?.expressions || {});
        const lines = [`[CHARACTER: ${name}]`, `${name} is ${d.age} years old${d.species ? ` and ${/^[aeiou]/i.test(d.species) ? 'an' : 'a'} ${d.species}` : ''}. All characters in this story are adults.`, String(d.description || '').trim()];
        if (d.personality) lines.push(`Personality and behavior:\n${d.personality.trim()}`);
        if (d.prompt) lines.push(`How to play ${f}:\n${d.prompt.trim()}`);
        if (d.restrictions) lines.push(`STRICT ROLEPLAY RULES for ${f} (always obey):\n${d.restrictions.trim()}`);
        if (exprs.length) lines.push(`Expressions ${f} can show: ${exprs.join(', ')}.`);
        out.char.push({ id, comment: name, key: [...new Set([name, f, ...(d.keys || [])])], content: lines.join('\n\n'), order: 55 });
        const places = splitList(d.places);
        out.bots.push({
            id, comment: name, key: places,
            content: `[SUB-BOT: ${name}]\n${d.summary || String(d.description || '').slice(0, 300)}\nFound at: ${d.places || 'anywhere in Asterhaven'}. Usual hours: ${d.when || 'any reasonable hour'}.\nIf the scene is at one of these places at a plausible time, ${f} is there and takes part, played in the same reply as {{char}} with their own voice. Full profile: Characters lorebook.`,
            order: 45,
        });
    } else {
        const lines = [`[LOCATION: ${name}]`, String(d.description || '').trim()];
        if (d.hours) lines.push(`Hours and atmosphere: ${d.hours}`);
        if (d.residents) lines.push(`People usually found here: ${d.residents}. (If one of them has a SUB-BOT entry, they are there at a plausible hour and take part.)`);
        if (d.prompt) lines.push(`Rules for this place:\n${d.prompt.trim()}`);
        out.place.push({ id, comment: name, key: [...new Set([name, ...(d.keys || [])])], content: lines.join('\n\n'), order: 40 });
    }
    return out;
}

function writeBook(worldsDir, worldName, items, id) {
    const file = path.join(worldsDir, `${sanitize(worldName)}.json`);
    let book = { entries: {} };
    try { book = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
    book.entries ??= {};
    for (const [k, e] of Object.entries(book.entries)) if (e.zenith_ex === id) delete book.entries[k];
    let uid = Object.keys(book.entries).reduce((m, k) => Math.max(m, Number(k) + 1), 0);
    for (const it of items) {
        book.entries[uid] = { ...entry(uid, { comment: it.comment, key: it.key, content: it.content, order: it.order }), zenith_ex: id };
        uid++;
    }
    fs.mkdirSync(worldsDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(book, null, 2));
}
function dropFrom(worldsDir, worldName, id) {
    const file = path.join(worldsDir, `${sanitize(worldName)}.json`);
    let book; try { book = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    let changed = false;
    for (const [k, e] of Object.entries(book.entries || {})) if (e.zenith_ex === id) { delete book.entries[k]; changed = true; }
    if (changed) fs.writeFileSync(file, JSON.stringify(book, null, 2));
}

const dataUrl = (u) => { const m = /^data:image\/(webp|jpeg|png);base64,(.+)$/.exec(u || ''); return m ? { ext: m[1] === 'jpeg' ? 'jpg' : m[1], buf: Buffer.from(m[2], 'base64') } : null; };

function ledgerPath(req) { return path.join(dataRoot(req), 'installed.json'); }
function readLedger(req) { try { return JSON.parse(fs.readFileSync(ledgerPath(req), 'utf8')); } catch { return { items: {} }; } }
function writeLedger(req, l) { fs.writeFileSync(ledgerPath(req), JSON.stringify(l, null, 2)); }

function installBundle(req, id, b) {
    const worlds = req.user.directories.worlds;
    const e = buildEntries(id, b);
    if (e.char.length) writeBook(worlds, W.char, e.char, id);
    if (e.bots.length) writeBook(worlds, W.bots, e.bots, id);
    if (e.place.length) writeBook(worlds, W.place, e.place, id);
    // pictures
    const dir = path.join(dataRoot(req), id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const slot of ['card', 'banner']) { const p = dataUrl(b.images?.[slot]); if (p) fs.writeFileSync(path.join(dir, `${slot}.${p.ext}`), p.buf); }
    let sprites = 0;
    if (b.kind === 'character') {
        const sd = path.join(req.user.directories.characters, sanitize(b.name));
        for (const [n, v] of Object.entries(b.images?.expressions || {})) {
            const p = dataUrl(v); if (!p) continue;
            fs.mkdirSync(sd, { recursive: true });
            fs.writeFileSync(path.join(sd, `${sanitize(n)}.${p.ext}`), p.buf);
            sprites++;
        }
    }
    const l = readLedger(req);
    l.items[id] = { id, kind: b.kind, name: b.name, author: b.author, sprites, installedAt: new Date().toISOString(), at: !!(b.images?.card || b.images?.banner) };
    writeLedger(req, l);
    return l.items[id];
}

// ---------------------------------------------------------------- routes
export function setupExRoster(router) {
    const ex = express.Router();
    router.use('/exroster', ex);
    const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.warn('[Zenith] EX-Roster:', e?.message || e); res.status(502).json({ error: 'The community server could not be reached.' }); } };

    ex.get('/config', (_req, res) => res.json({ url: baseUrl() }));

    ex.get('/list', wrap(async (req, res) => {
        const qs = new URLSearchParams();
        if (req.query.kind) qs.set('kind', String(req.query.kind));
        if (req.query.q) qs.set('q', String(req.query.q).slice(0, 60));
        const r = await remote(`/api/list?${qs}`);
        res.status(r.status).type('json').send(await r.text());
    }));

    ex.get('/item/:id', wrap(async (req, res) => {
        if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'That is not a valid code.' });
        const r = await remote(`/api/item/${req.params.id}`);
        res.status(r.status).type('json').send(await r.text());
    }));

    ex.get('/img/:id/:name', wrap(async (req, res) => {
        if (!ID_RE.test(req.params.id) || !/^[A-Za-z0-9 _-]{1,24}$/.test(req.params.name)) return res.sendStatus(400);
        const r = await remote(`/api/img/${req.params.id}/${encodeURIComponent(req.params.name)}`);
        if (!r.ok) return res.sendStatus(r.status);
        res.set('content-type', r.headers.get('content-type') || 'image/webp').set('cache-control', 'private, max-age=600').send(Buffer.from(await r.arrayBuffer()));
    }));

    ex.post('/publish', express.json({ limit: '3mb' }), wrap(async (req, res) => {
        const r = await remote('/api/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle: req.body?.bundle }) });
        res.status(r.status).type('json').send(await r.text());
    }));

    ex.post('/delete', express.json({ limit: '4kb' }), wrap(async (req, res) => {
        const r = await remote('/api/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: req.body?.id, token: req.body?.token }) });
        res.status(r.status).type('json').send(await r.text());
    }));

    ex.post('/install', express.json({ limit: '4kb' }), wrap(async (req, res) => {
        const id = String(req.body?.id || '').trim().toUpperCase();
        if (!ID_RE.test(id)) return res.status(400).json({ error: 'That is not a valid code.' });
        const r = await remote(`/api/item/${id}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.bundle) return res.status(r.status === 404 ? 404 : 502).json({ error: j.error || 'Could not download it.' });
        if (j.bundle.format !== 'zenith-ex') return res.status(400).json({ error: 'Unknown format.' });
        res.json({ ok: true, item: installBundle(req, id, j.bundle) });
    }));

    ex.post('/lorebook', express.json({ limit: '8mb' }), (req, res) => {
        const data = req.body?.data;
        const entries = data && typeof data === 'object' ? data.entries : null;
        if (!entries || typeof entries !== 'object' || !Object.keys(entries).length) return res.status(400).json({ error: 'That file is not a lorebook (World Info) file.' });
        const base = sanitize(String(req.body?.name || 'Imported lorebook').replace(/\.json$/i, '')).trim().slice(0, 60) || 'Imported lorebook';
        const worlds = req.user.directories.worlds;
        fs.mkdirSync(worlds, { recursive: true });
        let name = base; let n = 2;
        while (fs.existsSync(path.join(worlds, `${name}.json`))) name = `${base} (${n++})`;
        fs.writeFileSync(path.join(worlds, `${name}.json`), JSON.stringify({ entries }, null, 2));
        res.json({ ok: true, name, entries: Object.keys(entries).length });
    });

    ex.get('/installed', (req, res) => res.json({ items: Object.values(readLedger(req).items) }));

    ex.post('/uninstall', express.json({ limit: '4kb' }), (req, res) => {
        const id = String(req.body?.id || '');
        if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad id.' });
        const worlds = req.user.directories.worlds;
        for (const w of Object.values(W)) dropFrom(worlds, w, id);
        fs.rmSync(path.join(dataRoot(req), id), { recursive: true, force: true });
        const l = readLedger(req); delete l.items[id]; writeLedger(req, l);
        res.json({ ok: true });
    });

    ex.get('/local/:id/:name', (req, res) => {
        if (!ID_RE.test(req.params.id) || !/^(card|banner)$/.test(req.params.name)) return res.sendStatus(400);
        const dir = path.join(dataRoot(req), req.params.id);
        const f = ['webp', 'jpg', 'png'].map((e) => path.join(dir, `${req.params.name}.${e}`)).find((p) => fs.existsSync(p));
        if (!f) return res.sendStatus(404);
        res.sendFile(f);
    });
}
