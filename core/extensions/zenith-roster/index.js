/*
 * Zenith Roster - strict characters + the Roster-Downloader.
 *  - Importing or exporting characters is not possible in this fork. The server refuses it
 *    (see core/plugins/zenith-system/roster.mjs); this file shows the explanation popup.
 *  - The cloud button in the top bar opens the Roster-Downloader. Characters only appear in the
 *    Character List after they were downloaded there.
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
let root = null;
let data = null;       // { source, characters }
let selection = new Set();
let working = false;
let status = '';
let statusKind = '';
let progress = null;   // { done, total }
let loadError = '';

async function loadRoster() {
    loadError = '';
    try {
        const res = await fetch(`${API}/roster`, { headers: ctx().getRequestHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
        data = body;
        selection = new Set([...selection].filter((id) => data.characters.some((c) => c.id === id && (!c.installed || c.updateAvailable))));
    } catch (e) { data = null; loadError = String(e.message || e); }
}

const pending = () => (data?.characters || []).filter((c) => !c.installed || c.updateAvailable);

async function download(ids) {
    if (working || !ids.length) return;
    working = true; progress = { done: 0, total: ids.length }; status = ''; statusKind = '';
    render();
    let ok = 0; const failed = [];
    for (const id of ids) {
        try {
            const res = await fetch(`${API}/roster/download`, {
                method: 'POST', headers: { ...ctx().getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [id] }),
            });
            const body = await res.json().catch(() => ({}));
            const r = body.results?.[0];
            if (res.ok && r?.ok) ok++; else failed.push(`${data?.characters.find((c) => c.id === id)?.name || id}: ${r?.error || body.message || 'failed'}`);
        } catch (e) { failed.push(`${id}: ${e.message || e}`); }
        progress.done++;
        render();
    }
    working = false; progress = null;
    await loadRoster();
    if (ok) { try { await ctx().getCharacters(); } catch (e) { console.warn('[Zenith Roster] could not refresh the list', e); } }
    status = failed.length ? `${ok} downloaded, ${failed.length} failed. ${failed.join(' | ')}` : `Done. ${ok} character${ok === 1 ? '' : 's'} added to your Character List.`;
    statusKind = failed.length ? 'zr-bad' : 'zr-good';
    render();
}

function card(c) {
    const can = !c.installed || c.updateAvailable;
    const checked = selection.has(c.id);
    return h('label', { class: `zr-card${c.installed && !c.updateAvailable ? ' zr-have' : ''}${checked ? ' zr-sel' : ''}` },
        h('input', { type: 'checkbox', class: 'zr-check', checked, disabled: !can || working, onchange: (e) => { e.target.checked ? selection.add(c.id) : selection.delete(c.id); render(); } }),
        h('span', { class: 'zr-box', 'aria-hidden': 'true' }),
        h('img', { class: 'zr-pic', src: `${API}/roster/thumb/${encodeURIComponent(c.id)}`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
        h('div', { class: 'zr-info' },
            h('b', { class: 'zr-name' }, c.name),
            c.tagline ? h('span', { class: 'zr-tag' }, c.tagline) : null,
            h('span', { class: 'zr-state' }, c.updateAvailable ? 'Update available' : c.installed ? 'In your Character List' : 'Not downloaded')));
}

function render() {
    if (!root) return;
    const body = root.querySelector('.zr-body');
    const foot = root.querySelector('.zr-foot');
    body.replaceChildren();
    foot.replaceChildren();
    if (loadError) { body.append(h('p', { class: 'zr-empty zr-bad' }, loadError)); }
    else if (!data) { body.append(h('p', { class: 'zr-empty' }, 'Loading the roster…')); }
    else if (!data.characters.length) {
        body.append(h('p', { class: 'zr-empty' }, 'The roster is empty right now. Characters made for ZenithTavern will show up here, ready to download.'));
    } else {
        body.append(h('div', { class: 'zr-grid' }, data.characters.map(card)));
    }
    const todo = pending();
    const busy = working;
    if (progress) foot.append(h('div', { class: 'zr-bar' }, h('i', { style: `width:${Math.round((progress.done / progress.total) * 100)}%` }), h('span', {}, `Downloading ${progress.done}/${progress.total}`)));
    else if (status) foot.append(h('p', { class: `zr-status ${statusKind}` }, status));
    foot.append(h('div', { class: 'zr-actions' },
        h('button', { type: 'button', class: 'menu_button zr-btn', disabled: busy || !selection.size, onclick: () => download([...selection]) }, `Download Selected${selection.size ? ` (${selection.size})` : ''}`),
        h('button', { type: 'button', class: 'menu_button zr-btn zr-primary', disabled: busy || !todo.length, onclick: () => download(todo.map((c) => c.id)) }, 'Download All')));
}

async function open() {
    if (root) return;
    root = h('div', { id: 'zenith_roster_overlay', class: 'zr-overlay', onclick: (e) => { if (e.target === root && !working) close(); } },
        h('section', { class: 'zr-window', role: 'dialog', 'aria-label': 'Roster-Downloader' },
            h('header', { class: 'zr-head' }, h('b', {}, '☁ Roster-Downloader'), h('button', { type: 'button', class: 'zr-x', title: 'Close', onclick: () => { if (!working) close(); } }, '✕')),
            h('p', { class: 'zr-lead' }, 'Pick the characters you want. After downloading, they appear in your Character List.'),
            h('div', { class: 'zr-body' }),
            h('footer', { class: 'zr-foot' })));
    document.body.append(root);
    document.getElementById('zenith_roster_btn')?.classList.add('zr-active');
    status = ''; render();
    await loadRoster(); render();
}

function close() {
    if (root) { const gone = root; gone.classList.add('zr-out'); setTimeout(() => gone.remove(), 180); }
    root = null;
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
