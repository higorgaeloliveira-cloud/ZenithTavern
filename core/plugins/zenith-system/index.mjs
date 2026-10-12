/*
 * Zenith System - server plugin managed by the launcher (refreshed on every launcher update).
 * Don't put your own code here; use overlay/plugins/ instead.
 *
 * Routes (all under /api/plugins/zenith-system/):
 *   GET  /ping     health check used by the launcher's --smoke-test
 *   GET  /presets  the locked "AI response" values from tavern.config.json (key "presets")
 *   POST   /music/upload       raw audio body + X-Filename header -> saved in the user's own data folder
 *   GET    /music/file/:file   streams a saved track (supports seeking)
 *   DELETE /music/file/:file   removes a saved track
 *   GET/POST /network          Multi-IP settings (saved in tavern.config.json, applied by the launcher on restart)
 *   POST /restart             asks the launcher to restart the server (exit code 43)
 *   GET  /logs?from=N         tail of logs/server.log from byte N (used by the Log Terminal)
 *   GET  /strict, GET /roster, GET /roster/thumb/:id, POST /roster/download   strict characters + Roster-Downloader (see roster.mjs)
 *   POST /decline  the user answered "No" on the first-run notice. Replies, then stops the server
 *                  with exit code 42, which the launcher recognizes as "declined" and closes quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import express from 'express';
import ipMatching from 'ip-matching';
import { installStrictGuards, setupRoster } from './roster.mjs';

// ROOT/SillyTavern/plugins/zenith-system/index.mjs -> ROOT/tavern.config.json
const CONFIG_PATH = new URL('../../../tavern.config.json', import.meta.url);
const DEFAULT_PRESETS = Object.freeze({ enforce: true, adaptive: true, maxContext: 200000, maxResponseTokens: 1000, temperature: 1 });

function readPresets() {
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return { ...DEFAULT_PRESETS, ...(cfg.presets || {}) };
    } catch {
        return { ...DEFAULT_PRESETS };
    }
}

// ---- network access (Multi-IP) ----
function readConfigFile() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function readNetwork() {
    const n = readConfigFile().network || {};
    return { multiIp: !!n.multiIp, ips: Array.isArray(n.ips) ? n.ips.filter((x) => typeof x === 'string') : [] };
}
let startedWith = JSON.stringify(readNetwork()); // what the running server was started with

/** Returns an error message, or null when the entry is a single IP or a reasonably narrow CIDR range. */
function checkIpEntry(entry) {
    const [addr, prefix, extra] = entry.split('/');
    const kind = net.isIP(addr);
    if (!kind || extra !== undefined) return 'Enter an IP address like 100.101.102.103 (a range like 100.64.0.0/10 also works).';
    if (/^(0\.0\.0\.0|::)$/.test(addr)) return 'That address would allow everything. Use the IP of your device.';
    if (prefix !== undefined) {
        const bits = Number(prefix);
        if (!/^\d+$/.test(prefix) || bits > (kind === 4 ? 32 : 128)) return 'The range size after the / is not valid.';
        if (bits < (kind === 4 ? 10 : 32)) return 'That range is too wide. Use a single IP, or a narrower range.';
    }
    try { ipMatching.getMatch(entry); } catch { return 'SillyTavern would not accept that address.'; }
    return null;
}

function localAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) {
            if (i.family !== 'IPv4' || i.internal) continue;
            const second = Number(i.address.split('.')[1]);
            out.push({ address: i.address, tailscale: i.address.startsWith('100.') && second >= 64 && second <= 127 });
        }
    }
    return out;
}

function networkState(request) {
    const state = readNetwork();
    return { ...state, restartNeeded: JSON.stringify(state) !== startedWith, port: request.socket.localPort, addresses: localAddresses() };
}

// ---- server log tail (for the Log Terminal) ----
const SERVER_LOG = new URL('../../../logs/server.log', import.meta.url);

async function readLogChunk(from) {
    let stat;
    try { stat = await fs.promises.stat(SERVER_LOG); } catch { return { size: 0, start: 0, text: '', missing: true }; }
    let start = Number.isFinite(from) && from >= 0 && from <= stat.size ? from : Math.max(0, stat.size - 65536);
    const length = Math.min(stat.size - start, 262144);
    const buffer = Buffer.alloc(length);
    const handle = await fs.promises.open(SERVER_LOG, 'r');
    try { await handle.read(buffer, 0, length, start); } finally { await handle.close(); }
    return { size: start + length, start, text: buffer.toString('utf8') };
}

// ---- music storage: one folder per ST user, inside their own data ----
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.webm']);
const FILE_RE = /^[a-f0-9-]{36}\.[a-z0-9]+$/;

function musicDir(request) {
    const root = request.user?.directories?.root
        || path.join(globalThis.DATA_ROOT, request.user?.profile?.handle || 'default-user');
    const dir = path.join(root, 'zenith-music');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export const info = {
    id: 'zenith-system',
    name: 'Zenith System',
    description: 'Launcher-managed server routes for ZenithTavern.',
};

export async function init(router) {
    const guardState = { ok: await installStrictGuards() };
    setupRoster(router, guardState);
    router.get('/ping', (_request, response) => {
        response.json({ ok: true, message: 'pong' });
    });

    router.get('/presets', (_request, response) => {
        response.json(readPresets());
    });

    router.get('/logs', async (request, response) => {
        try { response.json(await readLogChunk(Number(request.query.from))); }
        catch { response.json({ size: 0, start: 0, text: '', missing: true }); }
    });

    router.get('/network', (request, response) => response.json(networkState(request)));

    router.post('/network', (request, response) => {
        const body = request.body || {};
        const ips = [];
        for (const raw of Array.isArray(body.ips) ? body.ips : []) {
            const entry = String(raw).trim();
            const problem = checkIpEntry(entry);
            if (problem) return response.status(400).json({ error: `${entry || '(empty)'}: ${problem}` });
            if (!ips.includes(entry)) ips.push(entry);
        }
        try {
            const cfg = readConfigFile();
            cfg.network = { multiIp: !!body.multiIp, ips };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
        } catch (err) {
            console.error('[zenith-system] could not save network settings', err);
            return response.status(500).json({ error: 'Could not save the settings file.' });
        }
        response.json(networkState(request));
    });

    router.post('/restart', (_request, response) => {
        response.json({ ok: true });
        setTimeout(() => process.exit(43), 400);
    });

    router.post('/music/upload', express.raw({ type: '*/*', limit: '300mb' }), async (request, response) => {
        try {
            const name = decodeURIComponent(request.get('x-filename') || 'track');
            const ext = path.extname(name).toLowerCase();
            if (!AUDIO_EXT.has(ext)) return response.status(400).json({ error: 'Not a supported audio file.' });
            if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: 'Empty file.' });
            const file = `${crypto.randomUUID()}${ext}`;
            await fs.promises.writeFile(path.join(musicDir(request), file), request.body);
            response.json({ file, name, size: request.body.length });
        } catch (err) {
            console.error('[zenith-system] music upload failed', err);
            response.status(500).json({ error: 'Could not save the file.' });
        }
    });

    router.get('/music/file/:file', (request, response) => {
        if (!FILE_RE.test(request.params.file)) return response.sendStatus(400);
        response.sendFile(request.params.file, { root: musicDir(request) }, (err) => {
            if (err && !response.headersSent) response.sendStatus(404);
        });
    });

    router.delete('/music/file/:file', async (request, response) => {
        if (!FILE_RE.test(request.params.file)) return response.sendStatus(400);
        await fs.promises.rm(path.join(musicDir(request), request.params.file), { force: true });
        response.json({ ok: true });
    });

    router.post('/decline', (_request, response) => {
        response.json({ ok: true });
        setTimeout(() => process.exit(42), 400);
    });
}

export async function exit() { /* nothing to clean up */ }
