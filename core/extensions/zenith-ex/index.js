/*
 * Zenith EX-Roster - the phone app where people create characters and places as lorebooks and share them.
 *   CREATE  character or location -> a bundle (text + card picture + expressions) -> published to the community server
 *           (public = listed for everyone, private = only people with the share code)
 *   IMPORT  characters, locations or a whole lorebook file -> installed as lorebooks in this ZenithTavern
 * The server side is core/plugins/zenith-system/exroster.mjs; the community server is community/worker.js.
 */
const API = '/api/plugins/zenith-system/exroster';
const ctx = () => SillyTavern.getContext();
const LS_DRAFT = 'zenith_ex_draft', LS_MINE = 'zenith_ex_mine', LS_AUTHOR = 'zenith_ex_author';
const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'embarrassed', 'nervous', 'smirk', 'love', 'scared', 'tired', 'thinking', 'laughing', 'crying', 'flirty', 'blushing'];
const MAX_TOTAL = 2_300_000;

const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
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
const say = (msg, type = 'info') => { try { globalThis.toastr?.[type]?.(msg, 'EX-Roster'); } catch { /* no toastr */ } };

async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, cache: 'no-store' };
    if (body !== undefined) { opts.headers = ctx().getRequestHeaders(); opts.body = JSON.stringify(body); } else opts.headers = ctx().getRequestHeaders();
    let r;
    try { r = await fetch(`${API}${path}`, opts); } catch { throw new Error('No connection.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
}

// ------------------------------------------------------------ pictures
/** Shrinks a picture to a small WebP data URL (falls back to JPEG where WebP cannot be written). */
function toSmall(file, maxW, maxH, limit = 380_000) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            let k = Math.min(1, maxW / img.width, maxH / img.height);
            for (let i = 0; i < 6; i++) {
                const cv = document.createElement('canvas');
                cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                for (const q of [0.82, 0.7, 0.58]) {
                    let out = cv.toDataURL('image/webp', q);
                    if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/jpeg', q);
                    if (out.length <= limit) return resolve(out);
                }
                k *= 0.8;
            }
            reject(new Error('That picture is too detailed to shrink enough.'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
        img.src = url;
    });
}
function pickFile(accept) {
    return new Promise((resolve) => {
        const inp = h('input', { type: 'file', accept, style: 'display:none' });
        inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
        document.body.append(inp); inp.click();
    });
}

// ------------------------------------------------------------ state
let root = null, body = null, titleEl = null, backBtn = null;
let view = 'home';
const emptyChar = () => ({ name: '', age: '', species: '', summary: '', description: '', personality: '', prompt: '', restrictions: '', places: '', when: '', keys: '' });
const emptyPlace = () => ({ name: '', summary: '', description: '', keys: '', hours: '', residents: '', prompt: '' });
const draft = ls.get(LS_DRAFT, {});
const forms = { character: { ...emptyChar(), ...(draft.character || {}) }, location: { ...emptyPlace(), ...(draft.location || {}) } };
const media = { character: { card: '', expressions: {} }, location: { banner: '' } };
let createKind = 'character', visibility = 'public', adultOk = false, author = ls.get(LS_AUTHOR, '');
let importTab = 'character', importQuery = '';
const saveDraft = () => ls.set(LS_DRAFT, forms);

// ------------------------------------------------------------ small widgets
const field = (label, input, hint) => h('label', { class: 'zx-field' }, h('span', { class: 'zx-label' }, label), input, hint ? h('small', {}, hint) : null);
function text(kind, key, { area = false, rows = 4, ph = '', type = 'text', min } = {}) {
    const el = h(area ? 'textarea' : 'input', { class: 'zx-in', placeholder: ph, ...(area ? { rows } : { type }), ...(min != null ? { min } : {}) });
    el.value = forms[kind][key] || '';
    el.addEventListener('input', () => { forms[kind][key] = el.value; saveDraft(); updateSize(); });
    return el;
}
const seg = (items, cur, on) => h('div', { class: 'zx-seg' }, items.map(([v, l]) => h('button', { type: 'button', class: v === cur ? 'zx-on' : '', onclick: () => on(v) }, l)));
const big = (icon, title, sub, on) => h('button', { type: 'button', class: 'zx-big', onclick: on }, h('i', { class: `fa-solid ${icon}` }), h('b', {}, title), h('span', {}, sub));

// ------------------------------------------------------------ shell
function build() {
    titleEl = h('b', { class: 'zx-title' }, 'EX-Roster');
    backBtn = h('button', { type: 'button', class: 'zx-back', title: 'Back', onclick: () => go('home') }, h('i', { class: 'fa-solid fa-chevron-left' }));
    body = h('div', { class: 'zx-body' });
    root = h('div', { class: 'zx-overlay', 'data-keep-brand': '1' },
        h('div', { class: 'zx-window' },
            h('div', { class: 'zx-head' }, backBtn, titleEl, h('button', { type: 'button', class: 'zx-x', title: 'Close', onclick: close }, '×')),
            body));
    document.body.append(root);
}
function go(v, extra) {
    view = v;
    backBtn.style.visibility = v === 'home' ? 'hidden' : 'visible';
    body.scrollTop = 0;
    if (v === 'home') { titleEl.textContent = 'EX-Roster'; body.replaceChildren(homeView()); }
    else if (v === 'create') { titleEl.textContent = 'Create'; body.replaceChildren(createView()); updateSize(); }
    else if (v === 'import') { titleEl.textContent = 'Import'; body.replaceChildren(importView()); loadList(); }
    else if (v === 'mine') { titleEl.textContent = 'My creations'; body.replaceChildren(mineView()); }
    else if (v === 'result') { titleEl.textContent = 'Published'; body.replaceChildren(resultView(extra)); }
}
function open() { if (!root) build(); root.classList.add('zx-show'); go('home'); }
function close() { root?.classList.remove('zx-show'); }

// ------------------------------------------------------------ home
function homeView() {
    return h('div', { class: 'zx-home' },
        h('p', { class: 'zx-lead' }, 'Make your own characters and places as lorebooks, share them, and import the ones other people made.'),
        big('fa-pen-nib', 'CREATE', 'A character or a location of your own', () => go('create')),
        big('fa-cloud-arrow-down', 'IMPORT', 'Characters, locations or a whole lorebook', () => go('import')),
        h('button', { type: 'button', class: 'zx-link', onclick: () => go('mine') }, 'My creations'));
}

// ------------------------------------------------------------ create
let sizeEl = null;
function bundle() {
    const f = forms[createKind];
    const list = (t) => String(t || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    const data = createKind === 'character'
        ? { age: Number(f.age), species: f.species, description: f.description, personality: f.personality, prompt: f.prompt, restrictions: f.restrictions, summary: f.summary, places: f.places, when: f.when, keys: list(f.keys) }
        : { description: f.description, prompt: f.prompt, summary: f.summary, hours: f.hours, residents: f.residents, keys: list(f.keys) };
    const m = media[createKind];
    const images = createKind === 'character' ? { card: m.card || undefined, expressions: m.expressions } : { banner: m.banner || undefined };
    return { format: 'zenith-ex', v: 1, kind: createKind, name: f.name.trim(), author: author.trim() || 'Anonymous', visibility, adult: adultOk, data, images };
}
function updateSize() {
    if (!sizeEl) return;
    const kb = Math.round(JSON.stringify(bundle()).length / 1024);
    sizeEl.textContent = `Size: ${kb} KB of about ${Math.round(MAX_TOTAL / 1024)} KB`;
    sizeEl.classList.toggle('zx-bad', kb * 1024 > MAX_TOTAL);
}
function picture(label, slot, hint) {
    const m = media[createKind];
    const prev = h('img', { class: 'zx-prev', alt: '', style: m[slot] ? '' : 'display:none', src: m[slot] || '' });
    const btn = h('button', { type: 'button', class: 'zx-btn', onclick: async () => {
        const file = await pickFile('image/*'); if (!file) return;
        try { m[slot] = await toSmall(file, slot === 'card' ? 640 : 900, slot === 'card' ? 960 : 520); prev.src = m[slot]; prev.style.display = ''; updateSize(); } catch (e) { say(e.message, 'error'); }
    } }, m[slot] ? 'Change picture' : 'Choose picture');
    return field(label, h('div', { class: 'zx-pic' }, prev, btn, h('button', { type: 'button', class: 'zx-btn zx-ghost', onclick: () => { m[slot] = ''; prev.style.display = 'none'; updateSize(); } }, 'Remove')), hint);
}
function expressionsBox() {
    const m = media.character;
    const grid = h('div', { class: 'zx-expr-grid' });
    const draw = () => {
        grid.replaceChildren(...Object.entries(m.expressions).map(([n, src]) => h('div', { class: 'zx-expr' }, h('img', { src, alt: n }), h('span', {}, n),
            h('button', { type: 'button', title: 'Remove', onclick: () => { delete m.expressions[n]; draw(); updateSize(); } }, '×'))));
        if (!grid.children.length) grid.append(h('small', {}, 'No expressions added.'));
    };
    const name = h('input', { class: 'zx-in', list: 'zx_expr_names', placeholder: 'Expression name (happy, sad...)', maxlength: 24 });
    const add = h('button', { type: 'button', class: 'zx-btn', onclick: async () => {
        const n = name.value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9 _-]{0,23}$/.test(n)) return say('Type the expression name first (letters and numbers).', 'warning');
        if (!m.expressions[n] && Object.keys(m.expressions).length >= 16) return say('At most 16 expressions.', 'warning');
        const file = await pickFile('image/*'); if (!file) return;
        try { m.expressions[n] = await toSmall(file, 560, 840, 300_000); name.value = ''; draw(); updateSize(); } catch (e) { say(e.message, 'error'); }
    } }, 'Add picture');
    draw();
    return field('Expressions (optional)', h('div', {}, h('datalist', { id: 'zx_expr_names' }, EXPRESSIONS.map((e) => h('option', { value: e }))), h('div', { class: 'zx-row' }, name, add), grid),
        'Name each picture by the feeling it shows. Up to 16.');
}
function createView() {
    const f = createKind;
    const authorIn = h('input', { class: 'zx-in', placeholder: 'Your name or nickname', maxlength: 40, value: author });
    authorIn.addEventListener('input', () => { author = authorIn.value; ls.set(LS_AUTHOR, author); });
    const status = h('div', { class: 'zx-status' });
    const pub = h('button', { type: 'button', class: 'zx-btn zx-main', onclick: async () => {
        const b = bundle();
        if (JSON.stringify(b).length > MAX_TOTAL) return say('Too big. Remove a picture or shorten the texts.', 'error');
        if (!b.name) return say('Give it a name.', 'warning');
        pub.disabled = true; status.textContent = 'Publishing...';
        try {
            const r = await api('/publish', { method: 'POST', body: { bundle: b } });
            const mine = ls.get(LS_MINE, []);
            mine.unshift({ id: r.id, token: r.token, name: b.name, kind: b.kind, visibility: r.visibility, at: Date.now() });
            ls.set(LS_MINE, mine);
            forms[createKind] = createKind === 'character' ? emptyChar() : emptyPlace(); saveDraft();
            media[createKind] = createKind === 'character' ? { card: '', expressions: {} } : { banner: '' };
            adultOk = false;
            go('result', { id: r.id, visibility: r.visibility, name: b.name });
        } catch (e) { status.textContent = e.message; say(e.message, 'error'); pub.disabled = false; }
    } }, 'Publish');
    sizeEl = h('small', { class: 'zx-size' });
    const common = [
        field('Who made it', authorIn),
        field('Who can import it', seg([['public', 'Public (listed for everyone)'], ['private', 'Private (share code only)']], visibility, (v) => { visibility = v; go('create'); })),
        h('label', { class: 'zx-check' }, h('input', { type: 'checkbox', checked: adultOk, onchange: (e) => { adultOk = e.target.checked; updateSize(); } }),
            h('span', {}, 'Everyone in this is an adult (18+), and I am allowed to share it.')),
        sizeEl, status, pub,
    ];
    const kindSwitch = seg([['character', 'Character'], ['location', 'Location']], createKind, (v) => { createKind = v; go('create'); });
    if (f === 'character') {
        return h('div', { class: 'zx-form' }, kindSwitch,
            field('Name *', text(f, 'name', { ph: 'Full name' })),
            h('div', { class: 'zx-row' }, field('Age * (18+)', text(f, 'age', { type: 'number', min: 18, ph: '21' })), field('Species / look', text(f, 'species', { ph: 'kitsune, two tails' }))),
            field('Short summary *', text(f, 'summary', { area: true, rows: 2, ph: 'Who they are in one or two lines (used when they appear as a second character)' })),
            field('Description *', text(f, 'description', { area: true, rows: 6, ph: 'Appearance, background, job, history...' })),
            field('Personality and behavior', text(f, 'personality', { area: true, rows: 5 })),
            field('Prompt: how the AI should play them', text(f, 'prompt', { area: true, rows: 5, ph: 'Speech style, habits, what they want, how they react...' })),
            field('Restrictions / strict roleplay rules', text(f, 'restrictions', { area: true, rows: 4, ph: 'Things they never do, lines the AI must always respect...' })),
            h('div', { class: 'zx-row' }, field('Works or lives at', text(f, 'places', { ph: 'Noodle bar, Old Town' }), 'Places, separated by commas. When the story goes there, they join the scene.'), field('Usual hours', text(f, 'when', { ph: 'evenings' }))),
            field('Extra trigger words', text(f, 'keys', { ph: 'nicknames, separated by commas' })),
            picture('Card picture (optional)', 'card', 'Shrunk to a small size automatically.'),
            expressionsBox(), ...common);
    }
    return h('div', { class: 'zx-form' }, kindSwitch,
        field('Name *', text(f, 'name', { ph: 'Place name' })),
        field('Short summary *', text(f, 'summary', { area: true, rows: 2 })),
        field('Description *', text(f, 'description', { area: true, rows: 6, ph: 'What it looks like, who goes there, what happens...' })),
        field('Trigger words', text(f, 'keys', { ph: 'words that bring this place into the story, separated by commas' })),
        h('div', { class: 'zx-row' }, field('Hours / atmosphere', text(f, 'hours', { ph: 'open late, warm and loud' })), field('People usually there', text(f, 'residents', { ph: 'names, separated by commas' }))),
        field('Rules for this place', text(f, 'prompt', { area: true, rows: 4 })),
        picture('Banner picture (optional)', 'banner'), ...common);
}

// ------------------------------------------------------------ result / mine
function copy(t) { navigator.clipboard?.writeText(t).then(() => say('Copied.', 'success'), () => say(t)); }
function resultView({ id, visibility: vis, name }) {
    return h('div', { class: 'zx-home' },
        h('i', { class: 'fa-solid fa-circle-check zx-ok' }),
        h('b', { class: 'zx-bigtext' }, `${name} is published`),
        h('p', { class: 'zx-lead' }, vis === 'public' ? 'It is listed for everyone in Import. You can also share this code:' : 'It is private. Only people with this code can import it:'),
        h('div', { class: 'zx-code' }, id),
        h('button', { type: 'button', class: 'zx-btn zx-main', onclick: () => copy(id) }, 'Copy code'),
        h('button', { type: 'button', class: 'zx-link', onclick: () => go('mine') }, 'My creations'));
}
function mineView() {
    const mine = ls.get(LS_MINE, []);
    if (!mine.length) return h('p', { class: 'zx-empty' }, 'You have not published anything from this browser yet.');
    return h('div', { class: 'zx-list' }, mine.map((m) => h('div', { class: 'zx-item' },
        h('div', { class: 'zx-info' }, h('b', {}, m.name), h('small', {}, `${m.kind} · ${m.visibility} · ${m.id}`)),
        h('button', { type: 'button', class: 'zx-btn', onclick: () => copy(m.id) }, 'Copy code'),
        h('button', { type: 'button', class: 'zx-btn zx-danger', onclick: async (e) => {
            if (!confirm(`Remove "${m.name}" from the community server?`)) return;
            e.target.disabled = true;
            try { await api('/delete', { method: 'POST', body: { id: m.id, token: m.token } }); } catch (err) { if (!/Not found/i.test(err.message)) { say(err.message, 'error'); e.target.disabled = false; return; } }
            ls.set(LS_MINE, ls.get(LS_MINE, []).filter((x) => x.id !== m.id)); go('mine');
        } }, 'Remove'))));
}

// ------------------------------------------------------------ import
let listEl = null, installed = {};
/** Makes SillyTavern notice lorebook files that were written or changed on the server. */
async function freshWorlds(names) {
    try { const m = await import('/scripts/world-info.js'); await m.updateWorldInfoList?.(); for (const n of names) m.worldInfoCache?.delete(n); } catch { /* older build */ }
}
async function activateWorlds(names) {
    await freshWorlds(names);
    try {
        const select = $('#world_info');
        let changed = false;
        for (const n of names) {
            const o = select.find('option').filter((_, x) => x.textContent === n);
            if (o.length && !o.prop('selected')) { o.prop('selected', true); changed = true; }
        }
        if (changed) select.trigger('change');
    } catch (e) { console.debug('[Zenith EX] could not switch the lorebooks on', e); }
    try { await globalThis.ZenithCast?.reload(); } catch { /* optional */ }
}
const WORLDS = { character: ['Community Characters', 'Community Sub-bots'], location: ['Community Locations'] };
async function doInstall(id, btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Importing...';
    try {
        const r = await api('/install', { method: 'POST', body: { id } });
        await activateWorlds(WORLDS[r.item.kind] || []);
        say(`${r.item.name} imported.`, 'success');
        await loadList();
    } catch (e) { say(e.message, 'error'); btn.disabled = false; btn.textContent = old; }
}
async function loadList() {
    if (!listEl) return;
    if (importTab === 'lorebook') return;
    listEl.replaceChildren(h('p', { class: 'zx-empty' }, 'Loading...'));
    try {
        installed = Object.fromEntries((await api('/installed')).items.map((i) => [i.id, i]));
        const items = importTab === 'installed' ? Object.values(installed)
            : (await api(`/list?kind=${importTab}&q=${encodeURIComponent(importQuery)}`)).items;
        if (!items.length) return listEl.replaceChildren(h('p', { class: 'zx-empty' }, importTab === 'installed' ? 'Nothing imported yet.' : 'Nothing here yet. Be the first to create one!'));
        listEl.replaceChildren(...items.map(itemCard));
    } catch (e) {
        listEl.replaceChildren(h('p', { class: 'zx-empty' }, e.message), h('button', { type: 'button', class: 'zx-btn', onclick: loadList }, 'Try again'));
    }
}
function itemCard(i) {
    const isIn = !!installed[i.id];
    const pic = h('img', { class: 'zx-thumb', alt: '', loading: 'lazy', src: importTab === 'installed' ? `${API}/local/${i.id}/${i.kind === 'location' ? 'banner' : 'card'}` : `${API}/img/${i.id}/card`, onerror: (e) => { e.target.style.visibility = 'hidden'; } });
    const sub = importTab === 'installed' ? `${i.kind} · by ${i.author}` : [i.kind === 'character' && i.age ? `${i.age}` : '', i.species, `by ${i.author}`, i.expr ? `${i.expr} expressions` : ''].filter(Boolean).join(' · ');
    const act = isIn
        ? h('button', { type: 'button', class: 'zx-btn zx-danger', onclick: async (e) => { e.target.disabled = true; try { await api('/uninstall', { method: 'POST', body: { id: i.id } }); await freshWorlds(['Community Characters', 'Community Sub-bots', 'Community Locations']); await globalThis.ZenithCast?.reload(); } catch (err) { say(err.message, 'error'); } loadList(); } }, 'Remove')
        : h('button', { type: 'button', class: 'zx-btn zx-main', onclick: (e) => doInstall(i.id, e.target) }, 'Import');
    return h('div', { class: 'zx-item' }, pic, h('div', { class: 'zx-info' }, h('b', {}, i.name), h('small', {}, sub), i.summary ? h('p', {}, i.summary) : null), act);
}
function importView() {
    const search = h('input', { class: 'zx-in', type: 'search', placeholder: 'Search', value: importQuery });
    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { importQuery = search.value; loadList(); }, 350); });
    const code = h('input', { class: 'zx-in', placeholder: 'Share code (C-XXXXXXXXXXXX)', maxlength: 14 });
    const codeBtn = h('button', { type: 'button', class: 'zx-btn', onclick: () => { const v = code.value.trim().toUpperCase(); if (!v) return; doInstall(v, codeBtn).then(() => { code.value = ''; }); } }, 'Import code');
    listEl = h('div', { class: 'zx-list' });
    const lore = h('div', { class: 'zx-lore' },
        h('p', { class: 'zx-lead' }, 'Import a whole lorebook from a file (a SillyTavern World Info .json file). It is added to your World Info and switched on.'),
        h('button', { type: 'button', class: 'zx-btn zx-main', onclick: async (e) => {
            const file = await pickFile('.json,application/json'); if (!file) return;
            e.target.disabled = true;
            try {
                const data = JSON.parse(await file.text());
                const r = await api('/lorebook', { method: 'POST', body: { name: file.name, data } });
                await activateWorlds([r.name]);
                say(`Imported "${r.name}" (${r.entries} entries).`, 'success');
            } catch (err) { say(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error'); }
            e.target.disabled = false;
        } }, 'Choose lorebook file'));
    const tabs = seg([['character', 'Characters'], ['location', 'Locations'], ['lorebook', 'Full lorebook'], ['installed', 'Installed']], importTab, (v) => { importTab = v; go('import'); });
    return h('div', { class: 'zx-form' }, tabs,
        importTab === 'lorebook' ? lore : h('div', {}, importTab === 'installed' ? null : search, importTab === 'installed' ? null : h('div', { class: 'zx-row zx-code-row' }, code, codeBtn), listEl));
}

globalThis.ZenithEx = { open, close };
