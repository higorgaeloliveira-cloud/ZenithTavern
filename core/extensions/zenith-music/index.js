/*
 * Zenith Music - your own playlists, played inside ZenithTavern.
 * Files you add are saved on the ZenithTavern server (in your user data folder), so they survive
 * browser changes. Playlists (names and order) are saved with your settings.
 * Music keeps playing while you change chats or close the panel.
 */
const MODULE = 'zenith_music';
const API = '/api/plugins/zenith-system/music';
const ctx = () => SillyTavern.getContext();
const uid = () => Math.random().toString(36).slice(2, 10);

function settings() {
    const { extensionSettings } = ctx();
    const s = (extensionSettings[MODULE] ??= {});
    s.playlists ??= [];
    s.selected ??= null;
    s.volume ??= 0.8;
    s.shuffle ??= false;
    s.repeat ??= 'all'; // off | all | one
    return s;
}
const save = () => ctx().saveSettingsDebounced();
const selected = () => settings().playlists.find((p) => p.id === settings().selected) || null;

// ---------------------------------------------------------------- player
const audio = new Audio();
audio.preload = 'metadata';
let queue = [];        // tracks being played, in order
let qIndex = -1;
let playingPlaylist = null;

const current = () => queue[qIndex] || null;
const fileUrl = (file) => `${API}/file/${encodeURIComponent(file)}`;

function playIndex(i) {
    if (!queue.length) return;
    qIndex = ((i % queue.length) + queue.length) % queue.length;
    audio.src = fileUrl(current().file);
    audio.volume = settings().volume;
    audio.play().catch((e) => { console.warn('[Zenith Music] play blocked', e); });
    updateMediaSession();
    refresh();
}

function startPlaylist(playlist, startAt = 0) {
    if (!playlist?.tracks.length) { toastr.info('This playlist has no songs yet. Add some audio files first.'); return; }
    playingPlaylist = playlist.id;
    queue = [...playlist.tracks];
    let first = startAt;
    if (settings().shuffle) {
        const picked = queue[startAt];
        queue = queue.filter((t) => t !== picked).sort(() => Math.random() - 0.5);
        queue.unshift(picked);
        first = 0;
    }
    playIndex(first);
}

function next(auto = false) {
    if (!queue.length) return;
    const repeat = settings().repeat;
    if (auto && repeat === 'one') return playIndex(qIndex);
    if (qIndex + 1 >= queue.length) {
        if (repeat === 'all' || !auto) return playIndex(0);
        audio.pause(); audio.currentTime = 0; refresh(); return;
    }
    playIndex(qIndex + 1);
}
const prev = () => { if (audio.currentTime > 3) audio.currentTime = 0; else playIndex(qIndex - 1); };
const toggle = () => { if (!audio.src) { startPlaylist(selected()); return; } audio.paused ? audio.play() : audio.pause(); };

audio.addEventListener('ended', () => next(true));
audio.addEventListener('play', refresh);
audio.addEventListener('pause', refresh);
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', updateProgress);
audio.addEventListener('error', () => {
    if (!audio.src) return;
    toastr.warning(`Could not play "${current()?.name ?? 'this file'}". Skipping.`);
    if (queue.length > 1) next(true);
});

function updateMediaSession() {
    if (!('mediaSession' in navigator) || !current()) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current().name, artist: 'ZenithTavern', album: selected()?.name || '' });
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
}

// ---------------------------------------------------------------- server calls
async function uploadFile(file) {
    const headers = { ...ctx().getRequestHeaders() };
    delete headers['Content-Type'];
    headers['Content-Type'] = 'application/octet-stream';
    headers['X-Filename'] = encodeURIComponent(file.name);
    const res = await fetch(`${API}/upload`, { method: 'POST', headers, body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
}
const deleteFile = (file) => fetch(`${API}/file/${encodeURIComponent(file)}`, { method: 'DELETE', headers: ctx().getRequestHeaders() }).catch(() => {});

// ---------------------------------------------------------------- actions
async function createPlaylist() {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const name = await callGenericPopup('Name your playlist:', POPUP_TYPE.INPUT, `Playlist ${settings().playlists.length + 1}`);
    if (!name || !String(name).trim()) return;
    const p = { id: uid(), name: String(name).trim(), tracks: [] };
    settings().playlists.push(p);
    settings().selected = p.id;
    save(); render();
}

async function renamePlaylist() {
    const p = selected(); if (!p) return;
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const name = await callGenericPopup('Rename playlist:', POPUP_TYPE.INPUT, p.name);
    if (!name || !String(name).trim()) return;
    p.name = String(name).trim();
    save(); render();
}

async function removePlaylist() {
    const p = selected(); if (!p) return;
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const ok = await callGenericPopup(`Remove "${p.name}" and delete its ${p.tracks.length} audio file(s)?`, POPUP_TYPE.CONFIRM);
    if (ok !== POPUP_RESULT.AFFIRMATIVE) return;
    if (playingPlaylist === p.id) { audio.pause(); audio.removeAttribute('src'); queue = []; qIndex = -1; playingPlaylist = null; }
    await Promise.all(p.tracks.map((t) => deleteFile(t.file)));
    const s = settings();
    s.playlists = s.playlists.filter((x) => x.id !== p.id);
    s.selected = s.playlists[0]?.id ?? null;
    save(); render();
}

let uploading = 0;
async function addFiles(files) {
    const p = selected();
    if (!p) { toastr.info('Create a playlist first.'); return; }
    for (const file of files) {
        uploading++; render();
        try {
            const saved = await uploadFile(file);
            p.tracks.push({ id: uid(), name: file.name.replace(/\.[^.]+$/, ''), file: saved.file });
            save();
        } catch (err) {
            toastr.error(`${file.name}: ${err.message}`);
        } finally { uploading--; render(); }
    }
}

async function removeTrack(i) {
    const p = selected(); if (!p) return;
    const [t] = p.tracks.splice(i, 1);
    if (t) { queue = queue.filter((q) => q.id !== t.id); if (current()?.id === t.id) next(false); await deleteFile(t.file); }
    save(); render();
}
function moveTrack(i, d) {
    const p = selected(); const j = i + d;
    if (!p || j < 0 || j >= p.tracks.length) return;
    [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
    save(); render();
}

// ---------------------------------------------------------------- UI
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
const btn = (label, onclick, cls = '', title = '') => h('button', { type: 'button', class: `menu_button zm-btn ${cls}`, onclick, title }, label);
const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');

let root = null;
let open = false;

function refresh() {
    const playing = !audio.paused && !!audio.src;
    document.getElementById('zenith_music_btn')?.classList.toggle('zm-playing', playing);
    if (!root) return;
    const t = root.querySelector('.zm-title'); if (t) t.textContent = current()?.name ?? 'Nothing playing';
    const sub = root.querySelector('.zm-sub'); if (sub) sub.textContent = playingPlaylist ? (settings().playlists.find((p) => p.id === playingPlaylist)?.name ?? '') : '';
    const pp = root.querySelector('.zm-pp'); if (pp) pp.textContent = playing ? '⏸' : '▶';
    root.querySelectorAll('.zm-row').forEach((r) => r.classList.toggle('zm-now', r.dataset.id === current()?.id && playingPlaylist === selected()?.id));
    updateProgress();
}

function updateProgress() {
    if (!root) return;
    const bar = root.querySelector('.zm-seek'); if (!bar || bar.dataset.drag) return;
    bar.max = audio.duration || 0; bar.value = audio.currentTime || 0;
    root.querySelector('.zm-time').textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
}

function render() {
    if (!root) return;
    const s = settings();
    const p = selected();
    const body = root.querySelector('.zm-body');
    const scroll = body.scrollTop;

    const select = h('select', { class: 'text_pole zm-select', onchange: (e) => { s.selected = e.target.value; save(); render(); } },
        s.playlists.length ? s.playlists.map((x) => h('option', { value: x.id, ...(x.id === s.selected ? { selected: true } : {}) }, `${x.name} (${x.tracks.length})`)) : h('option', {}, 'No playlists yet'));

    const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus', multiple: true, class: 'zm-file', onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });

    body.replaceChildren(
        h('div', { class: 'zm-card' },
            h('div', { class: 'zm-title' }, current()?.name ?? 'Nothing playing'),
            h('div', { class: 'zm-sub' }, ''),
            (() => {
                const bar = h('input', { type: 'range', class: 'zm-seek', min: 0, max: 0, step: 0.1, value: 0 });
                bar.addEventListener('pointerdown', () => { bar.dataset.drag = '1'; });
                bar.addEventListener('input', () => { root.querySelector('.zm-time').textContent = `${fmt(Number(bar.value))} / ${fmt(audio.duration)}`; });
                bar.addEventListener('change', () => { audio.currentTime = Number(bar.value); delete bar.dataset.drag; });
                return bar;
            })(),
            h('div', { class: 'zm-time' }, '0:00 / 0:00'),
            h('div', { class: 'zm-controls' },
                btn('⇄', () => { s.shuffle = !s.shuffle; save(); render(); }, s.shuffle ? 'zm-on' : '', 'Shuffle'),
                btn('⏮', prev, '', 'Previous'),
                btn(!audio.paused && audio.src ? '⏸' : '▶', toggle, 'zm-pp zm-big', 'Play / pause'),
                btn('⏭', () => next(false), '', 'Next'),
                btn(s.repeat === 'one' ? '🔂' : '🔁', () => { s.repeat = { all: 'one', one: 'off', off: 'all' }[s.repeat]; save(); render(); }, s.repeat === 'off' ? '' : 'zm-on', `Repeat: ${s.repeat}`)),
            h('div', { class: 'zm-vol' }, h('span', {}, '🔈'),
                (() => { const v = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: s.volume }); v.addEventListener('input', () => { s.volume = Number(v.value); audio.volume = s.volume; save(); }); return v; })())),

        h('div', { class: 'zm-card' },
            h('div', { class: 'zm-row2' }, select, btn('+ New', createPlaylist, '', 'Create Playlist')),
            p ? h('div', { class: 'zm-row2' },
                btn('▶ Listen to Playlist', () => startPlaylist(p), 'zm-wide zm-on'),
                btn('Rename', renamePlaylist), btn('Remove', removePlaylist, 'zm-danger')) : h('p', { class: 'zm-note' }, 'Create a playlist to get started.'),
            p ? h('div', { class: 'zm-row2' },
                btn(uploading ? `Uploading… (${uploading})` : '+ Add audio files', () => fileInput.click(), 'zm-wide'), fileInput) : null,
            p && !p.tracks.length ? h('p', { class: 'zm-note' }, 'No songs yet. Add mp3, wav, ogg, m4a, flac or opus files.') : null,
            p ? p.tracks.map((t, i) => h('div', { class: 'zm-row', 'data-id': t.id },
                h('span', { class: 'zm-num' }, String(i + 1)),
                h('span', { class: 'zm-name', title: t.name, onclick: () => startPlaylist(p, i) }, t.name),
                btn('▲', () => moveTrack(i, -1), 'zm-mini', 'Move up'), btn('▼', () => moveTrack(i, 1), 'zm-mini', 'Move down'),
                btn('✕', () => removeTrack(i), 'zm-mini zm-danger', 'Remove song'))) : null),
        h('p', { class: 'zm-note' }, 'Your files are stored in your ZenithTavern data folder. Only add music you have the right to use.'));

    body.scrollTop = scroll;
    refresh();
}

function setOpen(v) {
    open = v;
    root.classList.toggle('zm-open', v);
    document.getElementById('zenith_music_btn')?.classList.toggle('zm-active', v);
    if (v) render();
}

function mount() {
    root = h('aside', { id: 'zenith_music_panel', class: 'zm-panel' },
        h('header', { class: 'zm-head' }, h('b', {}, '♪ Music'), h('button', { type: 'button', class: 'zm-x', title: 'Close', onclick: () => setOpen(false) }, '✕')),
        h('div', { class: 'zm-body' }));
    document.body.append(root);

    const button = h('div', { id: 'zenith_music_btn', class: 'drawer', onclick: () => setOpen(!open) },
        h('div', { class: 'drawer-toggle' }, h('div', { class: 'drawer-icon fa-solid fa-music fa-fw closedIcon', title: 'Music' })));
    const home = document.getElementById('zenith_home');
    const persona = document.getElementById('persona-management-button');
    if (home) home.after(button); else if (persona) persona.before(button); else document.getElementById('top-settings-holder')?.append(button);
    audio.volume = settings().volume;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) setOpen(false); });
}

jQuery(() => { settings(); mount(); });
