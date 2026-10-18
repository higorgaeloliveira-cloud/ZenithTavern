/*
 * Zenith Phone - a phone (iPhone 11 layout) that slides up on the right side of the screen.
 * The button, the locked screen, the home bar that unlocks it, the home screen and the apps (see APPS below).
 *
 * Open/close: the phone button above the message box, or /phone. Closing locks the phone again
 * (unless "Keep unlocked" is on in the Settings app). The side button (right edge of the phone) locks it.
 */
const SCREEN_W = 414;   // iPhone 11 screen: 828 x 1792 pixels = 414 x 896 points
const SCREEN_H = 896;
const BEZEL = 22;
const PHONE_W = SCREEN_W + BEZEL * 2;
const PHONE_H = SCREEN_H + BEZEL * 2;
const MARGIN_TOP = 16;       // free space above the phone
const MARGIN_BOTTOM = 130;   // keeps the phone button visible below the phone

// ---------------------------------------------------------------- phone settings (the Settings app edits these)
const MODULE = 'zenith_phone';
const WALLPAPERS = [
    { id: 'gold', name: 'Zenith Gold', css: 'radial-gradient(120% 60% at 15% 12%, #e0a82e88, transparent 60%), radial-gradient(90% 55% at 90% 85%, #9a4f1a77, transparent 65%), linear-gradient(165deg, #1c150a 0%, #33260f 45%, #130e06 100%)' },
    { id: 'dusk', name: 'Zenith Dusk', css: 'radial-gradient(120% 60% at 15% 12%, #6a3fd0aa, transparent 60%), radial-gradient(90% 55% at 90% 85%, #1f6fd088, transparent 65%), linear-gradient(165deg, #1b1040 0%, #2c1860 45%, #0c1a3c 100%)' },
    { id: 'aurora', name: 'Aurora', css: 'radial-gradient(100% 50% at 80% 15%, #22d3a066, transparent 60%), linear-gradient(165deg, #06222a 0%, #0f5c5a 50%, #1b2a6b 100%)' },
    { id: 'sunset', name: 'Sunset', css: 'linear-gradient(170deg, #2a1240 0%, #7a2b6b 55%, #d9663a 100%)' },
    { id: 'ocean', name: 'Ocean', css: 'radial-gradient(90% 50% at 20% 90%, #2fd0d055, transparent 60%), linear-gradient(170deg, #031a2e 0%, #0a4a7a 60%, #1b8aa6 100%)' },
    { id: 'forest', name: 'Forest', css: 'linear-gradient(170deg, #07170f 0%, #14452e 55%, #3b7a3a 100%)' },
    { id: 'rose', name: 'Rose', css: 'radial-gradient(100% 50% at 85% 10%, #ff7aa855, transparent 60%), linear-gradient(170deg, #2a0f1d 0%, #7a2342 55%, #c4476b 100%)' },
    { id: 'graphite', name: 'Graphite', css: 'linear-gradient(170deg, #0e0e10 0%, #1c1c22 55%, #34343c 100%)' },
    { id: 'midnight', name: 'Midnight', css: 'radial-gradient(80% 40% at 50% 0%, #3a2aa066, transparent 70%), linear-gradient(180deg, #05050f 0%, #0b0b2e 60%, #1a0f4a 100%)' },
];
const FRAMES = [
    { id: 'black', name: 'Black', ring: '#3a3a40', ring2: '#17171a', btn: '#2b2b30' },
    { id: 'white', name: 'White', ring: '#e9e9ec', ring2: '#b9b9be', btn: '#cfcfd3' },
    { id: 'green', name: 'Green', ring: '#aee1cd', ring2: '#7fb7a0', btn: '#9ccfba' },
    { id: 'yellow', name: 'Yellow', ring: '#ffe681', ring2: '#d9bd55', btn: '#efd36b' },
    { id: 'purple', name: 'Purple', ring: '#d1cddb', ring2: '#a39fb2', btn: '#bdb8cb' },
    { id: 'red', name: 'Red', ring: '#d3263f', ring2: '#8c1a2b', btn: '#b81f35' },
];
const DEFAULTS = () => ({
    wallpaper: { type: 'preset', id: 'gold', color: '#33260f', image: '' },
    dim: 0,              // % darker wallpaper
    hours: 'auto',       // auto | 12 | 24
    labels: true,        // app names under the icons
    battery: false,      // show this device's real battery level
    frame: 'black',
    size: 100,           // % of the size that fits the window
    side: 'right',       // right | left
    keepUnlocked: false, // reopening the phone does not lock it again
});
function cfg() {
    const { extensionSettings } = SillyTavern.getContext();
    const cur = (extensionSettings[MODULE] ??= {});
    const base = DEFAULTS();
    for (const [k, v] of Object.entries(base)) cur[k] ??= v;
    cur.wallpaper = { ...base.wallpaper, ...cur.wallpaper };
    return cur;
}
const saveCfg = () => SillyTavern.getContext().saveSettingsDebounced();

function wallpaperCss() {
    const w = cfg().wallpaper;
    if (w.type === 'color') return w.color;
    if (w.type === 'image' && w.image) return `center / cover no-repeat url("${w.image.replace(/"/g, '%22')}")`;
    return (WALLPAPERS.find((x) => x.id === w.id) || WALLPAPERS[0]).css;
}

/** Applies every look setting to the phone. Safe to call any time. */
function applyLook() {
    if (!wrap) return;
    const c = cfg();
    const wall = phone.querySelector('.zph-wall');
    wall.style.background = wallpaperCss();
    wall.style.setProperty('--zph-dim', String(c.dim / 100));
    const f = FRAMES.find((x) => x.id === c.frame) || FRAMES[0];
    phone.style.setProperty('--zph-ring', f.ring);
    phone.style.setProperty('--zph-ring2', f.ring2);
    phone.style.setProperty('--zph-btn', f.btn);
    phone.classList.toggle('zph-nolabels', !c.labels);
    wrap.classList.toggle('zph-left', c.side === 'left');
    fit();
    tick();
    updateBattery();
}

let battery = null;
function updateBattery() {
    const fill = phone?.querySelector('.zph-batfill');
    if (!fill) return;
    const on = cfg().battery && battery;
    fill.setAttribute('width', on ? String(Math.max(2, 19 * battery.level)) : '19');
    fill.style.fill = on && battery.level <= 0.2 && !battery.charging ? '#ff453a' : on && battery.charging ? '#34c759' : '';
}
async function initBattery() {
    try { battery = await navigator.getBattery?.(); } catch { battery = null; }
    if (battery) for (const ev of ['levelchange', 'chargingchange']) battery.addEventListener(ev, updateBattery);
    updateBattery();
}

// ---------------------------------------------------------------- Settings app
function settingsApp() {
    const c = cfg();
    const change = (fn, redraw = true) => { fn(); saveCfg(); applyLook(); if (redraw) renderApp(); };
    const section = (title, ...rows) => h('div', { class: 'zph-set' }, h('div', { class: 'zph-set-title' }, title), h('div', { class: 'zph-set-group' }, rows));
    const row = (label, control, sub) => h('div', { class: 'zph-set-row' }, h('div', { class: 'zph-set-label' }, h('span', {}, label), sub ? h('small', {}, sub) : null), control);
    const sw = (checked, on) => {
        const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
        input.addEventListener('change', () => on(input.checked));
        return h('label', { class: 'zph-switch' }, input, h('span'));
    };
    const seg = (options, value, on) => h('div', { class: 'zph-seg' }, options.map(([v, label]) =>
        h('button', { type: 'button', class: v === value ? 'zph-seg-on' : '', onclick: () => on(v) }, label)));
    const slider = (min, max, value, on, fmt) => {
        const out = h('output', {}, fmt(value));
        const input = h('input', { type: 'range', min, max, value, class: 'zph-range' });
        input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); on(Number(input.value)); });
        return h('div', { class: 'zph-range-wrap' }, input, out);
    };

    // wallpaper picker
    const isSel = (id) => c.wallpaper.type === 'preset' && c.wallpaper.id === id;
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
            const image = await downscale(file, 720, 1560);
            change(() => { c.wallpaper = { ...c.wallpaper, type: 'image', image }; });
        } catch (e) { toastr.error('That image could not be used.'); console.warn('[Zenith Phone] wallpaper', e); }
    });
    const colorInput = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(c.wallpaper.color) ? c.wallpaper.color : '#33260f', class: 'zph-color' });
    colorInput.addEventListener('input', () => { c.wallpaper = { ...c.wallpaper, type: 'color', color: colorInput.value }; applyLook(); });
    colorInput.addEventListener('change', () => { saveCfg(); renderApp(); });
    const swatches = h('div', { class: 'zph-swatches' },
        WALLPAPERS.map((w) => h('button', { type: 'button', title: w.name, class: 'zph-swatch' + (isSel(w.id) ? ' zph-sel' : ''), style: `background:${w.css}`,
            onclick: () => change(() => { c.wallpaper = { ...c.wallpaper, type: 'preset', id: w.id }; }) })),
        h('label', { class: 'zph-swatch zph-swatch-tool' + (c.wallpaper.type === 'color' ? ' zph-sel' : ''), title: 'Pick a color' }, h('i', { class: 'fa-solid fa-droplet' }), colorInput),
        h('button', { type: 'button', class: 'zph-swatch zph-swatch-tool' + (c.wallpaper.type === 'image' ? ' zph-sel' : ''), title: 'Use your own picture', onclick: () => fileInput.click() }, h('i', { class: 'fa-solid fa-image' })),
        fileInput);

    return h('div', { class: 'zph-settings' },
        section('Wallpaper',
            h('div', { class: 'zph-set-pad' }, swatches),
            row('Dim', slider(0, 70, c.dim, (v) => { c.dim = v; saveCfg(); applyLook(); }, (v) => `${v}%`))),
        section('Display',
            row('Time format', seg([['auto', 'Auto'], ['12', '12h'], ['24', '24h']], c.hours, (v) => change(() => { c.hours = v; }))),
            row('App names', sw(c.labels, (v) => change(() => { c.labels = v; }, false))),
            row('Real battery level', sw(c.battery, (v) => change(() => { c.battery = v; }, false)), battery ? 'Shows this device\'s battery' : 'Not available in this browser')),
        section('Phone',
            row('Color', h('div', { class: 'zph-frames' }, FRAMES.map((f) =>
                h('button', { type: 'button', title: f.name, class: 'zph-frame' + (c.frame === f.id ? ' zph-sel' : ''), style: `background:${f.ring}`,
                    onclick: () => change(() => { c.frame = f.id; }) })))),
            row('Size', slider(50, 100, c.size, (v) => { c.size = v; saveCfg(); applyLook(); }, (v) => `${v}%`)),
            row('Side of the screen', seg([['left', 'Left'], ['right', 'Right']], c.side, (v) => change(() => { c.side = v; }))),
            row('Keep unlocked', sw(c.keepUnlocked, (v) => change(() => { c.keepUnlocked = v; }, false)), 'Reopening the phone skips the lock screen')),
        section('Reset',
            h('div', { class: 'zph-set-pad' }, h('button', { type: 'button', class: 'zph-reset', onclick: () => {
                const { extensionSettings } = SillyTavern.getContext();
                extensionSettings[MODULE] = DEFAULTS(); saveCfg(); applyLook(); renderApp();
            } }, 'Reset phone settings'))),
        h('p', { class: 'zph-about' }, 'Zenith Phone 0.2 · ZenithTavern'));
}

/** Shrinks a picture so it is cheap to keep in your settings. Returns a JPEG data URL. */
function downscale(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, maxW / img.width, maxH / img.height);
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
        img.src = url;
    });
}

/*
 * Apps, in home-screen order. One object each:
 *   id, name, title (shown at the top of the app), icon (Font Awesome class), color (icon background),
 *   render()  -> the app's screen (a DOM element)
 *   live()    -> optional; true shows a small dot on the icon ("this is switched on")
 * To add an app, add an object here. Nothing else to change.
 */
const panelScreen = (key) => () => globalThis.ZenithPanel?.screens?.[key]?.() || soon('Zenith Panel is not loaded.');
const panelLive = (key) => () => !!globalThis.ZenithPanel?.live?.[key]?.();
const soon = (text) => h('div', { class: 'zph-soon' }, h('i', { class: 'fa-solid fa-hourglass-half' }), h('b', {}, 'Coming soon'), h('p', {}, text));

const APPS = [
    { id: 'promptos', name: 'PromptOS', title: 'PromptOS', icon: 'fa-terminal', color: 'linear-gradient(160deg,#3a3a40,#121214)',
      render: () => globalThis.ZenithStyle?.screen?.() || soon('Zenith Style is not loaded.'), live: () => !!globalThis.ZenithStyle?.live?.() },
    { id: 'sysprompts', name: 'System Prompts', title: 'System Prompts', icon: 'fa-scroll', color: 'linear-gradient(160deg,#64d2ff,#0a84ff)',
      render: () => soon('Waiting for the characters and their expressions. The prompt work starts after that.') },
    { id: 'course', name: 'Course Modifiers', title: 'Course Modifiers', icon: 'fa-compass', color: 'linear-gradient(160deg,#ffb340,#ff7a00)',
      render: panelScreen('course'), live: panelLive('course') },
    { id: 'narrators', name: 'Narrators', title: 'Narrators', icon: 'fa-book-open', color: 'linear-gradient(160deg,#7d7aff,#4a3fd1)',
      render: panelScreen('narrators'), live: panelLive('narrators') },
    { id: 'copycat', name: 'Copycat', title: 'Copycat & Catnip Jar', icon: 'fa-cat', color: 'linear-gradient(160deg,#ff6482,#e0245e)',
      render: panelScreen('copycat'), live: panelLive('copycat') },
    { id: 'ooc', name: 'OOC', title: 'OOC Mode', icon: 'fa-comments', color: 'linear-gradient(160deg,#5be37d,#1fa141)',
      render: panelScreen('ooc'), live: panelLive('ooc') },
    { id: 'exroster', name: 'EX-Roster', title: 'EX-Roster', icon: 'fa-user-plus', color: 'linear-gradient(160deg,#f5c451,#b9770e)',
      launch: () => (globalThis.ZenithEx ? globalThis.ZenithEx.open() : globalThis.toastr?.warning('EX-Roster is not loaded.')) },
    { id: 'maps', name: 'Maps', title: 'Maps', icon: 'fa-map-location-dot', color: 'linear-gradient(160deg,#5be3b5,#14876a)',
      launch: () => (globalThis.ZenithMaps ? globalThis.ZenithMaps.open() : globalThis.toastr?.warning('Maps is not loaded.')) },
    { id: 'settings', name: 'Settings', title: 'Settings', icon: 'fa-gear', color: 'linear-gradient(160deg,#9a9aa2,#4a4a52)', dock: true,
      render: () => settingsApp() },
];

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
};
let open = false;
let unlocked = false;
let wrap, phone, lockEl, homeEl, appEl, appBodyEl, appTitleEl, homeBar, timeEls = [], dateEl;
let currentApp = null;

function statusBar() {
    const time = h('span', { class: 'zph-time-s' });
    timeEls.push(time);
    const right = h('div', { class: 'zph-status-r' });
    right.innerHTML = `
        <svg viewBox="0 0 18 12" width="18" height="12"><g fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></g></svg>
        <svg viewBox="0 0 17 12" width="17" height="12"><g fill="currentColor"><path d="M8.5 2.2c2.3 0 4.4.9 6 2.4l1-1.1A10.4 10.4 0 0 0 8.5.7 10.4 10.4 0 0 0 1.5 3.5l1 1.1a8.9 8.9 0 0 1 6-2.4z"/><path d="M8.5 5.5c1.4 0 2.6.5 3.6 1.4l1-1.1a7.1 7.1 0 0 0-9.2 0l1 1.1c1-.9 2.2-1.4 3.6-1.4z"/><path d="M8.5 8.8c.7 0 1.3.3 1.8.7L8.5 11.5 6.7 9.5c.5-.4 1.1-.7 1.8-.7z"/></g></svg>
        <svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="22" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect class="zph-batfill" x="2" y="2" width="19" height="9" rx="2.2" fill="currentColor"/><path d="M24 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill="currentColor" opacity=".5"/></svg>`;
    return h('div', { class: 'zph-status' }, time, right);
}

function buildLock() {
    const big = h('div', { class: 'zph-time-big' });
    timeEls.push(big);
    dateEl = h('div', { class: 'zph-date' });
    const lockIcon = h('div', { class: 'zph-lockicon' });
    lockIcon.innerHTML = '<svg viewBox="0 0 24 30" width="22" height="27"><path fill="currentColor" d="M12 0C8 0 5 3 5 7v4H3.5A1.5 1.5 0 0 0 2 12.5v14A1.5 1.5 0 0 0 3.5 28h17a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 20.5 11H19V7c0-4-3-7-7-7zm-4.2 7c0-2.4 1.8-4.2 4.2-4.2s4.2 1.8 4.2 4.2v4H7.8z" transform="translate(1 1)"/></svg>';
    const flash = h('div', { class: 'zph-quick', title: 'Flashlight' });
    flash.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 2h8v3l-1.5 3v3.2L12 12l-2.5-.8V8L8 5zM10.5 12.6l3 .9V21a1.5 1.5 0 0 1-3 0z"/></svg>';
    const cam = h('div', { class: 'zph-quick', title: 'Camera' });
    cam.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M9 4 7.6 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.6L15 4zm3 4.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 1.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"/></svg>';
    return h('div', { class: 'zph-lock' },
        lockIcon, dateEl, big,
        h('div', { class: 'zph-hint' }, 'Click the bar below to unlock'),
        h('div', { class: 'zph-quick-row' }, flash, cam));
}

function buildHome() {
    const tile = (a) => h('button', { class: 'zph-app', type: 'button', 'data-app': a.id, title: a.name, onclick: () => (a.launch ? a.launch() : openApp(a.id)) },
        h('span', { class: 'zph-app-icon', style: `background:${a.color || '#555'}` }, h('i', { class: `fa-solid ${a.icon}` }), h('em', { class: 'zph-dot' })),
        a.dock ? null : h('span', { class: 'zph-app-name' }, a.name));
    return h('div', { class: 'zph-home' },
        h('div', { class: 'zph-grid' }, APPS.filter((a) => !a.dock).map(tile)),
        h('div', { class: 'zph-dock' }, APPS.filter((a) => a.dock).map(tile)));
}

function buildApp() {
    appTitleEl = h('b', { class: 'zph-app-title' });
    appBodyEl = h('div', { class: 'zph-appbody' });
    return h('div', { class: 'zph-appscreen' },
        h('header', { class: 'zph-apphead' }, appTitleEl),
        appBodyEl);
}

/** Draws the open app (keeps the scroll position, never redraws under someone's cursor). */
function renderApp() {
    const app = APPS.find((a) => a.id === currentApp);
    if (!app || !appBodyEl) return;
    const f = document.activeElement;
    if (f && appBodyEl.contains(f) && /^(INPUT|TEXTAREA)$/.test(f.tagName) && f.type !== 'checkbox') return;
    const scroll = appBodyEl.scrollTop;
    appTitleEl.textContent = app.title || app.name;
    appBodyEl.replaceChildren(app.render());
    appBodyEl.scrollTop = scroll;
}

function refreshDots() {
    for (const a of APPS) homeEl?.querySelector(`[data-app="${a.id}"] .zph-dot`)?.classList.toggle('zph-on', !!a.live?.());
}

function openApp(id) {
    currentApp = id;
    appBodyEl.scrollTop = 0;
    appBodyEl.replaceChildren();
    renderApp();
    phone.classList.add('zph-in-app');
    homeBar.title = 'Home';
}
function closeApp() {
    currentApp = null;
    phone.classList.remove('zph-in-app');
    refreshDots();
    homeBar.title = 'Home';
}

function tick() {
    const now = new Date();
    const hrs = cfg().hours;
    const t = (hrs === '24'
        ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        : now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(hrs === '12' ? { hour12: true } : {}) })
    ).replace(/\s?[AP]M$/i, '');
    for (const el of timeEls) el.textContent = t;
    if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function setUnlocked(v) {
    unlocked = v;
    phone.classList.toggle('zph-unlocked', v);
    if (v) refreshDots();
    homeBar.title = v ? 'Home' : 'Unlock';
}

function fit() {
    if (!wrap) return;
    const avail = window.innerHeight - MARGIN_TOP - MARGIN_BOTTOM;
    const narrow = window.innerWidth - 24;
    const s = Math.max(0.25, Math.min(1, avail / PHONE_H, narrow / PHONE_W) * (cfg().size / 100));
    wrap.style.setProperty('--zph-scale', String(s));
}

let phoneCloseTimer = 0;
function setOpen(v) {
    open = v;
    if (v) { closeApp(); if (!cfg().keepUnlocked) setUnlocked(false); tick(); fit(); }
    clearTimeout(phoneCloseTimer);
    wrap.classList.remove('zph-closing');
    if (v) wrap.classList.add('zph-open');
    else if (wrap.classList.contains('zph-open')) { wrap.classList.add('zph-closing'); phoneCloseTimer = setTimeout(() => wrap.classList.remove('zph-open', 'zph-closing'), 200); }
    document.getElementById('zenith_phone_btn')?.classList.toggle('zph-btn-on', v);
}

function mount() {
    const sideBtn = h('button', { class: 'zph-side', type: 'button', title: 'Lock', onclick: () => setUnlocked(false) });
    lockEl = buildLock();
    homeEl = buildHome();
    appEl = buildApp();
    homeBar = h('div', { class: 'zph-homebar', title: 'Unlock', onclick: () => { if (!unlocked) setUnlocked(true); else if (currentApp) closeApp(); } }, h('i'));
    const screen = h('div', { class: 'zph-screen' },
        h('div', { class: 'zph-wall' }),
        homeEl, appEl, lockEl,
        statusBar(),
        h('div', { class: 'zph-notch' }, h('i', { class: 'zph-speaker' }), h('i', { class: 'zph-cam' })),
        homeBar);
    phone = h('div', { class: 'zph-phone' },
        h('i', { class: 'zph-silent' }), h('i', { class: 'zph-vol zph-vol-up' }), h('i', { class: 'zph-vol zph-vol-dn' }),
        sideBtn, screen);
    wrap = h('div', { id: 'zenith_phone', class: 'zph-wrap', 'data-keep-brand': '' }, phone);
    document.body.append(wrap);

    const btn = h('button', { id: 'zenith_phone_btn', type: 'button', class: 'zph-fab', title: 'Phone', onclick: () => setOpen(!open) });
    btn.innerHTML = '<i class="fa-solid fa-mobile-screen-button"></i>';
    // A slim bar on top of the message box. Later buttons are added to the same bar (#zenith_bar).
    let bar = document.getElementById('zenith_bar');
    if (!bar) {
        bar = h('div', { id: 'zenith_bar', 'data-keep-brand': '' });
        const send = document.getElementById('send_form');
        if (send?.parentElement) send.parentElement.insertBefore(bar, send); else document.body.append(bar);
    }
    bar.append(btn);

    setInterval(tick, 1000);
    document.addEventListener('zenith-panel-render', () => { renderApp(); refreshDots(); });
    window.addEventListener('resize', fit);
    applyLook();
    initBattery();
}

function registerCommand() {
    try {
        const { SlashCommandParser } = SillyTavern.getContext();
        const { SlashCommand } = SillyTavern.getContext();
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'phone', helpString: 'Opens or closes the Zenith Phone.', returns: 'nothing',
            callback: () => { setOpen(!open); return ''; },
        }));
    } catch (e) { console.debug('[Zenith Phone] /phone not registered', e); }
}

jQuery(() => { mount(); registerCommand(); });
