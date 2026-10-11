/*
 * ZenithTavern Panel - Modes (OOC), Course Correction, Narrators and Copycat.
 * Their screens are shown as apps inside the Zenith Phone (see globalThis.ZenithPanel below).
 * Original code. Everything here is plain text you can edit inside the panel itself.
 *
 * How it changes what the AI sees: the interceptor at the bottom runs before every generation
 * and registers (or clears) a few extra prompts with setExtensionPrompt.
 */

const MODULE = 'zenith_panel';
const KEYS = { narrator: 'zenith_narrator', summon: 'zenith_summon', ooc: 'zenith_ooc', cc: 'zenith_cc' };
const SYSTEM = 0, USER = 1;       // prompt roles
const IN_CHAT = 1;                // prompt position: inside the chat history

const uid = () => Math.random().toString(36).slice(2, 9);
const ctx = () => SillyTavern.getContext();

const DEFAULT_OOC = 'The roleplay is paused. Step out of the story and answer {{user}} directly, out of character, as {{narrator}}. ' +
    'Talk about the story, the characters, where things are heading, or what {{user}} wants changed. ' +
    'Do not continue the scene or write character dialogue unless asked. Be honest and conversational.';

function defaults() {
    return {
        oocOn: false,
        oocPrompt: DEFAULT_OOC,
        cc: {
            mode: 'off', dose: 3, remaining: 0, activeId: null,
            presets: [
                { id: uid(), name: 'Slow the pace', text: 'Slow down. Spend more time on the current moment instead of rushing to the next event.' },
                { id: uid(), name: 'More dialogue', text: 'Use more spoken dialogue and less narration. Let the characters talk to each other.' },
                { id: uid(), name: 'Fresh wording', text: 'You are repeating phrases and sentence shapes from earlier replies. Vary your vocabulary and structure.' },
                { id: uid(), name: 'Raise the stakes', text: 'Add tension. Something should be at risk, and the characters should feel it.' },
            ],
        },
        narrators: {
            active: null,
            list: [
                { id: uid(), name: 'Sol', tagline: 'The Steady Hand', instructions: 'Narrate in clear, grounded prose. Keep continuity tight, describe the physical scene precisely, and let emotions show through action rather than labels.' },
                { id: uid(), name: 'Vesper', tagline: 'The Slow Burn', instructions: 'Narrate with a patient, atmospheric voice. Favor subtext, small gestures, lingering silences and rising tension over quick resolutions.' },
                { id: uid(), name: 'Kestrel', tagline: 'The Wildcard', instructions: 'Narrate with energy and surprise. Complications arrive, side characters have their own plans, and the world pushes back in entertaining ways.' },
            ],
        },
        copycat: {
            wander: false,
            jar: [
                { id: uid(), name: 'More energy', text: 'Bring more energy and personality. Punchier lines, stronger reactions, more life.', auto: false },
            ],
        },
    };
}

function settings() {
    const { extensionSettings } = ctx();
    const base = defaults();
    const cur = (extensionSettings[MODULE] ??= {});
    for (const [k, v] of Object.entries(base)) cur[k] ??= v;
    return cur;
}
const save = () => ctx().saveSettingsDebounced();

// ---------------------------------------------------------------- prompt injection
const narratorOf = (id) => settings().narrators.list.find((n) => n.id === id);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Finds a "!name" call for one of the narrators in the newest user message. */
function findSummon(chat) {
    let idx = -1;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i].is_user) { idx = i; break; }
    if (idx < 0 || chat.length - 1 - idx > 1) return null;
    const text = String(chat[idx].mes || '').toLowerCase();
    return settings().narrators.list.find((n) => {
        const s = slug(n.name);
        return s && new RegExp(`(^|[^a-z0-9])!${s}(?![a-z0-9])`).test(text);
    }) || null;
}

let ccPending = false;

globalThis.zenithPanelInterceptor = async function (chat, contextSize, abort, type) {
    const { setExtensionPrompt } = ctx();
    const s = settings();
    const clear = () => Object.values(KEYS).forEach((k) => setExtensionPrompt(k, '', IN_CHAT, 0, false, SYSTEM));
    ccPending = false;
    if (type === 'quiet' || type === 'impersonate') return clear();
    clear();

    const active = narratorOf(s.narrators.active);
    if (active) {
        setExtensionPrompt(KEYS.narrator,
            `[Narrator: ${active.name}, "${active.tagline}". ${active.instructions}]`, IN_CHAT, 2, false, SYSTEM);
    }

    const summoned = findSummon(chat);
    if (summoned && !s.oocOn) {
        setExtensionPrompt(KEYS.summon,
            `[${summoned.name} ("${summoned.tagline}") was called by {{user}} and steps into the scene this turn as a presence inside the story, in their own voice. ${summoned.instructions}]`,
            IN_CHAT, 0, false, SYSTEM);
    }

    if (s.oocOn) {
        const who = active ? `${active.name} (${active.tagline})` : 'the narrator';
        setExtensionPrompt(KEYS.ooc, `[${s.oocPrompt.replaceAll('{{narrator}}', who)}]`, IN_CHAT, 0, false, SYSTEM);
        return; // no course correction while chatting out of character
    }

    const cc = s.cc;
    const preset = cc.presets.find((p) => p.id === cc.activeId);
    const live = preset && (cc.mode === 'until' || (cc.mode === 'dose' && cc.remaining > 0));
    if (live) {
        setExtensionPrompt(KEYS.cc, `[Feedback from {{user}} on your recent replies: ${preset.text}]`, IN_CHAT, 0, false, USER);
        ccPending = cc.mode === 'dose';
    }
};

function onReplyReceived() {
    const cc = settings().cc;
    if (!ccPending || cc.mode !== 'dose') return;
    ccPending = false;
    cc.remaining = Math.max(0, cc.remaining - 1);
    if (cc.remaining === 0) cc.mode = 'off';
    save();
    render();
}

// ---------------------------------------------------------------- copycat
let copyNote = '';
let busy = false;

async function rewriteLast(extraNips = []) {
    const c = ctx();
    const s = settings().copycat;
    const id = c.chat.length - 1;
    const msg = c.chat[id];
    if (!msg || msg.is_user || msg.is_system) { toastr.warning('The last message has to be from the AI.'); return; }
    if (busy) return;

    const parts = [...s.jar.filter((n) => n.auto).map((n) => n.text), ...extraNips.map((n) => n.text)];
    if (copyNote.trim()) parts.push(copyNote.trim());
    if (!parts.length) { toastr.info('Write a note or pick a saved one first.'); return; }

    busy = true; render();
    try {
        const quiet = 'Rewrite your last message in this chat, following this feedback:\n- ' + parts.join('\n- ') + '\n\n' +
            (s.wander
                ? 'You are allowed to make major changes if the feedback calls for it.'
                : 'Keep what happens, who says what, and the outcome the same. Change only what the feedback asks for.') +
            '\nReply with ONLY the rewritten message, no commentary.';
        const result = (await c.generateQuietPrompt({ quietPrompt: quiet }))?.trim();
        if (!result) { toastr.error('The model returned nothing. Try again.'); return; }
        msg.mes = result;
        if (Array.isArray(msg.swipes) && msg.swipe_id != null) msg.swipes[msg.swipe_id] = result;
        c.updateMessageBlock(id, msg);
        await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, id);
        await c.saveChat();
        toastr.success('Message rewritten.');
    } catch (err) {
        console.error('[Zenith] rewrite failed', err);
        toastr.error('Rewrite failed. Is a model connected?');
    } finally {
        busy = false; render();
    }
}

// ---------------------------------------------------------------- UI helpers
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
const toggle = (checked, onChange) => {
    const input = h('input', { type: 'checkbox', class: 'zp-toggle', ...(checked ? { checked: true } : {}) });
    input.addEventListener('change', () => onChange(input.checked));
    return input;
};
const field = (value, onSave, { multiline = false, placeholder = '', rows = 3 } = {}) => {
    const el = multiline ? h('textarea', { class: 'text_pole zp-field', rows, placeholder }) : h('input', { class: 'text_pole zp-field', type: 'text', placeholder });
    el.value = value ?? '';
    el.addEventListener('input', () => onSave(el.value));
    return el;
};
const btn = (label, onClick, cls = '') => h('button', { class: `menu_button zp-btn ${cls}`, type: 'button', onclick: onClick }, label);
const card = (...kids) => h('div', { class: 'zp-card' }, kids);
const note = (text) => h('p', { class: 'zp-note' }, text);

// ---------------------------------------------------------------- tabs
function tabModes() {
    const s = settings();
    return h('div', {},
        note('Modes change how the AI answers right now. They are saved with your settings.'),
        card(
            h('div', { class: 'zp-row' }, h('div', {}, h('b', {}, 'OOC Mode'), h('small', {}, 'Pause the roleplay and talk to your narrator about it.')),
                toggle(s.oocOn, (v) => { s.oocOn = v; save(); render(); })),
            s.oocOn ? note(`OOC is ON. The AI now answers out of character${narratorOf(s.narrators.active) ? ' as ' + narratorOf(s.narrators.active).name : ''}.`) : null,
            h('label', { class: 'zp-label' }, 'OOC instruction (use {{narrator}} for the narrator\'s name)'),
            field(s.oocPrompt, (v) => { s.oocPrompt = v; save(); }, { multiline: true, rows: 5 }),
            btn('Reset to default', () => { s.oocPrompt = DEFAULT_OOC; save(); render(); }),
        ),
        note('Shortcuts: /zenith-ooc on|off|toggle'),
    );
}

function tabCourse() {
    const cc = settings().cc;
    const modeBtn = (mode, label) => btn(label, () => {
        cc.mode = mode;
        if (mode === 'dose') cc.remaining = Number(cc.dose) || 1;
        save(); render();
    }, cc.mode === mode ? 'zp-on' : '');
    return h('div', {},
        note('Course Correction slips a note from you into the AI\'s prompt, as if you had given feedback. Pick one, then choose how long it lasts.'),
        card(
            h('div', { class: 'zp-seg' }, modeBtn('off', 'Off'), modeBtn('until', 'Until changed'), modeBtn('dose', 'Dose')),
            cc.mode === 'dose' ? h('div', { class: 'zp-row' },
                h('span', {}, 'Replies to apply it to'),
                (() => { const i = field(cc.dose, (v) => { cc.dose = Math.max(1, Number(v) || 1); }); i.type = 'number'; i.min = 1; i.style.width = '80px'; return i; })(),
                h('span', { class: 'zp-count' }, `${cc.remaining} left`),
                btn('Refill', () => { cc.remaining = cc.dose; cc.mode = 'dose'; save(); render(); })) : null,
        ),
        ...cc.presets.map((p) => card(
            h('div', { class: 'zp-row' },
                field(p.name, (v) => { p.name = v; save(); }, { placeholder: 'Name' }),
                btn(cc.activeId === p.id ? 'Selected' : 'Select', () => { cc.activeId = p.id; if (cc.mode === 'off') cc.mode = 'until'; save(); render(); }, cc.activeId === p.id ? 'zp-on' : '')),
            field(p.text, (v) => { p.text = v; save(); }, { multiline: true }),
            btn('Delete', () => { cc.presets = cc.presets.filter((x) => x.id !== p.id); if (cc.activeId === p.id) { cc.activeId = null; cc.mode = 'off'; } save(); render(); }, 'zp-danger'),
        )),
        btn('+ New preset', () => { cc.presets.push({ id: uid(), name: 'New preset', text: '' }); save(); render(); }, 'zp-wide'),
    );
}

function tabNarrators() {
    const n = settings().narrators;
    return h('div', {},
        note('The active narrator\'s style is added to every prompt. Type !Name in your message (for example !Sol) to bring any narrator into the scene for one reply.'),
        card(
            h('div', { class: 'zp-row' }, h('div', {}, h('b', {}, 'No narrator'), h('small', {}, 'Use the character card as is.')),
                btn(n.active == null ? 'Selected' : 'Select', () => { n.active = null; save(); render(); }, n.active == null ? 'zp-on' : '')),
        ),
        ...n.list.map((x) => card(
            h('div', { class: 'zp-row' },
                field(x.name, (v) => { x.name = v; save(); }, { placeholder: 'Name' }),
                btn(n.active === x.id ? 'Active' : 'Activate', () => { n.active = x.id; save(); render(); }, n.active === x.id ? 'zp-on' : '')),
            field(x.tagline, (v) => { x.tagline = v; save(); }, { placeholder: 'Tagline' }),
            field(x.instructions, (v) => { x.instructions = v; save(); }, { multiline: true, rows: 4, placeholder: 'How does this narrator write?' }),
            h('div', { class: 'zp-row' }, h('small', {}, `Summon with !${slug(x.name) || '…'}`),
                btn('Delete', () => { n.list = n.list.filter((y) => y.id !== x.id); if (n.active === x.id) n.active = null; save(); render(); }, 'zp-danger')),
        )),
        btn('+ New narrator', () => { n.list.push({ id: uid(), name: 'New', tagline: '', instructions: '' }); save(); render(); }, 'zp-wide'),
    );
}

function tabCopycat() {
    const cat = settings().copycat;
    return h('div', {},
        note('Copycat asks the AI to rewrite its last message using your feedback. It uses the model you are connected to.'),
        card(
            h('b', {}, 'Catnip note'),
            (() => { const t = field(copyNote, (v) => { copyNote = v; }, { multiline: true, placeholder: 'Can you make the scene less rushed?' }); return t; })(),
            h('div', { class: 'zp-row' }, h('div', {}, h('b', {}, 'Let it wander'), h('small', {}, 'Tell the AI it\'s allowed to make major changes')),
                toggle(cat.wander, (v) => { cat.wander = v; save(); })),
            btn(busy ? 'Rewriting…' : 'Rewrite message', () => rewriteLast(), 'zp-wide zp-on'),
        ),
        h('h4', { class: 'zp-h' }, `Catnip Jar (${cat.jar.length})`),
        note('Saved notes. "Automatically apply" adds a note to every rewrite.'),
        ...cat.jar.map((x) => card(
            field(x.name, (v) => { x.name = v; save(); }, { placeholder: 'Name' }),
            field(x.text, (v) => { x.text = v; save(); }, { multiline: true }),
            h('div', { class: 'zp-row' }, h('span', {}, 'Automatically apply'), toggle(x.auto, (v) => { x.auto = v; save(); })),
            h('div', { class: 'zp-row' },
                btn('Use once', () => rewriteLast([x])),
                btn('Delete', () => { cat.jar = cat.jar.filter((y) => y.id !== x.id); save(); render(); }, 'zp-danger')),
        )),
        btn('+ New nip', () => { cat.jar.push({ id: uid(), name: 'New nip', text: '', auto: false }); save(); render(); }, 'zp-wide'),
    );
}

const TABS = [['modes', 'Modes', tabModes], ['course', 'Course Correction', tabCourse], ['narrators', 'Narrators', tabNarrators], ['copycat', 'Copycat', tabCopycat]];
let currentTab = 'modes';
let panelOpen = false;
let root = null;

function render() {
    document.dispatchEvent(new Event('zenith-panel-render')); // the Zenith Phone apps redraw themselves on this
    if (!root) return;
    const body = root.querySelector('.zp-body');
    const scroll = body.scrollTop;
    const focused = document.activeElement;
    if (focused && root.contains(focused) && /^(INPUT|TEXTAREA)$/.test(focused.tagName) && focused.type !== 'checkbox') return; // never redraw under someone's cursor
    const tabs = root.querySelector('.zp-tabs');
    tabs.replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', class: 'zp-tab' + (id === currentTab ? ' zp-on' : ''), onclick: () => { currentTab = id; render(); } }, label)));
    body.replaceChildren(TABS.find((t) => t[0] === currentTab)[2]());
    body.scrollTop = scroll;
}

function isLive() {
    const s = settings();
    return s.oocOn || s.narrators.active != null || s.cc.mode !== 'off';
}

// What the Zenith Phone apps use: the screens above, plus a "this one is switched on" check for the icon dots.
globalThis.ZenithPanel = {
    screens: { ooc: tabModes, course: tabCourse, narrators: tabNarrators, copycat: tabCopycat },
    live: {
        ooc: () => settings().oocOn,
        course: () => settings().cc.mode !== 'off',
        narrators: () => settings().narrators.active != null,
        copycat: () => false,
    },
};

function mountPanel() {
    root = h('aside', { id: 'zenith_panel', class: 'zp-panel', 'data-keep-brand': '' },
        h('header', { class: 'zp-head' }, h('b', {}, '✦ Zenith Panel'), h('button', { type: 'button', class: 'zp-x', title: 'Close', onclick: () => setOpen(false) }, '✕')),
        h('nav', { class: 'zp-tabs' }),
        h('div', { class: 'zp-body' }));
    document.body.append(root);
    // The ✦ button and wand-menu entry were replaced by the Zenith Phone apps. /zenith-panel still opens this side panel.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen && !document.querySelector('dialog[open]')) setOpen(false); });
}

function setOpen(v) {
    panelOpen = v;
    root.classList.toggle('zp-open', v);
    if (v) { const f = document.activeElement; if (f && root.contains(f)) f.blur(); render(); }
}

// ---------------------------------------------------------------- slash commands
function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
    const argument = (description) => SlashCommandArgument.fromProps({ description, typeList: [ARGUMENT_TYPE.STRING], isRequired: false });
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-ooc',
        helpString: 'Turns OOC Mode on, off or toggles it: /zenith-ooc on|off|toggle',
        unnamedArgumentList: [argument('on, off or toggle')],
        callback: async (_args, value) => {
            const s = settings();
            const v = String(value || 'toggle').trim().toLowerCase();
            s.oocOn = v === 'on' ? true : v === 'off' ? false : !s.oocOn;
            save(); render();
            return s.oocOn ? 'OOC Mode on' : 'OOC Mode off';
        },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-panel',
        helpString: 'Opens or closes the old side panel (the same settings now live in the Zenith Phone apps).',
        callback: async () => { setOpen(!panelOpen); return ''; },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-narrator',
        helpString: 'Sets the active narrator by name, or "none": /zenith-narrator Sol',
        unnamedArgumentList: [argument('narrator name or none')],
        callback: async (_args, value) => {
            const s = settings().narrators;
            const name = String(value || '').trim().toLowerCase();
            if (!name || name === 'none') { s.active = null; save(); render(); return 'No narrator'; }
            const found = s.list.find((n) => slug(n.name) === slug(name));
            if (!found) return `No narrator named "${value}"`;
            s.active = found.id; save(); render();
            return `Narrator: ${found.name}`;
        },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-rewrite',
        helpString: 'Rewrites the last AI message using your note: /zenith-rewrite make it less rushed',
        unnamedArgumentList: [argument('feedback')],
        callback: async (_args, value) => { copyNote = String(value || ''); await rewriteLast(); return ''; },
    }));
}

jQuery(() => {
    settings();
    registerCommands();
    mountPanel();
    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.MESSAGE_RECEIVED, onReplyReceived);
    render();
});
