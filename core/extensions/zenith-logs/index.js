/*
 * Zenith Log Terminal - a read-only window with every message, warning and error, with timestamps.
 *
 *  Browser tab: console.log/info/warn/error/debug, uncaught errors, the little toast messages that
 *               pop up at the top of the screen, and failed network requests.
 *  Server tab:  the live server log (logs/server.log).
 *
 * This file loads FIRST (loading_order 1) so it can catch what happens while the page is starting up.
 */
const MAX = 3000;
const API = '/api/plugins/zenith-system/logs';
const entries = [];            // browser log: { t, level, source, text }
const subs = new Set();

// ---------------------------------------------------------------- collecting
function push(level, source, text) {
    const e = { t: Date.now(), level, source, text };
    entries.push(e);
    if (entries.length > MAX) entries.shift();
    for (const f of subs) { try { f(e); } catch { /* a closed window must never break logging */ } }
}

function show(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (value === undefined) return 'undefined';
    try {
        const seen = new WeakSet();
        const out = JSON.stringify(value, (_k, v) => {
            if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[circular]'; seen.add(v); }
            if (typeof v === 'function') return `[function ${v.name || ''}]`;
            if (typeof v === 'bigint') return String(v);
            return v;
        });
        return out === undefined ? String(value) : (out.length > 1200 ? `${out.slice(0, 1200)}… (${out.length} characters)` : out);
    } catch { return String(value); }
}

function format(args) {
    const list = [...args];
    if (typeof list[0] === 'string' && list[0].includes('%c')) {   // "%cText", "css" style calls
        let i = 1;
        list[0] = list[0].replace(/%c/g, () => { list.splice(i, 1); return ''; });
    }
    return list.map(show).join(' ');
}

for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        try { push(level, 'console', format(args)); } catch { /* never block the real console */ }
        original(...args);
    };
}

window.addEventListener('error', (e) => {
    if (e.target && e.target !== window && e.target.getAttribute) {                    // an image / script / stylesheet failed
        const raw = e.target.getAttribute('src') || e.target.getAttribute('href');
        if (raw) push('warn', 'page', `Failed to load ${raw}`);
    } else {
        push('error', 'page', `${e.message}${e.filename ? `  (${e.filename.split('/').slice(-2).join('/')}:${e.lineno})` : ''}`);
    }
}, true);
window.addEventListener('unhandledrejection', (e) => push('error', 'page', `Unhandled promise rejection: ${show(e.reason)}`));

function wrapToastr() {
    if (typeof toastr === 'undefined' || toastr.__zenithLogs) return !!(typeof toastr !== 'undefined');
    toastr.__zenithLogs = true;
    const map = { success: 'info', info: 'info', warning: 'warn', error: 'error' };
    for (const kind of Object.keys(map)) {
        const original = toastr[kind];
        toastr[kind] = function (message, title, ...rest) {
            try {
                const text = String(message ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                push(map[kind], 'toast', title ? `${title}: ${text}` : text);
            } catch { /* ignore */ }
            return original.call(this, message, title, ...rest);
        };
    }
    return true;
}
if (!wrapToastr()) { const t = setInterval(() => { if (wrapToastr()) clearInterval(t); }, 200); setTimeout(() => clearInterval(t), 20000); }

// network: failures of the app's own API, plus the generation/status calls so you can see them happen
const realFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = (init?.method || input?.method || 'GET').toUpperCase();
    const quiet = path.startsWith('/api/plugins/zenith-system/logs');
    const t0 = performance.now();
    try {
        const res = await realFetch(input, init);
        if (!quiet) {
            const ms = Math.round(performance.now() - t0);
            const watched = /\/generate|\/status|\/api\/backends\//.test(path);
            if (!res.ok && (path.startsWith('/api/') || res.status >= 500)) push(res.status >= 500 ? 'error' : 'warn', 'network', `${method} ${path} → ${res.status} ${res.statusText || ''} (${ms} ms)`);
            else if (res.ok && watched && method !== 'GET') push('info', 'network', `${method} ${path} → ${res.status} (${ms} ms)`);
        }
        return res;
    } catch (err) {
        if (!quiet && err?.name !== 'AbortError') push('error', 'network', `${method} ${path} failed: ${err?.message || err}`);
        throw err;
    }
};

push('info', 'terminal', 'Log Terminal started');

// ---------------------------------------------------------------- the window
const ctx = () => SillyTavern.getContext();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(t)}`; };

function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
}

// server log state (kept between openings)
const serverEntries = [];
let serverOffset = null;
let serverMissing = false;

const ANSI = /\x1b\[[0-9;]*m/g;
function levelOfLine(line) {
    if (/\b(error|err!|exception|failed|fatal|unhandled)\b/i.test(line)) return 'error';
    if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
    return 'info';
}

async function pollServer() {
    try {
        const url = `${API}${serverOffset === null ? '' : `?from=${serverOffset}`}`;
        const res = await realFetch(url, { headers: ctx().getRequestHeaders() });
        const data = await res.json();
        serverMissing = !!data.missing;
        if (serverOffset !== null && data.start < serverOffset) serverEntries.length = 0;
        const firstLoad = serverOffset === null;
        serverOffset = data.size;
        const lines = String(data.text || '').replace(ANSI, '').split(/\r?\n/).filter((l) => l.trim());
        const now = Date.now();
        for (const text of lines) serverEntries.push({ t: firstLoad ? null : now, level: levelOfLine(text), source: 'server', text });
        if (serverEntries.length > MAX) serverEntries.splice(0, serverEntries.length - MAX);
        return lines.length > 0;
    } catch { return false; }
}

const LEVELS = [['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info'], ['log', 'Log'], ['debug', 'Debug']];

async function openTerminal() {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const view = { tab: 'browser', search: '', follow: true, show: { error: true, warn: true, info: true, log: true, debug: false } };
    let timer = null;

    const list = h('div', { class: 'zlt-list' });
    const count = h('span', { class: 'zlt-count' });
    const bar = h('div', { class: 'zlt-bar' });
    const tabs = h('div', { class: 'zlt-tabs' });

    const source = () => (view.tab === 'browser' ? entries : serverEntries);
    const visible = (e) => view.show[e.level] && (!view.search || (e.text + e.source).toLowerCase().includes(view.search));
    const row = (e) => h('div', { class: `zlt-row zlt-${e.level}` },
        h('span', { class: 'zlt-time' }, e.t ? clock(e.t) : '--:--:--.---'),
        h('span', { class: 'zlt-tag' }, e.source),
        h('span', { class: 'zlt-text' }, e.text));

    function scrollDown() { if (view.follow) list.scrollTop = list.scrollHeight; }
    function drawAll() {
        const shown = source().filter(visible);
        list.replaceChildren(...shown.slice(-1500).map(row));
        if (!shown.length) list.append(h('div', { class: 'zlt-empty' }, view.tab === 'server' && serverMissing ? 'No server log file found. (It exists when ZenithTavern is started with the launcher.)' : 'Nothing to show yet.'));
        count.textContent = `${shown.length} of ${source().length} lines`;
        scrollDown();
    }
    function addLive(e) {
        if (view.tab !== 'browser' || !visible(e)) return;
        list.querySelector('.zlt-empty')?.remove();
        list.append(row(e));
        while (list.childElementCount > 1500) list.firstChild.remove();
        count.textContent = `${list.childElementCount} of ${entries.length} lines`;
        scrollDown();
    }

    function drawBar() {
        const counts = {}; for (const e of source()) counts[e.level] = (counts[e.level] || 0) + 1;
        bar.replaceChildren(
            ...LEVELS.map(([k, label]) => {
                const box = h('input', { type: 'checkbox', ...(view.show[k] ? { checked: true } : {}) });
                box.addEventListener('change', () => { view.show[k] = box.checked; drawAll(); });
                return h('label', { class: `zlt-chip zlt-chip-${k}` }, box, ` ${label}`, h('small', {}, ` ${counts[k] || 0}`));
            }),
            (() => { const i = h('input', { type: 'search', class: 'text_pole zlt-search', placeholder: 'Search…' }); i.value = view.search; i.addEventListener('input', () => { view.search = i.value.toLowerCase(); drawAll(); }); return i; })());
    }
    function drawTabs() {
        tabs.replaceChildren(
            ...[['browser', 'Browser'], ['server', 'Server']].map(([k, label]) => h('button', { type: 'button', class: `menu_button zlt-tab${view.tab === k ? ' zlt-on' : ''}`, onclick: async () => { view.tab = k; drawTabs(); drawBar(); if (k === 'server' && serverOffset === null) await pollServer(); drawBar(); drawAll(); } }, label)),
            h('span', { class: 'zlt-spacer' }), count,
            h('label', { class: 'zlt-chip' }, (() => { const c = h('input', { type: 'checkbox', checked: true }); c.addEventListener('change', () => { view.follow = c.checked; scrollDown(); }); return c; })(), ' Follow'),
            h('button', { type: 'button', class: 'menu_button zlt-act', onclick: copyText }, 'Copy'),
            h('button', { type: 'button', class: 'menu_button zlt-act', onclick: saveText }, 'Save .txt'),
            h('button', { type: 'button', class: 'menu_button zlt-act', onclick: () => { source().length = 0; drawBar(); drawAll(); } }, 'Clear'));
    }
    const asText = () => source().filter(visible).map((e) => `${e.t ? stamp(e.t) : '----------------------'} [${e.level.toUpperCase()}] [${e.source}] ${e.text}`).join('\n');
    async function copyText() {
        try { await navigator.clipboard.writeText(asText()); toastr.success('Copied.'); }
        catch { const r = document.createRange(); r.selectNodeContents(list); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toastr.info('Selected. Press Ctrl+C to copy.'); }
    }
    function saveText() {
        const a = h('a', { href: URL.createObjectURL(new Blob([asText()], { type: 'text/plain' })), download: `zenithtavern-${view.tab}-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt` });
        document.body.append(a); a.click(); a.remove();
    }
    list.addEventListener('scroll', () => { /* if you scroll up by hand, stop following */
        const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
        const box = tabs.querySelector('.zlt-chip input'); if (box && view.follow && !atEnd) { view.follow = false; box.checked = false; }
    });

    const root = h('div', { class: 'zlt' }, h('h3', {}, '🖥 Log Terminal'), tabs, bar, list,
        h('div', { class: 'zlt-note' }, 'View only. Browser times are exact. Server lines are stamped when this window receives them.'));
    drawTabs(); drawBar(); drawAll();
    subs.add(addLive);
    timer = setInterval(async () => {
        if (view.tab === 'server' && await pollServer()) { drawBar(); drawAll(); } else if (view.tab === 'browser') drawBar();
    }, 1500);
    try {
        await callGenericPopup(root, POPUP_TYPE.TEXT, '', { wide: true, large: true, okButton: 'Close', allowVerticalScrolling: false });
    } finally { subs.delete(addLive); clearInterval(timer); }
}

// ---------------------------------------------------------------- the button (bottom of Settings)
function mountButton() {
    if (document.getElementById('zenith_logs_btn')) return;
    const api = document.getElementById('rm_api_block');
    if (!api) return;
    api.append(h('div', { id: 'zenith_logs_btn' },
        h('div', { class: 'menu_button menu_button_icon', onclick: openTerminal, title: 'Messages, warnings and errors with timestamps' },
            h('i', { class: 'fa-solid fa-terminal' }), h('span', {}, 'Log Terminal'))));
}

jQuery(() => {
    const { eventSource, eventTypes, SlashCommandParser, SlashCommand } = ctx();
    // after every other extension has finished moving things around, so the button ends up last
    eventSource.on(eventTypes.APP_READY, mountButton);
    setTimeout(mountButton, 4000);
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'logs',
        helpString: 'Opens the Log Terminal window.',
        callback: async () => { openTerminal(); return ''; },
    }));
});
