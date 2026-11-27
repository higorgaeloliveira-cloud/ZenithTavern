/*
 * Kimi - ZenithTavern Assistant
 *
 * Kimi is intentionally a panel assistant rather than a normal roster character.
 * She can speak with character-like mannerisms, but her job is to help with
 * ZenithTavern itself.
 */

const MODULE = 'zenith_kimi';
const PROFILE_PATH = 'core/assistant/kimi.json';
const MAX_HISTORY = 16;

const ctx = () => SillyTavern.getContext();
const settings = () => {
    const { extensionSettings } = ctx();
    const cur = (extensionSettings[MODULE] ??= {});
    cur.history ??= [];
    cur.enabled ??= true;
    return cur;
};
const save = () => ctx().saveSettingsDebounced();

const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid?.nodeType ? kid : document.createTextNode(kid));
    return el;
};

const PROJECT_CONTEXT = [
    'You are Kimi, the ZenithTavern Assistant.',
    'You are a character-shaped technical assistant, not a roleplay character.',
    'Your primary job is to help the user understand, diagnose, maintain, configure, and improve ZenithTavern.',
    'You may use brief dialogue, actions, ear/tail reactions, humor, and personality to make replies natural.',
    'Never let character flavor override technical accuracy.',
    'Never claim an action was performed unless this assistant actually performed it through an available tool.',
    'If you do not have enough information to know something, say so and tell the user what would confirm it.',
    'Prefer concrete paths, filenames, settings, reproduction steps, and verification steps when discussing ZenithTavern.',
    'Be especially careful with destructive changes, data loss, credentials, and user settings.',
    'Current known project facts: ZenithTavern is a SillyTavern fork with custom Zenith extensions, a roster under core/roster/source, and versioning rules where configuration changes are +0.0.1, internal changes are +0.1.0, and big feature changes are +1.0.0, with each component carrying after 20.',
    'The assistant profile is stored at ' + PROFILE_PATH + '.'
].join('\n');

function liveContext() {
    try {
        const c = ctx();
        const name2 = c.name2 || c.characterName || 'unknown';
        const model = c.onlineStatus?.model || c.mainApi || 'unknown';
        const chat = Array.isArray(c.chat) ? c.chat.length : 0;
        const extensions = Array.isArray(c.extensionSettings) ? 'unknown' : Object.keys(c.extensionSettings || {}).length;
        return [
            '',
            '[Live ZenithTavern context]',
            'Current character: ' + name2,
            'Current model/API: ' + model,
            'Current chat messages: ' + chat,
            'Configured extension-setting modules: ' + extensions,
            'Use this only as context; do not treat unknown values as facts.'
        ].join('\n');
    } catch {
        return '';
    }
}

function historyText(history) {
    return history.map((m) => (m.role === 'user' ? 'USER' : 'KIMI') + ': ' + m.text).join('\n');
}

function renderMessage(m) {
    const wrap = h('article', { class: 'zk-message ' + (m.role === 'user' ? 'zk-user' : 'zk-kimi') });
    if (m.role === 'kimi') {
        wrap.append(h('div', { class: 'zk-speaker' }, h('span', { class: 'zk-ear' }, '◖'), ' Kimi'));
    } else {
        wrap.append(h('div', { class: 'zk-speaker' }, 'You'));
    }
    wrap.append(h('div', { class: 'zk-message-text' }, m.text));
    return wrap;
}

let root = null;
let messagesEl = null;
let inputEl = null;
let sendBtn = null;
let busy = false;

function scrollBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
    if (!messagesEl) return;
    const s = settings();
    messagesEl.replaceChildren(...s.history.map(renderMessage));
    scrollBottom();
}

async function askKimi(text) {
    if (!text.trim() || busy) return;
    const s = settings();
    s.history.push({ role: 'user', text: text.trim() });
    s.history = s.history.slice(-MAX_HISTORY);
    save();
    renderMessages();

    busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Thinking…';

    try {
        const prompt = PROJECT_CONTEXT + liveContext() + '\n\n[Conversation]\n' + historyText(s.history) +
            '\n\nRespond as Kimi. Answer the latest USER message. Do not output labels such as "KIMI:".';
        const result = await ctx().generateQuietPrompt({ quietPrompt: prompt });
        const answer = String(result || '').trim();
        if (!answer) throw new Error('The model returned an empty response.');
        s.history.push({ role: 'kimi', text: answer });
        s.history = s.history.slice(-MAX_HISTORY);
        save();
        renderMessages();
    } catch (err) {
        console.error('[Zenith Kimi] generation failed', err);
        toastr.error('Kimi could not get a response from the connected model.');
    } finally {
        busy = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        inputEl?.focus();
    }
}

function screen() {
    const s = settings();
    root = h('div', { class: 'zk-screen' },
        h('div', { class: 'zk-hero' },
            h('div', { class: 'zk-avatar', 'aria-hidden': 'true' }, 'K'),
            h('div', {},
                h('h3', {}, 'Kimi'),
                h('p', {}, 'ZenithTavern Assistant · Okamimimi')),
            h('div', { class: 'zk-status' }, s.enabled ? 'READY' : 'OFF'));
        messagesEl = h('div', { class: 'zk-messages', role: 'log', 'aria-live': 'polite' });
        const clear = h('button', { type: 'button', class: 'zk-clear', onclick: () => {
            s.history = [];
            save();
            renderMessages();
        }}, 'Clear');
        inputEl = h('textarea', { class: 'zk-input', rows: 2, placeholder: 'Ask Kimi about ZenithTavern…' });
        sendBtn = h('button', { type: 'button', class: 'zk-send', onclick: () => {
            const text = inputEl.value;
            inputEl.value = '';
            askKimi(text);
        }}, 'Send');
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = inputEl.value;
                inputEl.value = '';
                askKimi(text);
            }
        });
        root.append(
            h('div', { class: 'zk-toolbar' },
                h('span', {}, 'Project help, debugging, configuration, extensions, and maintenance.'),
                clear),
            messagesEl,
            h('div', { class: 'zk-compose' }, inputEl, sendBtn),
            h('p', { class: 'zk-note' }, 'Kimi uses the model currently connected to ZenithTavern. She can explain and diagnose; she does not pretend to have changed files or settings unless an actual tool does so.')
        );
    renderMessages();
    return root;
}

globalThis.ZenithKimi = {
    screen,
    live: () => busy,
    ask: askKimi,
};

jQuery(() => {
    settings();
});
