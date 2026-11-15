#!/usr/bin/env node
'use strict';
/*
 * Uploads the roster (cards, expression sprites, pictures and the character records) to the storage Worker (community/worker.js).
 *
 *   STORAGE_URL=https://zenith-storage.<account>.workers.dev STORAGE_KEY=<ADMIN_KEY> node tools/storage-sync.cjs
 *
 * It reads core/roster/roster.json and the files next to it, and only uploads what is new or changed (it compares sha256 with
 * what the storage already has). It never deletes anything from the storage: removing a stored file is done on the Worker's /admin page.
 * When something changed it asks the Worker to rebuild /roster.json. Without STORAGE_URL and STORAGE_KEY it does nothing and exits 0,
 * so the build workflow keeps working on a repository that has no storage set up.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = String(process.env.STORAGE_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.STORAGE_KEY || '').trim();
if (!BASE || !KEY) { console.log('[storage-sync] STORAGE_URL / STORAGE_KEY are not set. Skipping.'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..', 'core', 'roster');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, route, body, headers = {}) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(`${BASE}${route}`, { method, headers: { 'x-admin-key': KEY, ...headers }, body });
            const text = await res.text();
            let json = {};
            try { json = JSON.parse(text); } catch { /* not JSON */ }
            if (res.ok) return json;
            if (res.status === 403) throw Object.assign(new Error('The storage refused the key (403). Check STORAGE_KEY.'), { fatal: true });
            last = new Error(json.error || `HTTP ${res.status}`);
        } catch (e) {
            if (e.fatal) throw e;
            last = e;
        }
        await sleep(600 * attempt);
    }
    throw last;
}

(async () => {
    const manifestFile = path.join(ROOT, 'roster.json');
    if (!fs.existsSync(manifestFile)) { console.log('[storage-sync] core/roster/roster.json not found. Nothing to upload.'); return; }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const characters = Array.isArray(manifest.characters) ? manifest.characters : [];

    // what the storage already has
    const remote = new Map(((await call('GET', '/api/list')).files || []).map((f) => [f.path, f.sha256]));
    const remoteMetas = new Map(((await call('GET', '/api/metas')).items || []).map((m) => [m.id, JSON.stringify(m)]));

    let uploaded = 0, unchanged = 0, failed = 0, metaChanged = 0;
    for (const c of characters) {
        const rels = [c.card, c.thumb, ...(c.sprites || []).map((s) => s.path), ...(c.images || []).map((s) => s.path)].filter(Boolean);
        for (const rel of rels) {
            const file = path.join(ROOT, ...rel.split('/'));
            if (!fs.existsSync(file)) { console.warn(`[storage-sync] missing locally: ${rel}`); failed++; continue; }
            const buf = fs.readFileSync(file);
            if (remote.get(rel) === sha256(buf)) { unchanged++; continue; }
            try {
                await call('PUT', `/api/put?path=${encodeURIComponent(rel)}`, buf);
                uploaded++;
                console.log(`[storage-sync] uploaded ${rel} (${Math.round(buf.length / 1024)} KB)`);
            } catch (e) { failed++; console.warn(`[storage-sync] could not upload ${rel}: ${e.message}`); }
        }
        const rec = { id: c.id, name: c.name, file: c.file, tagline: c.tagline || '', tags: c.tags || [], version: c.version || 1 };
        if (c.thumb) rec.thumb = c.thumb;
        // compare with what is stored (the Worker keeps the same fields, plus "card" only when it was set)
        const stored = remoteMetas.get(c.id);
        const same = stored && (() => { try { const s = JSON.parse(stored); return ['name', 'file', 'tagline', 'version'].every((k) => s[k] === rec[k]) && JSON.stringify(s.tags || []) === JSON.stringify(rec.tags); } catch { return false; } })();
        if (!same) {
            try { await call('PUT', '/api/meta', JSON.stringify(rec), { 'content-type': 'application/json' }); metaChanged++; console.log(`[storage-sync] record saved: ${c.id} v${rec.version}`); }
            catch (e) { failed++; console.warn(`[storage-sync] could not save the record of ${c.id}: ${e.message}`); }
        }
    }

    if (uploaded || metaChanged) {
        const r = await call('POST', '/api/rebuild');
        console.log(`[storage-sync] roster rebuilt: ${r.characters} character(s), ${r.sprites} sprite(s)${r.skipped?.length ? `; skipped: ${r.skipped.join('; ')}` : ''}`);
    }
    console.log(`[storage-sync] done: ${uploaded} uploaded, ${unchanged} already there, ${metaChanged} record(s) saved, ${failed} problem(s).`);
    if (failed) process.exitCode = 1;
})().catch((e) => { console.error(`[storage-sync] ${e.message}`); process.exit(1); });
