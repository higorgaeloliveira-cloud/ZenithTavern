/*
 * Zenith Maps - full-screen maps of Asterhaven: City, Campus and Dorms.
 *   City / Campus : a drawn map with pins, and the places listed below it (tap a place to see it on the map).
 *   Dorms         : pick a building, pick a floor, see the layout, then everyone on that floor with their room
 *                   (tap a resident to light up their room).
 * All the data is in maps.json next to this file. Opened from the Maps app on the phone or with /maps.
 */
const DATA_URL = '/scripts/extensions/third-party/zenith-maps/maps.json';
const ctx = () => SillyTavern.getContext();
const NS = 'http://www.w3.org/2000/svg';
const TYPE_COLOR = { hall: '#8a6f4a', library: '#7a5a9a', science: '#3f7aa8', green: '#3f8f58', union: '#b0703a', cafe: '#b8553f', pool: '#2f9ab0', gate: '#666a73' };
const ROOM_COLOR = { room: '#e9e4d8', ra: '#f2d34f', bath: '#b86fd0', common: '#8fd3c9', kitchen: '#e8b98a', mail: '#9fc0ea', study: '#c7e0a0', laundry: '#74d3e0', storage: '#b9b9b9' };

let data = null, root = null, body = null, tabsEl = null;
const st = { tab: 'city', sel: null, building: 'marlowe', floor: '2' };

const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
};
const s = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
};
const wrap = (text, max) => {
    const out = []; let line = '';
    for (const w of String(text).split(' ')) {
        if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
    return out;
};
const label = (x, y, text, size, cls = '', max = 0) => {
    const lines = max ? wrap(text, max) : [String(text)];
    const t = s('text', { x, y: y - ((lines.length - 1) * size * 0.6), 'text-anchor': 'middle', 'font-size': size, class: 'zm-t ' + cls });
    lines.forEach((l, i) => t.append(s('tspan', { x, dy: i === 0 ? 0 : size * 1.2 }, l)));
    return t;
};
const firstName = (n) => (n === 'You' ? 'You' : n.split(' ')[0]);

// ---------------------------------------------------------------- avatars
function avatarFor(name) {
    try {
        const c = ctx().characters?.find((x) => x?.name === name);
        if (c?.avatar) return `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`;
    } catch { /* not loaded */ }
    return null;
}
const polaroid = (name, isUser) => {
    const url = isUser ? null : avatarFor(name);
    const box = h('div', { class: 'zm-pol' });
    if (url) box.style.backgroundImage = `url("${url}")`;
    else { box.classList.add('zm-pol-i'); box.textContent = isUser ? '★' : name.trim()[0] || '?'; }
    return box;
};

// ---------------------------------------------------------------- City
function citySvg() {
    const c = data.city, [W, H] = c.viewBox;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'zm-svg', xmlns: NS });
    svg.append(s('rect', { width: W, height: H, fill: '#0e2a3d' }));
    svg.append(s('path', { d: 'M0,0 H1000 V525 Q900 548 800 532 T600 542 T400 530 T200 543 T0 524 Z', fill: '#1a2230' }));
    for (const a of c.areas) {
        svg.append(s('rect', { x: a.x, y: a.y, width: a.w, height: a.h, rx: 18, fill: a.color, 'fill-opacity': .16, stroke: a.color, 'stroke-opacity': .7, 'stroke-width': 2 }));
        svg.append(label(a.id === 'hf' ? a.x + 90 : a.x + a.w / 2, a.y + 24, a.name.toUpperCase(), 16, 'zm-area', a.id === 'hf' ? 0 : 22));
    }
    // streets
    for (const d of ['M40,300 H310', 'M175,130 V400', 'M330,370 H620', 'M470,40 V450', 'M330,170 H620', 'M640,250 H960', 'M800,40 V450', 'M120,500 H880'])
        svg.append(s('path', { d, stroke: '#ffffff', 'stroke-opacity': .12, 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }));
    svg.append(label(500, 520, 'Promenade', 12, 'zm-street'));
    for (const b of c.buses)
        svg.append(s('polyline', { points: b.points.map((p) => p.join(',')).join(' '), stroke: b.color, 'stroke-width': 4, 'stroke-dasharray': '10 7', fill: 'none', opacity: .85 }));
    // legend
    let ly = 575;
    for (const b of c.buses.filter((x) => !x.name.includes('('))) {
        svg.append(s('line', { x1: 30, x2: 70, y1: ly, y2: ly, stroke: b.color, 'stroke-width': 4, 'stroke-dasharray': '10 7' }));
        svg.append(s('text', { x: 78, y: ly + 5, 'font-size': 14, class: 'zm-t zm-leg' }, b.name)); ly += 24;
    }
    svg.append(label(850, 600, 'HARBOR', 16, 'zm-sea'));
    for (const p of c.places) {
        const g = s('g', { 'data-id': p.id, class: 'zm-pin' + (p.offmap ? ' zm-off' : '') });
        g.append(s('circle', { cx: p.x, cy: p.y, r: 17, class: 'zm-pin-c' }));
        g.append(s('text', { x: p.x, y: p.y + 6, 'text-anchor': 'middle', 'font-size': 17, class: 'zm-pin-i' }, p.icon));
        g.append(label(p.x, p.y + 38, p.name, 16, 'zm-pin-l', 14));
        svg.append(g);
    }
    return svg;
}

// ---------------------------------------------------------------- Campus
function campusSvg() {
    const c = data.campus, [W, H] = c.viewBox;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'zm-svg', xmlns: NS });
    svg.append(s('rect', { width: W, height: H, fill: '#142319' }));
    const q = c.quad;
    svg.append(s('path', { d: 'M30,300 H470 M500,200 V560 M500,330 H700 M200,360 V410 M500,170 V200', stroke: '#e8d8a8', 'stroke-opacity': .22, 'stroke-width': 10, fill: 'none', 'stroke-linecap': 'round' }));
    svg.append(s('ellipse', { cx: q.x, cy: q.y, rx: q.rx, ry: q.ry, fill: '#25512f', stroke: '#3b7a48', 'stroke-width': 3 }));
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        svg.append(s('circle', { cx: q.x + Math.cos(a) * (q.rx - 26), cy: q.y + Math.sin(a) * (q.ry - 20), r: 8, fill: '#c9772c', 'fill-opacity': .8 }));
    }
    svg.append(label(q.x, q.y + 5, q.label.toUpperCase(), 15, 'zm-area'));
    for (const p of c.places) {
        const g = s('g', { 'data-id': p.id, class: 'zm-bld' });
        g.append(s('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 10, fill: TYPE_COLOR[p.type] || '#777', 'fill-opacity': .85, class: 'zm-bld-r' }));
        g.append(label(p.x + p.w / 2, p.y + p.h / 2 + 5, p.name, 14, 'zm-bld-l', Math.max(8, Math.floor(p.w / 8.5))));
        svg.append(g);
    }
    for (const e of c.exits) {
        svg.append(label(e.side === 'left' ? 105 : e.x, e.side === 'left' ? e.y : e.y, '← ' + e.label, 13, 'zm-leg', e.side === 'left' ? 16 : 0));
    }
    return svg;
}

// ---------------------------------------------------------------- Dorm floor layouts
function parseSide(str) {
    const out = [];
    for (const tok of String(str || '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const m = tok.match(/^r\*(\d+)$/);
        if (m) { for (let i = 0; i < +m[1]; i++) out.push({ t: 'room', span: 1 }); continue; }
        if (tok === 'r') { out.push({ t: 'room', span: 1 }); continue; }
        const [t, span, ...lab] = tok.split(':');
        out.push({ t, span: +span || 1, label: lab.join(':') || t });
    }
    return out;
}
function floorSvg(bld, fl) {
    const W = 920, H = 420;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'zm-svg', xmlns: NS });
    svg.append(s('rect', { width: W, height: H, fill: '#e9e7e1' }));
    svg.append(label(W / 2, 34, `${bld.name.toUpperCase()}  -  ${fl.label.toUpperCase()}`, 20, 'zm-dtitle'));
    const block = (x, y, w, hh, t, lab, id, extra = {}) => {
        const g = s('g', { 'data-id': id || null, class: 'zm-room' });
        g.append(s('rect', { x, y, width: w, height: hh, fill: ROOM_COLOR[t] || ROOM_COLOR.room, stroke: '#222', 'stroke-width': 2, class: 'zm-room-r' }));
        if (lab) g.append(label(x + w / 2, y + hh / 2 + 5, lab, extra.size || 13, 'zm-dlabel', Math.max(6, Math.floor(w / 8))));
        svg.append(g); return g;
    };
    if (fl.custom) {
        svg.append(s('rect', { x: 20, y: 70, width: 80, height: 280, fill: '#d6d3cb', stroke: '#222', 'stroke-width': 2 }));
        svg.append(label(60, 215, 'STAIRS', 13, 'zm-dlabel'));
        for (const r of fl.custom) block(r.x, r.y, r.w, r.h, r.t, r.label, r.id);
        svg.append(s('rect', { x: 100, y: 190, width: 720, height: 40, fill: '#f7f5ef' })); // placeholder corridor under custom rooms
        return svg;
    }
    const north = parseSide(fl.north), south = parseSide(fl.south);
    const slots = Math.max(north.reduce((a, x) => a + x.span, 0), south.reduce((a, x) => a + x.span, 0));
    const unit = 720 / slots, floorNo = Number(fl.id);
    svg.append(s('rect', { x: 100, y: 190, width: 720, height: 40, fill: '#f7f5ef' }));
    svg.append(label(460, 215, 'C O R R I D O R', 12, 'zm-street'));
    // end blocks: stairs / elevator
    block(20, 70, 80, 280, 'storage', '', null);
    svg.append(label(60, 200, 'STAIRS', 12, 'zm-dlabel')); svg.append(label(60, 222, '+ ELEVATOR', 11, 'zm-dlabel'));
    block(820, 70, 80, 280, 'storage', '', null);
    svg.append(label(860, 215, 'STAIRS', 12, 'zm-dlabel'));
    const residents = bld.residents || [];
    const place = (list, y, firstNum) => {
        let x = 100, n = 0;
        for (const it of list) {
            const w = it.span * unit - 0;
            if (it.t === 'room') {
                const num = String(floorNo * 100 + firstNum + n * 2); n++;
                const who = residents.filter((r) => r.room === num);
                const g = block(x, y, w, 120, 'room', '', 'r' + num);
                if (who.length) g.classList.add('zm-occ');
                g.append(label(x + w / 2, y + (who.length ? 52 : 68), num, 17, 'zm-rnum'));
                who.slice(0, 3).forEach((r, i) => g.append(label(x + w / 2, y + 74 + i * 15, firstName(r.name), 12, 'zm-rname')));
            } else block(x, y, w, 120, it.t, it.label, 'x' + it.t + x + y);
            x += w;
        }
    };
    place(north, 70, 1);
    place(south, 230, 2);
    // door ticks
    svg.append(s('text', { x: 100, y: 372, 'font-size': 12, class: 'zm-leg2' }, 'north side: odd rooms'));
    svg.append(s('text', { x: 820, y: 372, 'text-anchor': 'end', 'font-size': 12, class: 'zm-leg2' }, 'south side: even rooms'));
    // legend
    let lx = 20;
    for (const [t, name] of [['ra', 'Staff (RA)'], ['bath', 'Shared bathroom'], ['common', 'Common room'], ['kitchen', 'Kitchen'], ['laundry', 'Laundry']]) {
        svg.append(s('rect', { x: lx, y: 392, width: 14, height: 14, fill: ROOM_COLOR[t], stroke: '#222' }));
        svg.append(s('text', { x: lx + 20, y: 404, 'font-size': 12, class: 'zm-leg2' }, name)); lx += 20 + name.length * 7 + 22;
    }
    return svg;
}

// ---------------------------------------------------------------- selection
function select(id, opts = {}) {
    st.sel = id;
    root.querySelectorAll('.zm-on').forEach((e) => e.classList.remove('zm-on'));
    if (!id) return updateInfo();
    root.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((e) => e.classList.add('zm-on'));
    updateInfo();
    if (opts.scroll) root.querySelector('.zm-mapcard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function updateInfo() {
    const box = root.querySelector('.zm-info'); if (!box) return;
    box.replaceChildren();
    if (!st.sel) { box.append(h('span', { class: 'zm-hint' }, 'Tap a place on the map or in the list.')); return; }
    if (st.tab === 'dorms') {
        const b = bldg(), num = st.sel.replace(/^r/, ''), who = (b.residents || []).filter((r) => r.room === num);
        box.append(h('b', {}, `Room ${num}`), h('span', {}, who.length ? ' - ' + who.map((r) => r.name).join(', ') : ' - open room, nobody assigned yet'));
        return;
    }
    const list = st.tab === 'city' ? data.city.places : data.campus.places;
    const p = list.find((x) => x.id === st.sel); if (!p) return;
    box.append(h('b', {}, p.name), h('p', {}, p.text), p.who?.length ? h('p', { class: 'zm-who' }, 'Here: ' + p.who.join(', ')) : null);
    if (p.dorm) box.append(h('button', { class: 'zm-btn', onclick: () => openDorm(p.dorm) }, 'Open floor plans'));
    if (p.campus) box.append(h('button', { class: 'zm-btn', onclick: () => go('campus') }, 'Open campus map'));
}

// ---------------------------------------------------------------- views
const bldg = () => data.dorms.buildings.find((b) => b.id === st.building) || data.dorms.buildings[0];
const floorOf = (r) => (data.dorms.buildings.length ? String(r.room)[0] : '1');

function mapCard(svg, caption) {
    const card = h('div', { class: 'zm-mapcard' }, h('div', { class: 'zm-mapwrap' }, svg));
    card.append(h('div', { class: 'zm-cap' }, h('span', {}, caption),
        h('button', { class: 'zm-zoom-btn', onclick: () => enlarge(svg) }, h('i', { class: 'fa-solid fa-magnifying-glass-plus' }), ' Tap to enlarge')));
    svg.addEventListener('click', (e) => {
        const g = e.target.closest('[data-id]');
        if (g) select(g.getAttribute('data-id') === st.sel ? null : g.getAttribute('data-id'));
    });
    return card;
}
function enlarge(svg) {
    const clone = svg.cloneNode(true);
    const z = h('div', { class: 'zm-zoom' },
        h('button', { class: 'zm-x', onclick: () => z.remove(), title: 'Close' }, '×'),
        h('div', { class: 'zm-zoomscroll' }, clone));
    root.append(z);
    const on = clone.querySelector('.zm-on');
    if (on) on.scrollIntoView({ block: 'center', inline: 'center' });
}

function listCityCampus(places, groups) {
    const wrapEl = h('div', { class: 'zm-places' });
    for (const g of groups) {
        const items = places.filter((p) => (g.id ? p.area === g.id : true));
        if (!items.length) continue;
        wrapEl.append(h('h4', {}, g.name));
        for (const p of items) {
            wrapEl.append(h('button', { class: 'zm-place', 'data-id': p.id, onclick: () => select(p.id === st.sel ? null : p.id, { scroll: true }) },
                h('span', { class: 'zm-place-n' }, p.name),
                h('span', { class: 'zm-place-w' }, (p.who || []).join(', ') || p.text.split('.')[0])));
        }
    }
    return wrapEl;
}

function viewCity() {
    const c = data.city;
    const frag = h('div', {}, mapCard(citySvg(), 'Asterhaven city map'), h('div', { class: 'zm-info' }));
    frag.append(listCityCampus(c.places, c.areas));
    frag.append(h('h4', {}, 'Getting around'), h('ul', { class: 'zm-travel' }, c.travel.map((t) => h('li', {}, t))));
    return frag;
}
function viewCampus() {
    const c = data.campus;
    const frag = h('div', {}, mapCard(campusSvg(), 'Asterhaven University - campus map'), h('div', { class: 'zm-info' }));
    frag.append(listCityCampus(c.places, [{ name: 'Buildings and places' }]));
    return frag;
}
function viewDorms() {
    const b = bldg();
    const fl = b.floors.find((f) => f.id === st.floor) || b.floors[0];
    st.floor = fl.id;
    const frag = h('div', {});
    frag.append(h('div', { class: 'zm-head2' }, h('div', { class: 'zm-sub' }, 'ASTERHAVEN UNIVERSITY'), h('div', { class: 'zm-bname' }, b.name),
        h('div', { class: 'zm-sub2' }, b.sub), h('p', { class: 'zm-btext' }, b.text)));
    frag.append(h('div', { class: 'zm-chips' }, data.dorms.buildings.map((x) =>
        h('button', { class: 'zm-chip' + (x.id === b.id ? ' zm-chip-on' : ''), onclick: () => openDorm(x.id) }, x.name))));
    const count = (f) => (b.residents || []).filter((r) => String(r.room)[0] === f.id && f.id !== 'b').length;
    frag.append(h('div', { class: 'zm-floors' }, b.floors.map((f) =>
        h('button', { class: 'zm-floor' + (f.id === fl.id ? ' zm-floor-on' : ''), onclick: () => { st.floor = f.id; st.sel = null; render(); } },
            f.label, h('span', { class: 'zm-count' }, String(count(f)))))));
    frag.append(mapCard(floorSvg(b, fl), `${b.name} - ${fl.label}`), h('div', { class: 'zm-info' }));
    const res = (b.residents || []).filter((r) => String(r.room)[0] === fl.id && fl.id !== 'b');
    frag.append(h('div', { class: 'zm-reshead' }, h('h3', {}, `${fl.label} residents`), h('span', {}, 'Tap someone to find their room')));
    if (!res.length) frag.append(h('div', { class: 'zm-empty' }, fl.id === 'b' ? 'Nobody lives in the basement.' : 'No named residents here yet. Every room is open for your own characters.'));
    for (const r of res.sort((a, z) => a.room.localeCompare(z.room))) {
        frag.append(h('button', { class: 'zm-res', 'data-id': 'r' + r.room, onclick: () => select('r' + r.room, { scroll: true }) },
            polaroid(r.name, r.user),
            h('div', { class: 'zm-res-t' }, h('b', {}, r.name), r.note ? h('span', {}, r.note) : null),
            h('div', { class: 'zm-res-r' }, h('small', {}, 'ROOM'), h('b', {}, r.room))));
    }
    return frag;
}

function openDorm(id) {
    st.building = id; st.tab = 'dorms'; st.sel = null;
    const b = bldg(), first = (b.residents || [])[0];
    st.floor = b.floors.some((f) => f.id === String(first?.room || '')[0]) ? String(first.room)[0] : b.floors.find((f) => f.id === '1')?.id || b.floors[0].id;
    render();
}
function go(tab) { st.tab = tab; st.sel = null; render(); }

function render() {
    if (!root) return;
    tabsEl.querySelectorAll('button').forEach((bt) => bt.classList.toggle('zm-tab-on', bt.dataset.tab === st.tab));
    body.replaceChildren(st.tab === 'city' ? viewCity() : st.tab === 'campus' ? viewCampus() : viewDorms());
    body.scrollTop = 0;
    updateInfo();
}

// ---------------------------------------------------------------- open / close
async function open(tab) {
    if (root) close();
    if (!data) {
        try { data = await (await fetch(DATA_URL, { cache: 'no-store' })).json(); }
        catch { globalThis.toastr?.error('Maps could not be loaded.'); return; }
    }
    if (tab && ['city', 'campus', 'dorms'].includes(tab)) st.tab = tab;
    tabsEl = h('div', { class: 'zm-tabs' }, [['city', 'City'], ['campus', 'Campus'], ['dorms', 'Dorms']].map(([k, n]) =>
        h('button', { class: 'zm-tab', 'data-tab': k, onclick: () => go(k) }, n)));
    body = h('div', { class: 'zm-body' });
    root = h('div', { class: 'zm-overlay', 'data-keep-brand': '' },
        h('div', { class: 'zm-window' },
            h('div', { class: 'zm-top' }, h('span', {}, h('i', { class: 'fa-solid fa-map-location-dot' }), ' Maps'),
                h('button', { class: 'zm-x', onclick: close, title: 'Close' }, '×')),
            tabsEl, body));
    document.body.append(root);
    render();
}
function close() { root?.remove(); root = body = tabsEl = null; }

function registerCommands() {
    try {
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'maps', helpString: 'Opens the maps: /maps city|campus|dorms',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'city, campus or dorms', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
            callback: async (_a, v) => { await open(String(v || '').trim().toLowerCase()); return ''; },
        }));
    } catch (e) { console.warn('[zenith-maps] command not registered', e); }
}
globalThis.ZenithMaps = { open, close };
jQuery(() => registerCommands());
