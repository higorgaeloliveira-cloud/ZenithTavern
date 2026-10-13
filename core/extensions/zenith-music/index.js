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
    s.spectrum ??= true; // live audio spectrum on the right border
    s.specLength ??= 100; // Advanced: how far the bars may go, 10-100 % of the free space on the right
    s.specBeat ??= 50;    // Advanced: how strongly the bars react, 0-100
    // Advanced: normal | aggressive | custom (only Custom uses the two sliders). Someone who already moved a slider keeps Custom.
    s.specMode ??= (s.specLength !== 100 || s.specBeat !== 50) ? 'custom' : 'normal';
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

// ---------------------------------------------------------------- spectrum (real analysis of what is playing)
// Horizontal bars grow from the RIGHT edge of the window towards the chat column and stop where the column starts.
// The canvas sits at the very bottom of the page, so characters, the phone, menus and pop-ups are all drawn on top of it.
const HONEY = [217, 154, 30]; // a little darker than the gold accent
let BARS = 56;               // Normal: 56 bars; Aggressive: 88 thinner bars (more of them on the bass)
let agcMean = 40, bassAvg = 40, modeApplied = '';
let canvas = null, g2d = null, actx = null, analyser = null, freq = null, raf = 0, level = new Float32Array(120), graphFailed = false;

function freeWidth() {
    const chat = document.getElementById('sheld');
    if (!chat) return 0;
    return Math.max(0, Math.floor(window.innerWidth - chat.getBoundingClientRect().right - 10));
}

function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'zenith_spectrum';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    g2d = canvas.getContext('2d');
}

function ensureGraph() {
    if (actx || graphFailed) return !!actx;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC();
        const src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        analyser.connect(actx.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        modeApplied = '';
        return true;
    } catch (e) {
        console.warn('[Zenith Music] spectrum unavailable', e);
        graphFailed = true; actx = null;
        return false;
    }
}

/** Normal and Custom use 56 bars; Aggressive uses 88 and a finer analysis so the bass gets many more bands. */
function applyMode(mode) {
    modeApplied = mode;
    const agg = mode === 'aggressive';
    BARS = agg ? 88 : 56;
    if (analyser) {
        analyser.fftSize = agg ? 4096 : 2048;
        analyser.smoothingTimeConstant = agg ? 0.35 : 0.6;
        freq = new Uint8Array(analyser.frequencyBinCount);
    }
    level.fill(0);
}

function drawSpectrum() {
    raf = 0;
    const playing = !audio.paused && !!audio.src;
    const room = freeWidth();
    if (!settings().spectrum || !playing || room < 24 || !analyser) { clearSpectrum(); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = room, H = window.innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    }
    const mode = ['normal', 'aggressive', 'custom'].includes(settings().specMode) ? settings().specMode : 'normal';
    if (modeApplied !== mode) applyMode(mode);
    const agg = mode === 'aggressive';
    analyser.getByteFrequencyData(freq);
    const nyq = actx.sampleRate / 2, lo = 40, hi = Math.min(14000, nyq);
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2d.clearRect(0, 0, W, H);
    const slot = H / BARS, thick = Math.max(2, slot * 0.62);
    const st = settings();
    // Normal and Aggressive always use the full length; only Custom takes the sliders.
    const maxLen = W * (mode === 'custom' ? Math.min(1, Math.max(0.1, Number(st.specLength) / 100)) : 1); // "Length": the bars never go past this
    const beat = mode === 'custom' ? Math.min(1, Math.max(0, Number(st.specBeat) / 100)) : 0.5;
    const span = 1.1 + (1 - beat) * 1.4; // "Beat": how far above the song's own average a bar must go to reach the maximum
    const curve = 2.2 - beat * 1.0;      //        and how sharply it jumps on peaks (low = calm, high = lively)
    // 1) read every bar
    const raw = new Float32Array(BARS); let frameMax = 0;
    for (let i = 0; i < BARS; i++) {
        // lowest sounds at the bottom, highest at the top; log spacing so bass does not take the whole height
        const t0 = (BARS - 1 - i) / BARS, t1 = (BARS - i) / BARS;
        const f0 = lo * Math.pow(hi / lo, t0), f1 = lo * Math.pow(hi / lo, t1);
        const b0 = Math.max(0, Math.floor(f0 / nyq * freq.length)), b1 = Math.max(b0 + 1, Math.ceil(f1 / nyq * freq.length));
        let m = 0; for (let b = b0; b < b1 && b < freq.length; b++) m = Math.max(m, freq[b]);
        raw[i] = m; if (m > frameMax) frameMax = m;
    }
    // 2) automatic level: bars are measured against the song's own recent average, so a loud, bass-heavy master no longer
    //    sits at the maximum; only what rises above the average reaches far. The average follows slowly.
    let sum = 0; for (let i = 0; i < BARS; i++) sum += raw[i];
    agcMean = Math.max(25, agcMean * 0.97 + (sum / BARS) * 0.03);
    // Aggressive: the bass bands (below ~180 Hz) sit low and jump on every beat; everything else moves less and stays shorter.
    let punch = 0;
    const isBass = new Uint8Array(BARS);
    if (agg) {
        let bs = 0, bn = 0;
        for (let i = 0; i < BARS; i++) {
            const fc = Math.sqrt(lo * Math.pow(hi / lo, (BARS - 1 - i) / BARS) * lo * Math.pow(hi / lo, (BARS - i) / BARS));
            if (fc < 180) { isBass[i] = 1; bs += raw[i]; bn++; }
        }
        const bassMean = bn ? bs / bn : 0;
        punch = Math.min(1, Math.max(0, (bassMean - bassAvg - 3) / 22)); // how far the bass is above its own last second (the analyser reports decibels, so a difference, not a ratio)
        bassAvg = bassAvg * 0.96 + bassMean * 0.04;
    }
    // 3) draw
    for (let i = 0; i < BARS; i++) {
        const t0 = (BARS - 1 - i) / BARS;
        const tilt = 1 + t0 * 0.6;                       // the top of the spectrum is naturally quiet; lift it a little
        let v;
        if (agg) {
            const ratio = (raw[i] / agcMean) * tilt;
            v = isBass[i]
                ? (() => { const base = Math.min(1, ratio) * 0.18; return Math.min(1, base + punch * Math.min(1, ratio * 1.4) * (1 - base) * 1.0); })()
                : Math.pow(Math.min(1, ratio / 2.4), 2.2) * 0.5;
            level[i] = v > level[i] ? v : level[i] * (isBass[i] ? 0.78 : 0.9) + v * (isBass[i] ? 0.22 : 0.1);
        } else {
            v = Math.min(1, Math.pow(Math.min(1, (raw[i] / agcMean) * tilt / span), curve));
            level[i] = v > level[i] ? v : level[i] * 0.86 + v * 0.14; // quick attack, soft fall
        }
        const len = Math.min(maxLen, Math.max(0, level[i] * maxLen));
        if (len < 1.5) continue;
        const y = i * slot + (slot - thick) / 2;
        const grad = g2d.createLinearGradient(W, 0, W - len, 0);
        grad.addColorStop(0, `rgba(${HONEY},0.95)`);
        grad.addColorStop(1, `rgba(${HONEY},0.35)`);
        g2d.fillStyle = grad;
        g2d.beginPath();
        g2d.roundRect ? g2d.roundRect(W - len, y, len, thick, [thick / 2, 0, 0, thick / 2]) : g2d.rect(W - len, y, len, thick);
        g2d.fill();
    }
    raf = requestAnimationFrame(drawSpectrum);
}

function clearSpectrum() {
    if (g2d && canvas) g2d.clearRect(0, 0, canvas.width, canvas.height);
    level.fill(0);
}

/** Starts or stops the drawing loop depending on: switch on, something playing, room on the right. */
function updateSpectrum() {
    const on = settings().spectrum;
    document.getElementById('zenith_music_btn')?.classList.toggle('zm-spec', on);
    const sw = root?.querySelector('.zm-spec-switch'); if (sw) sw.checked = on;
    if (!on) { if (raf) { cancelAnimationFrame(raf); raf = 0; } clearSpectrum(); return; }
    ensureCanvas();
    const playing = !audio.paused && !!audio.src;
    if (!playing || freeWidth() < 24) { if (!raf) clearSpectrum(); return; } // phones and narrow windows have no free space: nothing is created
    if (!ensureGraph()) return;
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    if (!raf) raf = requestAnimationFrame(drawSpectrum);
}
audio.addEventListener('play', updateSpectrum);
audio.addEventListener('pause', updateSpectrum);
audio.addEventListener('ended', updateSpectrum);
window.addEventListener('resize', updateSpectrum);

function setOpen(v) {
    open = v;
    root.classList.toggle('zm-open', v);
    document.getElementById('zenith_music_btn')?.classList.toggle('zm-active', v);
    if (v) render();
}

function mount() {
    root = h('aside', { id: 'zenith_music_panel', class: 'zm-panel' },
        h('header', { class: 'zm-head' }, h('b', {}, '♪ Music'),
            h('label', { class: 'zm-spec-row', title: 'Live spectrum on the right border of the window' }, h('span', {}, 'Spectrum'),
                (() => { const i = h('input', { type: 'checkbox', class: 'zm-spec-switch' }); i.checked = settings().spectrum; i.addEventListener('change', () => { settings().spectrum = i.checked; save(); updateSpectrum(); }); return i; })()),
            h('button', { type: 'button', class: 'zm-x', title: 'Close', onclick: () => setOpen(false) }, '✕')),
        h('details', { class: 'zm-adv' },
            h('summary', {}, 'Advanced options'),
            h('p', { class: 'zm-note' }, 'Audio spectrum'),
            (() => {
                const MODES = [
                    ['normal', 'Normal', 'Every part of the sound moves about the same.'],
                    ['aggressive', 'Aggressive', 'Most of the sound moves less; the bass and the beat hit much harder, with more bands on the bass.'],
                    ['custom', 'Custom', 'Set it yourself with the sliders.'],
                ];
                const row = (label, key, hint, min) => {
                    const out = h('span', { class: 'zm-adv-val' });
                    const input = h('input', { type: 'range', min, max: 100, step: 1, class: 'zm-adv-range' });
                    input.value = settings()[key]; out.textContent = `${input.value}%`;
                    input.addEventListener('input', () => { settings()[key] = Number(input.value); out.textContent = `${input.value}%`; save(); });
                    return h('label', { class: 'zm-adv-row', title: hint }, h('span', { class: 'zm-adv-name' }, label), input, out);
                };
                const sliders = h('div', { class: 'zm-adv-sliders' },
                    row('Length', 'specLength', 'How far the bars may reach into the free space on the right. Lower it if they stretch too far.', 10),
                    row('Beat', 'specBeat', 'How much the bars move with the bass and the rest of the sound. Lower it for loud songs, raise it for quiet ones.', 0),
                    h('button', { type: 'button', class: 'menu_button zm-adv-reset', onclick: (e) => { settings().specLength = 100; settings().specBeat = 50; save(); e.target.closest('.zm-adv').querySelectorAll('.zm-adv-range').forEach((r, k) => { r.value = k ? 50 : 100; r.dispatchEvent(new Event('input')); }); } }, 'Reset'));
                const info = h('p', { class: 'zm-note zm-adv-info' });
                const segs = MODES.map(([id, name]) => h('button', { type: 'button', class: 'zm-adv-seg', 'data-mode': id, onclick: () => { settings().specMode = id; save(); paint(); } }, name));
                const paint = () => {
                    const cur = settings().specMode;
                    segs.forEach((b) => b.classList.toggle('zm-on', b.dataset.mode === cur));
                    sliders.hidden = cur !== 'custom';
                    info.textContent = MODES.find((m) => m[0] === cur)?.[2] || '';
                };
                paint();
                return h('div', { class: 'zm-adv-box' }, h('div', { class: 'zm-adv-segs' }, segs), info, sliders);
            })()),
        h('div', { class: 'zm-body' }));
    document.body.append(root);

    const button = h('div', { id: 'zenith_music_btn', class: 'drawer', title: 'Music (right-click: spectrum on/off)', onclick: () => setOpen(!open),
        oncontextmenu: (e) => { e.preventDefault(); settings().spectrum = !settings().spectrum; save(); updateSpectrum(); toastr.info(`Spectrum ${settings().spectrum ? 'on' : 'off'}`); } },
        h('div', { class: 'drawer-toggle' }, h('div', { class: 'drawer-icon fa-solid fa-music fa-fw closedIcon', title: 'Music' })));
    const home = document.getElementById('zenith_home');
    const persona = document.getElementById('persona-management-button');
    if (home) home.after(button); else if (persona) persona.before(button); else document.getElementById('top-settings-holder')?.append(button);
    audio.volume = settings().volume;
    updateSpectrum();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) setOpen(false); });
}

jQuery(() => { settings(); mount(); });
