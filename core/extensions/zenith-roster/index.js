/*
 * Zenith Roster - strict characters + the Roster-Downloader.
 *  - Importing or exporting characters is not possible in this fork. The server refuses it
 *    (see core/plugins/zenith-system/roster.mjs); this file shows the explanation popup.
 *  - The cloud button in the top bar opens the Roster-Downloader. Characters only appear in the
 *    Character List after they were downloaded there.
 *  - The Roster-Downloader has two layouts (Grid = cards, List = rows with a side menu) and always shows a
 *    transfer terminal on the right. Characters are split in Stored (not downloaded yet) and Local (ready to use);
 *    a Local character whose version is behind the roster shows HAS UPDATE.
 */
const API = '/api/plugins/zenith-system';
const ctx = () => SillyTavern.getContext();

const STRICT_TEXT = 'This ZenithTavern fork does not accept characters other than the ones it provides. '
    + 'If you want to import characters from a different source, you must use normal SillyTavern.';
const TITLES = { edit: 'Editing is not available', delete: 'Deleting is not available', import: 'Importing is not available', export: 'Exporting is not available', create: 'Creating cards is not available', duplicate: 'Copying is not available' };

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

// ------------------------------------------------------------ strict popup
let strictOpen = false;
async function showStrict(kind = 'import') {
    if (strictOpen) return;
    strictOpen = true;
    try {
        const { callGenericPopup, POPUP_TYPE } = ctx();
        const box = h('div', { class: 'zr-strict', 'data-keep-brand': '1' },
            h('div', { class: 'zr-lock fa-solid fa-lock' }),
            h('h3', {}, TITLES[kind] || TITLES.import),
            h('p', {}, kind === 'edit' || kind === 'delete' ? 'The characters in ZenithTavern are read-only: they cannot be edited or deleted here. To change a character, use normal SillyTavern.' : STRICT_TEXT),
            h('p', { class: 'zr-small' }, 'The characters made for ZenithTavern are in the Roster-Downloader (the cloud icon in the top bar).'));
        await callGenericPopup(box, POPUP_TYPE.TEXT, '', { okButton: 'Understood' });
    } finally { strictOpen = false; }
}

// Anything that still reaches the server and gets refused shows the same popup.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
    const res = await nativeFetch(...args);
    if (res.status === 403) {
        const url = String(args[0]?.url ?? args[0] ?? '');
        if (/\/api\/(characters|content)\//.test(url)) {
            res.clone().json().then((j) => { if (j?.zenithStrict) showStrict(j.zenithStrict); }).catch(() => {});
        }
    }
    return res;
};

let strictState = { strict: true, allowCreate: false };
const BLOCK = [
    ['#character_import_button', 'import'], ['#external_import_button', 'import'], ['.external_import_button', 'import'],
    ['#export_button', 'export'], ['#export_format_popup .export_format', 'export'],
];
document.addEventListener('click', (e) => {
    if (!strictState.strict) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const list = strictState.allowCreate ? BLOCK : [...BLOCK, ['#rm_button_create', 'create']];
    for (const [selector, kind] of list) {
        if (target.closest(selector)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            showStrict(kind);
            return;
        }
    }
}, true);

// ------------------------------------------------------------ Roster-Downloader
const PREF = 'zenith_roster';
const prefs = () => (ctx().extensionSettings[PREF] ??= { layout: 'grid' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let root = null;
let ui = {};              // references to the pieces of the open window
let data = null;          // { source, characters }
let loadError = null;     // { code, text }
let layout = 'grid';      // grid | list
let tab = 'stored';       // stored | local
let query = '';
let selection = new Set();
let working = false;
let termOpen = false;     // only matters on narrow screens (the terminal is always visible on wide ones)
let log = [];             // terminal lines: { text, kind, detail }
let bars = {};            // id -> { name, state: 'run' | 'ok' | 'bad' }

/** A short code for the terminal, from whatever went wrong. */
function codeOf(e) {
    const msg = String(e?.message || e || '');
    const http = msg.match(/HTTP (\d{3})/);
    if (http) return `E-HTTP-${http[1]}`;
    if (/checksum/i.test(msg)) return 'E-CHECKSUM';
    if (/not a valid character card/i.test(msg)) return 'E-CARD';
    if (/too large/i.test(msg)) return 'E-SIZE';
    if (/not in the roster/i.test(msg)) return 'E-MISSING';
    if (/fetch|network|timeout|abort|load failed/i.test(msg)) return 'E-NETWORK';
    return 'E-UNKNOWN';
}

async function loadRoster() {
    loadError = null;
    try {
        const res = await fetch(`${API}/roster`, { headers: ctx().getRequestHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
        data = body;
        selection = new Set([...selection].filter((id) => data.characters.some((c) => c.id === id && (!c.installed || c.updateAvailable))));
        return true;
    } catch (e) { loadError = { code: codeOf(e), text: String(e.message || e) }; return false; }
}

const all = () => data?.characters || [];
const stored = () => all().filter((c) => !c.installed);
const updates = () => all().filter((c) => c.installed && c.updateAvailable);
const local = () => all().filter((c) => c.installed).sort((a, b) => (b.updateAvailable - a.updateAvailable) || a.name.localeCompare(b.name));
const pending = () => all().filter((c) => !c.installed || c.updateAvailable);
const selectable = (c) => !c.installed || c.updateAvailable;
const thumb = (id) => `${API}/roster/thumb/${encodeURIComponent(id)}`;

function visible() {
    const base = tab === 'local' ? local() : stored().sort((a, b) => a.name.localeCompare(b.name));
    const q = query.trim().toLowerCase();
    return q ? base.filter((c) => `${c.name} ${c.tagline} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q)) : base;
}

function statusOf(c) {
    if (bars[c.id]?.state === 'run') return { label: 'DOWNLOADING', cls: 'zr-s-run' };
    if (c.installed && c.updateAvailable) return { label: 'HAS UPDATE', cls: 'zr-s-up' };
    if (c.installed) return { label: 'READY', cls: 'zr-s-ok' };
    return { label: 'STORED', cls: 'zr-s-st' };
}

// ------------------------------------------------------------ terminal
function say(text, kind = '', detail = '') { log.push({ text, kind, detail }); drawTerm(); }

function drawTerm() {
    if (!ui.lines) return;
    ui.lines.replaceChildren(...log.map((l) => h('div', { class: `zr-line ${l.kind}` },
        h('span', { class: 'zr-prompt' }, l.kind === 'zr-ok' ? '✓' : l.kind === 'zr-bad' ? '✗' : '>'),
        h('span', { class: 'zr-ltext' }, l.text, l.detail ? h('small', {}, l.detail) : null))));
    ui.lines.scrollTop = ui.lines.scrollHeight;
}

function drawBars() {
    if (!ui.bars) return;
    ui.bars.replaceChildren(...Object.values(bars).map((b) => h('div', { class: `zr-prog zr-p-${b.state}` },
        h('div', { class: 'zr-prog-top' }, h('span', {}, b.name), h('span', {}, b.state === 'run' ? '…' : b.state === 'ok' ? '100%' : 'FAILED')),
        h('div', { class: 'zr-track' }, h('i')))));
}

function showTerm() { termOpen = true; winClass(); }

// ------------------------------------------------------------ actions
async function connect() {
    say('CONNECTING TO STORAGE…');
    await wait(250);
    if (await loadRoster()) { say('STORAGE CONNECTED', 'zr-ok'); return true; }
    say(`FAILED CONNECTION, CONTACT SUPPORT (${loadError.code})`, 'zr-bad', loadError.text);
    return false;
}

async function closeConnection() {
    say('CLOSING CONNECTION…');
    await wait(300);
    say('CONNECTION CLOSED.');
    await wait(150);
}

async function cleanup(ids) {
    try {
        const res = await fetch(`${API}/roster/cleanup`, {
            method: 'POST', headers: { ...ctx().getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
        return body.removed || 0;
    } catch (e) { say(`COULD NOT CHECK THE FILES (${codeOf(e)})`, 'zr-bad', String(e.message || e)); return 0; }
}

async function runDownload(ids) {
    if (working || !ids.length) return;
    working = true; bars = {}; showTerm(); drawBars(); drawAll();
    if (!(await connect())) { await closeConnection(); working = false; drawAll(); return; }
    const targets = ids.map((id) => all().find((c) => c.id === id)).filter(Boolean);
    const done = [];
    for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        bars[c.id] = { name: c.name, state: 'run' };
        say(`DOWNLOADING ${c.name.toUpperCase()}… [${i}/${targets.length}]`);
        drawBars(); drawBody();
        try {
            const res = await fetch(`${API}/roster/download`, {
                method: 'POST', headers: { ...ctx().getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [c.id] }),
            });
            const body = await res.json().catch(() => ({}));
            const r = body.results?.[0];
            if (!res.ok || !r?.ok) throw new Error(r?.error || body.message || `HTTP ${res.status}`);
            bars[c.id].state = 'ok';
            done.push(c);
            say(`${c.name.toUpperCase()} IS DOWNLOADED AND READY FOR USE`, 'zr-ok');
        } catch (e) {
            bars[c.id].state = 'bad';
            say(`${c.name.toUpperCase()} COULDN'T BE DOWNLOADED (${codeOf(e)})`, 'zr-bad', String(e.message || e));
        }
        drawBars(); drawBody();
        await wait(150);
    }
    await closeConnection();
    if (done.length) {
        say('CHECKING FOR FILES MISMATCH…');
        await wait(250);
        const removed = await cleanup(done.map((c) => c.id));
        say(removed ? `${removed} OUTDATED FILE${removed === 1 ? '' : 'S'} REMOVED` : 'NO MISMATCHED FILES FOUND', removed ? 'zr-ok' : '');
        try { await ctx().getCharacters(); } catch (e) { console.warn('[Zenith Roster] could not refresh the list', e); }
    }
    await loadRoster();
    say(done.length ? `SEQUENCE FINISHED - YOU CAN NOW GO CHAT WITH ${done.map((c) => c.name.toUpperCase()).join(', ')}` : 'SEQUENCE FINISHED - NOTHING WAS DOWNLOADED', done.length ? 'zr-ok' : 'zr-bad');
    working = false;
    drawAll();
}

async function checkUpdates() {
    if (working) return;
    working = true; showTerm(); drawAll();
    if (await connect()) {
        const up = updates().length, fresh = stored().length;
        say(up ? `${up} CHARACTER${up === 1 ? '' : 'S'} ${up === 1 ? 'HAS AN' : 'HAVE'} UPDATE${up === 1 ? '' : 'S'}` : 'EVERYTHING YOU HAVE IS UP TO DATE', up ? 'zr-ok' : '');
        say(fresh ? `${fresh} CHARACTER${fresh === 1 ? '' : 'S'} WAITING IN STORAGE` : 'NOTHING NEW IN STORAGE');
    }
    await closeConnection();
    say('SEQUENCE FINISHED');
    working = false;
    drawAll();
}

// ------------------------------------------------------------ drawing
function pick(c, on) { if (on) selection.add(c.id); else selection.delete(c.id); drawActions(); drawBody(); }

function chip(c) { const s = statusOf(c); return h('span', { class: `zr-chip ${s.cls}` }, s.label); }

function cardEl(c) {
    const can = selectable(c) && !working;
    const checked = selection.has(c.id);
    return h('label', { class: `zr-card${!selectable(c) ? ' zr-have' : ''}${checked ? ' zr-sel' : ''}${c.updateAvailable ? ' zr-up' : ''}` },
        h('input', { type: 'checkbox', class: 'zr-check', checked, disabled: !can, onchange: (e) => pick(c, e.target.checked) }),
        h('span', { class: 'zr-box', 'aria-hidden': 'true' }),
        h('img', { class: 'zr-pic', src: thumb(c.id), alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
        h('div', { class: 'zr-info' },
            h('b', { class: 'zr-name' }, c.name),
            c.tagline ? h('span', { class: 'zr-tag' }, c.tagline) : null,
            chip(c)));
}

function rowEl(c) {
    const can = selectable(c) && !working;
    const checked = selection.has(c.id);
    const busy = bars[c.id]?.state === 'run';
    const icon = busy ? 'fa-circle-notch fa-spin' : c.installed && c.updateAvailable ? 'fa-rotate' : c.installed ? 'fa-check' : 'fa-download';
    return h('div', { class: `zr-row${checked ? ' zr-sel' : ''}${c.updateAvailable ? ' zr-up' : ''}${!selectable(c) ? ' zr-have' : ''}`, onclick: () => { if (can) pick(c, !checked); } },
        h('img', { class: 'zr-banner', src: thumb(c.id), alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
        h('span', { class: 'zr-rbox' + (checked ? ' zr-on' : '') + (selectable(c) ? '' : ' zr-off'), 'aria-hidden': 'true' }),
        h('b', { class: 'zr-rname' }, c.name, c.tagline ? h('small', {}, c.tagline) : null),
        chip(c),
        h('button', { type: 'button', class: 'zr-ract', title: c.installed && !c.updateAvailable ? 'Ready' : c.updateAvailable ? 'Update' : 'Download', disabled: !can,
            onclick: (e) => { e.stopPropagation(); runDownload([c.id]); } }, h('i', { class: `fa-solid ${icon}` })));
}

function drawBody() {
    if (!ui.body) return;
    const scroll = ui.body.scrollTop;
    ui.body.replaceChildren();
    if (!data) {
        ui.body.append(h('p', { class: `zr-empty${loadError ? ' zr-bad' : ''}` }, loadError ? `${loadError.code}: ${loadError.text}` : 'Loading the roster…'));
    } else if (!all().length) {
        ui.body.append(h('p', { class: 'zr-empty' }, 'The roster is empty right now. Characters made for ZenithTavern will show up here, ready to download.'));
    } else {
        const list = visible();
        const up = updates();
        if (tab === 'local' && up.length && !query.trim()) {
            ui.body.append(h('button', { type: 'button', class: 'zr-banner-up', disabled: working, onclick: () => runDownload(up.map((c) => c.id)) },
                h('i', { class: 'fa-solid fa-triangle-exclamation' }), `${up.length} HAVE UPDATES`, h('small', {}, 'Click to update all')));
        }
        if (!list.length) {
            ui.body.append(h('p', { class: 'zr-empty' }, query.trim() ? 'No character matches your search.' : tab === 'local' ? 'Nothing downloaded yet. Open the Stored tab to pick characters.' : 'Everything in storage is already on your computer.'));
        } else if (layout === 'list') {
            const selectableList = list.filter(selectable);
            const allOn = selectableList.length > 0 && selectableList.every((c) => selection.has(c.id));
            ui.body.append(h('div', { class: 'zr-listhead' },
                h('span', { class: 'zr-rbox zr-head-box' + (allOn ? ' zr-on' : '') + (selectableList.length ? '' : ' zr-off'), role: 'checkbox', 'aria-checked': String(allOn), title: 'Select all',
                    onclick: () => { if (!selectableList.length || working) return; for (const c of selectableList) { if (allOn) selection.delete(c.id); else selection.add(c.id); } drawActions(); drawBody(); } }),
                h('span', { class: 'zr-lh-name' }, 'CHARACTER NAME'), h('span', { class: 'zr-lh-status' }, 'STATUS'), h('span', { class: 'zr-lh-act' }, 'ACTION')));
            ui.body.append(h('div', { class: 'zr-rows' }, list.map(rowEl)));
        } else {
            ui.body.append(h('div', { class: 'zr-grid' }, list.map(cardEl)));
        }
    }
    ui.body.scrollTop = scroll;
}

function drawTabs() {
    if (!ui.tabs) return;
    const up = updates().length;
    const mk = (id, label, n, badge) => h('button', { type: 'button', class: `zr-tab${tab === id ? ' zr-on' : ''}`, onclick: () => { tab = id; drawTabs(); drawBody(); } },
        label, h('em', {}, String(n)), badge ? h('i', { class: 'zr-tabdot', title: 'Updates available' }) : null);
    ui.tabs.replaceChildren(mk('stored', 'Stored', stored().length, false), mk('local', 'Local', local().length, up > 0));
}

function drawActions() {
    if (!ui.actions) return;
    const up = updates().length, fresh = pending().length, sel = selection.size;
    const btn = (icon, label, onClick, disabled, extra = '') => h('button', { type: 'button', class: `menu_button zr-btn ${extra}`, disabled, onclick: onClick }, h('i', { class: `fa-solid ${icon}` }), h('span', {}, label));
    ui.actions.replaceChildren(
        btn('fa-magnifying-glass', 'Check for Updates', checkUpdates, working),
        btn('fa-rotate', `Update All${up ? ` (${up})` : ''}`, () => runDownload(updates().map((c) => c.id)), working || !up),
        btn('fa-download', `Download Selected${sel ? ` (${sel})` : ''}`, () => runDownload([...selection]), working || !sel),
        btn('fa-cloud-arrow-down', `Download All${fresh ? ` (${fresh})` : ''}`, () => runDownload(pending().map((c) => c.id)), working || !fresh, 'zr-primary'));
}

function winClass() {
    if (!root) return;
    root.querySelector('.zr-window').className = `zr-window zr-layout-${layout}${termOpen ? ' zr-term-open' : ''}${working ? ' zr-working' : ''}`;
}

function applyLayout() {
    if (!root) return;
    winClass();
    (layout === 'list' ? ui.side : ui.foot).append(ui.actions);
    ui.lgrid.classList.toggle('zr-on', layout === 'grid');
    ui.llist.classList.toggle('zr-on', layout === 'list');
}

function setLayout(next) {
    if (layout === next) return;
    layout = next; prefs().layout = next; ctx().saveSettingsDebounced();
    applyLayout(); drawBody();
}

function drawAll() { winClass(); drawTabs(); drawActions(); drawBody(); drawBars(); drawTerm(); }

async function open() {
    if (root) return;
    layout = prefs().layout === 'list' ? 'list' : 'grid';
    log = []; bars = {}; query = ''; termOpen = false;
    ui.actions = h('div', { class: 'zr-actions' });
    ui.lgrid = h('button', { type: 'button', class: 'zr-lbtn', title: 'Grid layout', onclick: () => setLayout('grid') }, h('i', { class: 'fa-solid fa-table-cells-large' }), h('span', {}, 'Grid'));
    ui.llist = h('button', { type: 'button', class: 'zr-lbtn', title: 'List layout', onclick: () => setLayout('list') }, h('i', { class: 'fa-solid fa-list' }), h('span', {}, 'List'));
    ui.tabs = h('div', { class: 'zr-tabs' });
    ui.body = h('div', { class: 'zr-body' });
    ui.side = h('aside', { class: 'zr-side' });
    ui.foot = h('footer', { class: 'zr-foot' });
    ui.lines = h('div', { class: 'zr-lines', 'aria-live': 'polite' });
    ui.bars = h('div', { class: 'zr-bars' });
    const search = h('input', { type: 'search', class: 'text_pole zr-search', placeholder: 'Search characters…', oninput: (e) => { query = e.target.value; drawBody(); } });
    root = h('div', { id: 'zenith_roster_overlay', class: 'zr-overlay', onclick: (e) => { if (e.target === root && !working) close(); } },
        h('section', { class: 'zr-window', role: 'dialog', 'aria-label': 'Roster-Downloader' },
            h('header', { class: 'zr-head' },
                h('b', {}, '☁ Roster-Downloader'),
                h('div', { class: 'zr-layouts' }, ui.lgrid, ui.llist),
                h('button', { type: 'button', class: 'zr-x', title: 'Close', onclick: () => { if (!working) close(); } }, '✕')),
            h('div', { class: 'zr-main' },
                ui.side,
                h('section', { class: 'zr-center' },
                    h('div', { class: 'zr-toolbar' }, search, ui.tabs,
                        h('button', { type: 'button', class: 'menu_button zr-termbtn', onclick: () => { termOpen = !termOpen; winClass(); } }, h('i', { class: 'fa-solid fa-terminal' }), 'Terminal')),
                    ui.body, ui.foot),
                h('aside', { class: 'zr-term' },
                    h('div', { class: 'zr-term-head' }, h('b', {}, '>_ TRANSFER LOG'),
                        h('button', { type: 'button', class: 'zr-tclear', title: 'Clear', onclick: () => { if (!working) { log = []; bars = {}; drawTerm(); drawBars(); } } }, h('i', { class: 'fa-solid fa-trash-can' }))),
                    ui.lines, ui.bars))));
    document.body.append(root);
    document.getElementById('zenith_roster_btn')?.classList.add('zr-active');
    applyLayout(); drawAll();
    say('READY. PICK CHARACTERS AND PRESS DOWNLOAD.');
    const ok = await loadRoster();
    if (ok && !stored().length && local().length) tab = 'local';
    else if (ok && updates().length && !stored().length) tab = 'local';
    if (!ok) say(`COULD NOT READ THE ROSTER (${loadError.code})`, 'zr-bad', loadError.text);
    drawAll();
}

function close() {
    if (root) { const gone = root; gone.classList.add('zr-out'); setTimeout(() => gone.remove(), 180); }
    root = null; ui = {};
    document.getElementById('zenith_roster_btn')?.classList.remove('zr-active');
}

function mount() {
    if (document.getElementById('zenith_roster_btn')) return;
    const button = h('div', { id: 'zenith_roster_btn', class: 'drawer', onclick: () => (root ? close() : open()) },
        h('div', { class: 'drawer-toggle' }, h('div', { class: 'drawer-icon fa-solid fa-cloud-arrow-down fa-fw closedIcon', title: 'Roster-Downloader' })));
    // between the Music player and the Character List
    const list = document.getElementById('rightNavHolder');
    const music = document.getElementById('zenith_music_btn');
    if (list) list.before(button); else if (music) music.after(button); else document.getElementById('top-settings-holder')?.append(button);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root && !working && !document.querySelector('dialog[open]')) close(); });

// the name field is shown but cannot be typed in; no keyboard route around the hidden panel either
function lockName() {
    const el = document.getElementById('character_name_pole');
    if (el && !document.body.classList.contains('zenith-dev')) { el.readOnly = true; el.tabIndex = -1; }
}

jQuery(async () => {
    mount();
    lockName();
    ctx().eventSource.on(ctx().eventTypes.CHAT_CHANGED, lockName);
    try {
        const res = await fetch(`${API}/strict`, { headers: ctx().getRequestHeaders() });
        if (res.ok) strictState = await res.json();
    } catch { /* keep defaults */ }
    ctx().SlashCommandParser?.addCommandObject?.(ctx().SlashCommand.fromProps({
        name: 'roster', helpString: 'Opens the Roster-Downloader.', callback: async () => { await open(); return ''; },
    }));
});
