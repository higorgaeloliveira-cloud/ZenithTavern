/*
 * Zenith Network - "Toggle Multi-IP" in the Settings menu.
 *   Off: ZenithTavern only answers on this computer (127.0.0.1).
 *   On:  it also listens on the network, and only the IP addresses you add may connect
 *        (for example your phone's Tailscale address). Changes need a restart, which the
 *        button below does for you.
 */
const API = '/api/plugins/zenith-system';
const ctx = () => SillyTavern.getContext();
let state = null;
let box = null;

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

async function call(path, method = 'GET', body) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: ctx().getRequestHeaders(),
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

async function save(patch) {
    try {
        state = await call('/network', 'POST', { multiIp: state.multiIp, ips: state.ips, ...patch });
    } catch (err) {
        toastr.error(err.message);
    }
    render();
}

async function addIp() {
    const { callGenericPopup, POPUP_TYPE } = ctx();
    const value = await callGenericPopup(
        'IP address of the device that may connect (for example your phone\'s Tailscale IP, like 100.101.102.103):',
        POPUP_TYPE.INPUT, '');
    const ip = String(value || '').trim();
    if (!ip) return;
    await save({ ips: [...state.ips, ip] });
}

async function restartNow() {
    const veil = h('div', { class: 'zn-veil' }, h('div', {}, h('b', {}, 'Restarting ZenithTavern…'), h('p', {}, 'This page reloads by itself. If it does not come back in a minute, check the launcher window.')));
    document.body.append(veil);
    try { await call('/restart', 'POST'); } catch { /* the server may close the connection while stopping */ }
    const started = Date.now();
    let sawDown = false;
    const tick = async () => {
        let up = false;
        try { up = (await fetch('/csrf-token', { cache: 'no-store' })).ok; } catch { up = false; }
        if (!up) sawDown = true;
        if (up && (sawDown || Date.now() - started > 6000)) return location.reload();
        if (Date.now() - started > 180000) { veil.querySelector('p').textContent = 'It is taking long. Check the launcher window, then reload this page.'; return; }
        setTimeout(tick, 1000);
    };
    setTimeout(tick, 1500);
}

function render() {
    if (!box || !state) return;
    const on = state.multiIp;
    const toggle = h('input', { type: 'checkbox', class: 'zn-switch', ...(on ? { checked: true } : {}) });
    toggle.addEventListener('change', () => save({ multiIp: toggle.checked }));

    box.replaceChildren(...[
        h('div', { class: 'zn-head' }, h('b', {}, 'Network access')),
        h('label', { class: 'zn-row' }, h('span', {}, 'Toggle Multi-IP'), h('span', { class: 'zn-state' }, on ? 'ON' : 'OFF'), toggle),
        !on ? h('p', { class: 'zn-note' }, `Off: ZenithTavern only works on this computer (127.0.0.1:${state.port}).`) : null,
        on ? h('div', { class: 'zn-on' },
            h('p', { class: 'zn-note' }, 'On: devices on this list can open ZenithTavern over the network. Nobody else can. Add the IP of the device that will connect, such as your phone\'s Tailscale address.'),
            h('div', { class: 'zn-ip zn-locked' }, h('span', {}, '127.0.0.1'), h('small', {}, 'this computer')),
            state.ips.map((ip) => h('div', { class: 'zn-ip' }, h('span', {}, ip),
                h('button', { type: 'button', class: 'menu_button zn-x', title: 'Remove', onclick: () => save({ ips: state.ips.filter((x) => x !== ip) }) }, '✕'))),
            h('button', { type: 'button', class: 'menu_button zn-add', onclick: addIp }, '+ Add New IP'),
            state.addresses.length ? h('p', { class: 'zn-note' }, 'On the other device, open: ',
                state.addresses.map((a, i) => [i ? ' or ' : '', h('code', {}, `http://${a.address}:${state.port}`), a.tailscale ? ' (Tailscale)' : ''])) : null,
            h('p', { class: 'zn-note' }, 'The first time, Windows may ask to allow network access for Node.js. Choose Allow for private networks.')) : null,
        state.restartNeeded ? h('div', { class: 'zn-restart' },
            h('span', {}, 'Restart needed to apply this change.'),
            h('button', { type: 'button', class: 'menu_button', onclick: restartNow }, 'Apply & restart')) : null,
    ].filter(Boolean));
}

async function mount() {
    const api = document.getElementById('rm_api_block');
    if (!api) return;
    box = h('div', { id: 'zenith_network' });
    const settings = document.getElementById('user-settings-block');
    if (settings && api.contains(settings)) settings.before(box); else api.append(box);
    try { state = await call('/network'); render(); } catch (err) { console.warn('[Zenith Network]', err); box.remove(); }
}

jQuery(() => { mount(); });
