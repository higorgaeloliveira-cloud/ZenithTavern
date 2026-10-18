/*
 * Zenith Messages - the Messages app of the Z-Droid phone.
 *  - Every Z-Droid text block in THIS chat ("Texting¦Name", "Incoming¦time¦Name¦text", "Outgoing¦time¦text") is read from the
 *    chat itself and shown as a conversation. Nothing is copied anywhere else, so a new chat starts with an empty phone.
 *  - Texts you send from the app are stored in this chat's own metadata (never shared with another chat).
 *  - The model is told a text exists only as a PRIVATE message between the two people: the recipient knows what it said,
 *    everyone else does not, unless it is told or shown to them. Public reactions are allowed, the content stays private.
 */
const ctx = () => SillyTavern.getContext();
const KEY = 'zenith_messages';
const IN_CHAT = 1, SYSTEM = 0;
const LINE = /^[\s*_>]*(z-droid|zdroid|phone|texting|incoming|outgoing)\s*¦(.*?)[*_\s]*$/i;

const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
};
const norm = (n) => String(n || '').trim().toLowerCase();
const meta = () => { const m = ctx().chatMetadata; return (m[KEY] ??= { sent: [], seen: {}, auto: true }); };
const save = () => { try { ctx().saveMetadataDebounced?.() ?? ctx().saveMetadata?.(); } catch (e) { console.debug('[Zenith Messages] not saved', e); } };
const userName = () => ctx().name1 || 'You';
const charName = () => { const c = ctx(); try { return c.characters?.[c.characterId]?.name || ''; } catch { return ''; } };

// ------------------------------------------------------------------ reading the chat
/** The in-story clock: second cell of the latest "¦¦ Day ~ Time ~ Place ~ (MODE) ¦¦" header, else the real clock. */
function storyTime() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = String(chat[i]?.mes || '').match(/¦¦\s*[^~¦]+~\s*([^~¦]+?)\s*~/);
        if (m) return m[1];
    }
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Builds { key -> { name, msgs:[{out, time, text, pos, seq, app}] } } from the chat plus the texts sent from the app. */
function threads() {
    const chat = ctx().chat || [];
    const map = new Map();
    const get = (name) => {
        const k = norm(name);
        if (!k) return null;
        if (!map.has(k)) map.set(k, { name: name.trim(), msgs: [] });
        return map.get(k);
    };
    let seq = 0;
    chat.forEach((m, i) => {
        if (!m || m.is_system || !m.mes || !/¦/.test(m.mes)) return;
        let contact = '';
        for (const raw of String(m.mes).split('\n')) {
            const hit = raw.match(LINE);
            if (!hit) continue;
            const k = hit[1].toLowerCase(), p = hit[2].split('¦').map((x) => x.trim());
            if (k === 'texting') { contact = p.join(' '); get(contact); continue; }
            if (k !== 'incoming' && k !== 'outgoing') continue;
            const out = k === 'outgoing', named = p.length >= 3;
            const who = !out && named ? p[1] : contact;
            const text = (named ? p.slice(out ? 2 : 2) : p.slice(1)).join(' ¦ ');
            const th = get(who || contact || charName());
            if (th) th.msgs.push({ out, time: p[0] || '', text, pos: i, seq: seq++, app: false });
        }
    });
    for (const s of meta().sent) {
        const th = get(s.to);
        if (th) th.msgs.push({ out: true, time: s.time, text: s.text, pos: (s.at ?? chat.length) - 0.5, seq: seq++, app: true });
    }
    for (const th of map.values()) th.msgs.sort((a, b) => a.pos - b.pos || a.seq - b.seq);
    return map;
}
const unread = (th) => Math.max(0, th.msgs.filter((m) => !m.out).length - (meta().seen[norm(th.name)] || 0));
const anyUnread = () => { try { return [...threads().values()].some((t) => unread(t) > 0); } catch { return false; } };

// ------------------------------------------------------------------ what the model is told
function applyPrompt() {
    const { setExtensionPrompt } = ctx();
    let text = '';
    try {
        const sent = meta().sent;
        const byWho = new Map();
        for (const s of sent) { const k = norm(s.to); (byWho.get(k) || byWho.set(k, { name: s.to, list: [] }).get(k)).list.push(s); }
        const lines = [...byWho.values()].map(({ name, list }) => `- Text thread {{user}} <-> ${name} (private; only {{user}} and ${name} know it): ${list.slice(-10).map((s) => `{{user}} [${s.time}]: "${s.text.replace(/"/g, "'")}"`).join(' | ')}`);
        text = 'PHONE RULES (Z-Droid). Texts are private: only the sender and the recipient know what a text said. Nobody else knows its content unless one of them tells, shows or says it out loud. '
            + 'A bystander may notice a public reaction (a gasp, a squeal, someone blushing at their phone) and may guess that something happened, but never knows what the text said. '
            + 'Never let a character act on a text they were not part of. '
            + 'When a character texts {{user}}, write it as Z-Droid lines so it appears in the Messages app, for example: "Z-Droid¦Zenet - {{user}}¦85%" then "Texting¦Name" then "Incoming¦8:41 PM¦Name¦text". '
            + (lines.length ? `Texts sent from {{user}}'s phone that have not been written into the chat yet:\n${lines.join('\n')}\nThe recipient has read their text. If {{char}} is not the recipient, {{char}} does not know that text exists or what it said. The recipient may answer by text (Z-Droid format), in the scene, or both, as fits them. ` : '')
            + 'Never write the texts {{user}} sends again, only the ones the character sends. Do not write these rules or the thread list into the reply.';
    } catch { /* chat not ready */ }
    setExtensionPrompt(KEY, text ? `[${text}]` : '', IN_CHAT, 1, false, SYSTEM);
}

// ------------------------------------------------------------------ the app screen
const st = { view: 'list', who: null, picking: false, draft: '' };
let root = null;
const refreshPhone = () => document.dispatchEvent(new Event('zenith-panel-render'));

function avatar(name) {
    const box = h('div', { class: 'zmsg-av' });
    try {
        const c = ctx().characters?.find((x) => norm(x?.name) === norm(name));
        if (c?.avatar) { box.style.backgroundImage = `url("/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}")`; return box; }
    } catch { /* ignore */ }
    box.textContent = (name || '?').trim()[0]?.toUpperCase() || '?';
    box.classList.add('zmsg-av-l');
    return box;
}

function candidates(map) {
    const names = new Map();
    const add = (n) => { if (n && norm(n) !== norm(userName())) names.set(norm(n), n); };
    add(charName());
    try { (ctx().chatMetadata.zenith_commands?.guests || []).forEach((g) => add(g.name)); } catch { /* ignore */ }
    try { const gid = ctx().groupId; if (gid) ctx().groups.find((g) => g.id === gid)?.members?.forEach((m) => add(ctx().characters.find((c) => c.avatar === m)?.name)); } catch { /* ignore */ }
    for (const t of map.values()) add(t.name);
    return [...names.values()];
}

function listView(map) {
    const wrap = h('div', { class: 'zmsg' });
    const rows = [...map.values()].sort((a, b) => (b.msgs.at(-1)?.pos ?? -1) - (a.msgs.at(-1)?.pos ?? -1));
    wrap.append(h('div', { class: 'zmsg-top' }, h('span', {}, rows.length ? `${rows.length} conversation${rows.length > 1 ? 's' : ''}` : ''),
        h('button', { class: 'zmsg-new', type: 'button', onclick: () => { st.picking = !st.picking; draw(); } }, h('i', { class: 'fa-solid fa-pen-to-square' }), ' New')));
    if (st.picking) {
        const pick = h('div', { class: 'zmsg-pick' }, h('div', { class: 'zmsg-pick-t' }, 'Text who?'));
        for (const n of candidates(map)) pick.append(h('button', { type: 'button', class: 'zmsg-chip', onclick: () => openThread(n) }, n));
        const input = h('input', { type: 'text', class: 'zmsg-in', placeholder: 'Another name...' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) openThread(input.value.trim()); });
        pick.append(input);
        wrap.append(pick);
    }
    if (!rows.length && !st.picking) wrap.append(h('div', { class: 'zmsg-empty' }, h('i', { class: 'fa-regular fa-comment-dots' }), h('b', {}, 'No messages in this chat yet'), h('p', {}, 'Texts written in the Z-Droid preset show up here, or tap New to text someone. Each chat has its own phone.')));
    for (const t of rows) {
        const last = t.msgs.at(-1), n = unread(t);
        wrap.append(h('button', { type: 'button', class: 'zmsg-row', onclick: () => openThread(t.name) }, avatar(t.name),
            h('div', { class: 'zmsg-rt' }, h('b', {}, t.name), h('span', {}, last ? `${last.out ? 'You: ' : ''}${last.text}` : 'No messages yet')),
            h('div', { class: 'zmsg-rr' }, h('small', {}, last?.time || ''), n ? h('em', {}, String(n)) : null)));
    }
    return wrap;
}

function threadView(map) {
    const t = map.get(norm(st.who)) || { name: st.who, msgs: [] };
    meta().seen[norm(t.name)] = t.msgs.filter((m) => !m.out).length;
    const wrap = h('div', { class: 'zmsg zmsg-thread' });
    wrap.append(h('div', { class: 'zmsg-head' },
        h('button', { type: 'button', class: 'zmsg-back', title: 'Back', onclick: () => { st.view = 'list'; save(); draw(); } }, h('i', { class: 'fa-solid fa-chevron-left' })),
        avatar(t.name), h('b', {}, t.name),
        h('button', { type: 'button', class: 'zmsg-auto' + (meta().auto ? ' zmsg-on' : ''), title: 'Ask for a reply right after sending', onclick: () => { meta().auto = !meta().auto; save(); draw(); } }, h('i', { class: 'fa-solid fa-bolt' }))));
    const list = h('div', { class: 'zmsg-list' });
    if (!t.msgs.length) list.append(h('div', { class: 'zmsg-hint' }, `Only you and ${t.name} will know what you text. Others notice reactions at most.`));
    for (const m of t.msgs) list.append(h('div', { class: 'zmsg-b ' + (m.out ? 'zmsg-out' : 'zmsg-inn') }, h('div', {}, m.text), h('small', {}, m.time)));
    wrap.append(list);
    const input = h('textarea', { class: 'zmsg-ta', rows: 1, placeholder: `Text ${t.name}...` });
    input.value = st.draft; input.addEventListener('input', () => { st.draft = input.value; });
    const send = () => {
        const text = input.value.trim();
        if (!text) return;
        meta().sent.push({ to: t.name, text, time: storyTime(), at: (ctx().chat || []).length });
        st.draft = ''; save(); applyPrompt(); draw(); root.querySelector('.zmsg-ta')?.focus();
        if (meta().auto && (ctx().groupId || norm(t.name) === norm(charName()))) replyNow();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    wrap.append(h('div', { class: 'zmsg-send' }, input, h('button', { type: 'button', class: 'zmsg-go', onclick: send, title: 'Send' }, h('i', { class: 'fa-solid fa-arrow-up' }))));
    queueMicrotask(() => { list.scrollTop = list.scrollHeight; });
    return wrap;
}

async function replyNow() {
    const c = ctx();
    if (c.characterId === undefined && !c.groupId) { globalThis.toastr?.info('Open a chat with a character first.'); return; }
    try { await c.executeSlashCommandsWithOptions('/trigger'); }
    catch (e) { console.warn('[Zenith Messages] could not start the reply', e); globalThis.toastr?.error('Could not start the reply. Send a message in the chat to continue.'); }
}

function openThread(name) { if (norm(name) !== norm(st.who)) st.draft = ''; st.view = 'thread'; st.who = name; st.picking = false; draw(); }
function draw() {
    if (!root) root = h('div', { class: 'zmsg-root' });
    const map = threads();
    root.replaceChildren(st.view === 'thread' && st.who ? threadView(map) : listView(map));
    refreshPhone();
}
function screen() {
    if (!root) root = h('div', { class: 'zmsg-root' });
    const map = threads();
    root.replaceChildren(st.view === 'thread' && st.who ? threadView(map) : listView(map));
    return root;
}

// ------------------------------------------------------------------ wiring
globalThis.ZenithMessages = { screen, live: anyUnread, open: openThread };
jQuery(() => {
    const { eventSource, eventTypes } = ctx();
    const sync = () => { st.view = 'list'; st.who = null; st.picking = false; applyPrompt(); refreshPhone(); };
    eventSource.on(eventTypes.CHAT_CHANGED, sync);
    for (const ev of [eventTypes.MESSAGE_RECEIVED, eventTypes.MESSAGE_SENT, eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_DELETED, eventTypes.MESSAGE_SWIPED, eventTypes.CHARACTER_MESSAGE_RENDERED]) {
        if (ev) eventSource.on(ev, () => setTimeout(refreshPhone, 50));
    }
    applyPrompt();
});
