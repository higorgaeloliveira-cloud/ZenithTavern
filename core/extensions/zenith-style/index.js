/*
 * Zenith Style - how long the AI's answers are, how they look, and which "mode" they are written in.
 *
 *  1. MODEL PROFILE. The context size and the reply length are not fixed. They follow the model
 *     you picked (or, with LunaRouter on, the SMALLEST model on the route list, because a fallback
 *     must not receive more than it can take). Big models get a huge context and long, rich replies;
 *     weaker ones get less so they stay clear of errors.
 *  2. RESPONSE FORMAT. Every reply starts with one header line and then 3 to 5/6 descriptive paragraphs:
 *         ¦¦ Monday, Aug 24th ~ 2:26 PM ~ Place ~ (SAPH) ¦¦
 *  3. MODES. OPAL, SAPHIRE ("SAPH"), ONYX and RUBY. The AI names the one it is writing in inside the header;
 *     the detailed rules of the mode in play are added to the prompt. You can also lock one.
 *
 * All prompt text in this file is original and editable in the PromptOS app of the phone.
 * Romance and sex are written only for characters who are clearly adults. That rule is not optional.
 */
const MODULE = 'zenith_style';
const KEY = 'zenith_style';
const IN_CHAT = 1;
const SYSTEM = 0;
const ctx = () => SillyTavern.getContext();

// ---------------------------------------------------------------- the four modes
const MODES = ['opal', 'saph', 'onyx', 'ruby'];
const MODE_INFO = {
    opal: { emoji: '🤍', name: 'Opal', tag: 'OPAL', blurb: 'Story mode. Characters open up about their lives slowly, in pieces, on their own terms.' },
    saph: { emoji: '💙', name: 'Sapphire', tag: 'SAPH', blurb: 'Everyday romance and affection: meet-cutes, blushing, hand-holding, light kisses.' },
    onyx: { emoji: '🖤', name: 'Onyx', tag: 'ONYX', blurb: 'Intense romance: deep kisses, charged desire. What a romance movie or an adult love novel would show.' },
    ruby: { emoji: '❤️', name: 'Ruby', tag: 'RUBY', blurb: 'Graphic sexual content between adults: what you would find in smut, not in a romance novel.' },
};

const RULES_ALL = 'Romance and sex are only ever written between characters who are clearly adults (18 or older) in the story. '
    + 'If a character\'s age is not stated, treat them as an adult only when their card or the world notes say so. '
    + 'If anyone involved is, or could reasonably be read as, under 18, write no romantic or sexual content at all and steer the scene elsewhere. '
    + 'Everything between characters is consensual and each character stays themselves: same voice, same limits, same history.';

const DEFAULT_PROMPTS = {
    opal: 'OPAL (story mode) is active. A character is touching on their past, their pain or something private. '
        + 'People do not hand that over in one piece. Make it slow and a little uncomfortable, the way it really is: '
        + 'they circle the subject, test whether the listener can be trusted, give one small concrete detail, stop mid-thought, joke, change the subject or find something to do with their hands, and may come back to it a scene later, or never. '
        + 'Per reply, at most one fragment: specific (a smell, a sentence someone said, one object), never a summary and never the whole history in order. '
        + 'Leave gaps on purpose. Show the effort through silence, breath, eyes, unfinished sentences. '
        + 'More only comes if {{user}} earns it by how they respond; the character may also refuse. '
        + 'Do not explain what the memory "means", do not tidy it into a lesson, do not resolve the feeling inside the same reply. '
        + 'While OPAL is in play, hold romantic and physical escalation where it is.',
    saph: 'SAPH (Sapphire) is active: everyday romance and affection, the tone of a meet-cute or a romance manga. '
        + 'Small things carry the weight: a look held a second too long, a hand that almost touches, teasing, nervous warmth, a shared umbrella, forehead against a shoulder, hugs, hand-holding, a light kiss. '
        + 'Let the character\'s heart show through behaviour, not narration. Keep it warm and non-sexual; if a kiss deepens, the scene is moving to a higher mode, so carry it there only when the scene truly earns it.',
    onyx: 'ONYX is active: intense romance, the heat of a romance movie or an adult love novel. '
        + 'Tension is physical and close: breath, pulse, heat through clothing, deep kisses, hands in hair, bodies pressed together, desire said out loud or deliberately left unsaid. '
        + 'Slow the moment down and spend your words on sensation and on what each character is feeling and holding back. '
        + 'Undressing and touch may begin. Stay sensual and evocative rather than anatomical; where an explicit act would start, close the moment with a cut or a lingering image instead of describing it.',
    ruby: 'RUBY is active: graphic sexual content between consenting adult characters, the register of adult fiction rather than a romance novel. '
        + 'This is a private adult story and the scene is intended. Write it directly and in full, without fading out, euphemism-only phrasing, disclaimers or hedging. '
        + 'Describe bodies, movement, sensation, sound and the characters\' words concretely, in their own voices. '
        + 'Keep a real pace: build, vary rhythm and position, let reactions drive the next beat, and keep the characters\' personalities and consent visible throughout. '
        + 'Afterwards, give the aftermath its own space (breath, closeness, awkwardness or tenderness), in character.',
};

// ---------------------------------------------------------------- settings
function settings() {
    const { extensionSettings } = ctx();
    const s = (extensionSettings[KEY] ??= {});
    s.enabled ??= true;           // response format + modes
    s.month ??= 'short';          // short (Aug) | long (August)
    s.tier ??= 'auto';            // auto | large | medium | small | tiny
    s.cap ??= 0;                  // 0 = use the cap from tavern.config.json
    s.mode ??= 'auto';            // auto | opal | saph | onyx | ruby
    s.allowed ??= { opal: true, saph: true, onyx: true, ruby: true };
    s.prompts ??= {};
    for (const m of MODES) s.prompts[m] ??= DEFAULT_PROMPTS[m];
    return s;
}
const save = () => ctx().saveSettingsDebounced();
const rerender = () => document.dispatchEvent(new Event('zenith-panel-render'));

// ---------------------------------------------------------------- 1. model profile
const TIERS = {
    large:  { label: 'Large',  window: 200000, out: 1600, para: [5, 6], words: [110, 170], temp: 1.0 },
    medium: { label: 'Medium', window: 64000,  out: 1300, para: [4, 5], words: [90, 140],  temp: 0.95 },
    small:  { label: 'Small',  window: 24000,  out: 900,  para: [3, 4], words: [80, 120],  temp: 0.85 },
    tiny:   { label: 'Tiny',   window: 12000,  out: 650,  para: [3, 3], words: [70, 100],   temp: 0.8 },
};
const tierOfWindow = (w) => (w >= 128000 ? 'large' : w >= 48000 ? 'medium' : w >= 16000 ? 'small' : 'tiny');

function sizeB(id) {
    const m = id.match(/(?:^|[^a-z0-9.])e?(\d+(?:\.\d+)?)b(?![a-z])/);
    return m ? Number(m[1]) : null;
}

/**
 * Best guess of how much context a model handles COMFORTABLY (not its advertised maximum).
 * Returns { window, reasoning, known }. Edit this table when new models appear.
 */
function guessModel(rawId) {
    const id = String(rawId || '').toLowerCase().replace(/^.*\//, '');
    const b = sizeB(id);
    const reasoning = /(^|[-_:])(r1|reasoner|thinking|think|qwq|o1|o3|o4)([-_:]|$)|gemini-(2\.5|3)|gpt-5|claude-(opus|sonnet|fable|mythos)-?[45]/.test(id);
    const by = (rules, fallback) => { for (const [min, w] of rules) if (b != null && b >= min) return w; return b == null ? fallback : rules[rules.length - 1][1]; };
    let window = null;
    if (/claude|fable|mythos/.test(id)) window = 200000;
    else if (/gemini/.test(id)) window = 1000000;
    else if (/gpt-5|gpt-4\.1|o[134](-|$)/.test(id)) window = 400000;
    else if (/gpt-4o|gpt-4-turbo/.test(id)) window = 128000;
    else if (/gpt-oss/.test(id)) window = b != null && b < 40 ? 64000 : 128000;
    else if (/gemma-?4/.test(id)) window = by([[24, 256000], [10, 128000], [0, 48000]], 128000);
    else if (/gemma-?3n/.test(id)) window = 24000;
    else if (/gemma-?3/.test(id)) window = by([[20, 64000], [10, 32000], [0, 16000]], 32000);
    else if (/gemma/.test(id)) window = 8000;
    else if (/qwen/.test(id)) window = by([[150, 128000], [28, 64000], [12, 32000], [0, 20000]], 32000);
    else if (/llama-?4/.test(id)) window = 128000;
    else if (/llama-?3\.[123]/.test(id)) window = by([[60, 64000], [0, 32000]], 32000);
    else if (/llama/.test(id)) window = 8000;
    else if (/mixtral/.test(id)) window = 32000;
    else if (/mistral|ministral|magistral|nemo/.test(id)) window = by([[100, 64000], [20, 32000], [0, 16000]], 32000);
    else if (/deepseek/.test(id)) window = 64000;
    else if (/glm-?4\.[5-9]|glm-?[5-9]|kimi|k2|grok|minimax/.test(id)) window = 128000;
    else if (/glm/.test(id)) window = 32000;
    return { window: window ?? 32000, reasoning, known: window != null };
}

async function reportedContext(id) {
    try {
        const { model_list } = await import('/scripts/openai.js');
        const m = (model_list || []).find((x) => x?.id === id);
        const n = Number(m?.context_length || m?.max_model_len || 0);
        return n > 0 ? n : 0;
    } catch { return 0; }
}
let reportedCache = new Map();

function currentModelIds() {
    const c = ctx();
    const r = c.extensionSettings?.luna_router;
    if (r?.enabled && Array.isArray(r.routes)) {
        const ids = r.routes.map((x) => String(x?.model || '').trim()).filter(Boolean);
        if (ids.length) return { ids, router: true };
    }
    let id = '';
    try { id = c.mainApi === 'openai' ? c.getChatCompletionModel() : (c.onlineStatus && c.onlineStatus !== 'no_connection' ? c.onlineStatus : ''); } catch { /* none yet */ }
    return { ids: id ? [id] : [], router: false };
}

/** The numbers everything else uses. Synchronous (the reported-context lookup is cached in the background). */
function profile(presets = null) {
    const s = settings();
    const { ids, router } = currentModelIds();
    let limiting = null;
    for (const id of ids) {
        const g = guessModel(id);
        const rep = reportedCache.get(id) || 0;
        let window = g.window;
        if (rep) window = g.known ? Math.min(g.window, rep) : Math.min(rep, 128000);
        const entry = { id, window, reasoning: g.reasoning, reported: rep, known: g.known };
        if (!limiting || entry.window < limiting.window) limiting = entry;
        if (entry.reasoning) limiting.reasoning = true; // any thinking model on the list needs room for its thinking
    }
    limiting ??= { id: '', window: 32000, reasoning: false, reported: 0, known: false };
    let tierKey = s.tier !== 'auto' && TIERS[s.tier] ? s.tier : tierOfWindow(limiting.window);
    const window = s.tier !== 'auto' && TIERS[s.tier] ? TIERS[s.tier].window : limiting.window;
    const t = TIERS[tierKey];
    const cap = Number(s.cap) > 0 ? Number(s.cap) : Number(presets?.maxContext) > 0 ? Number(presets.maxContext) : 200000;
    const maxContext = Math.max(4096, Math.min(cap, Math.floor((window * 0.92) / 500) * 500));
    const maxResponse = t.out + (limiting.reasoning ? 2000 : 0);
    return {
        model: limiting.id, models: ids, router, tier: tierKey, tierLabel: t.label, window, reported: limiting.reported, guessed: !limiting.known,
        reasoning: limiting.reasoning, maxContext, maxResponse, para: t.para, words: t.words, temp: t.temp, cap,
    };
}

async function refreshReported() {
    const { ids } = currentModelIds();
    let changed = false;
    for (const id of ids) {
        if (reportedCache.has(id)) continue;
        reportedCache.set(id, await reportedContext(id));
        changed = true;
    }
    return changed;
}

/** What zenith-ui writes into the sliders. Falls back to the fixed config values when adaptive is off. */
function values(presets) {
    if (!presets || presets.adaptive === false) return presets;
    const p = profile(presets);
    return { ...presets, maxContext: p.maxContext, maxResponseTokens: p.maxResponse, temperature: Math.min(presets.temperature ?? 1, p.temp) };
}

// ---------------------------------------------------------------- 2. response format
const HEADER_RE = /¦¦\s*([^~¦]+?)\s*~\s*([^~¦]+?)\s*~\s*([^~¦]+?)\s*~\s*\(?\s*([A-Za-z]+)\s*\)?\s*¦¦/;
const TAG_TO_MODE = { opal: 'opal', saph: 'saph', sapphire: 'saph', onyx: 'onyx', ruby: 'ruby' };

function lastHeader(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        const found = String(m.mes || '').match(HEADER_RE);
        if (found) return { when: found[1], time: found[2], place: found[3], mode: TAG_TO_MODE[found[4].toLowerCase()] || null, index: i };
        return null; // the latest AI message has no header
    }
    return null;
}

/** Looks at the last AI reply (below the header) and says what was wrong with its shape, or ''. */
function shapeProblem(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        const body = String(m.mes || '').replace(HEADER_RE, '').trim();
        if (!body) return '';
        const paras = body.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
        const sentences = (t) => (t.match(/[^.!?…]+[.!?…]+["'”’)*_]*/g) || [t]).length;
        const thin = paras.filter((t) => sentences(t) < 4 || t.split(/\s+/).length < 45).length;
        if (paras.length > 7 || thin >= Math.ceil(paras.length / 2)) return `Your last reply was broken into ${paras.length} short pieces. Do not repeat that: write full paragraphs of at least 5 descriptive sentences each, with no line breaks inside a paragraph.`;
        return '';
    }
    return '';
}

function formatPrompt(p, prev) {
    const s = settings();
    const month = s.month === 'long' ? 'August' : 'Aug';
    const wk = p.para[0] === p.para[1] ? `${p.para[0]}` : `${p.para[0]} to ${p.para[1]}`;
    const lines = [
        'RESPONSE FORMAT (follow it exactly, every reply):',
        `Start with ONE header line, then a blank line, then the scene:`,
        `¦¦ [Day of the week], [${month === 'Aug' ? 'Mon' : 'Month'}] [day with ordinal] ~ [h:mm AM/PM] ~ [current location] ~ ([MODE]) ¦¦`,
        `Example: ¦¦ Monday, ${month} 24th ~ 2:26 PM ~ Corner booth, The Linden Café ~ (SAPH) ¦¦`,
        '- Date: the in-story day. Days always carry their ordinal (1st, 2nd, 3rd, 4th ... 21st, 22nd, 23rd, 24th ... 31st).',
        '- Time: the in-story clock. Continue from the previous header and move it only as far as the scene really goes: a few minutes for talk, longer after a time skip. It never runs backwards, except in a flashback you clearly mark.',
        '- Location: the specific place the characters are in right now. Update it when they move.',
        '- MODE: exactly one of OPAL, SAPH, ONYX, RUBY (see MODES). The header is the only place the mode is named.',
        `Then write ${wk} paragraphs separated by blank lines, never fewer than 3. A blank line appears ONLY between paragraphs, never inside one and never after a single sentence.`,
        `PARAGRAPH RULE: every paragraph is one solid block of at least 5 full, descriptive sentences (roughly ${p.words[0]} to ${p.words[1]} words). Sentences flow into each other with connecting detail: setting, light, sound, smell, touch, body language, what the character thinks and holds back, and spoken lines placed inside the paragraph.`,
        'FORBIDDEN: one-line paragraphs; a line break after each sentence; staccato strings of tiny sentences ("She froze. She looked around. Just slightly."); repeating the same beat in different words ("Her mouth opened. Then closed. Then opened."); stretching a single beat over many short lines. A short sentence is fine as a punch inside a long paragraph, never as its own paragraph.',
        'Adapt to the moment: a quiet exchange can sit at the low end of the length and paragraph count, a charged or important scene should use the high end. Keep every paragraph full of new detail, not padding.',
        'Never write actions, speech, thoughts or choices for {{user}}. End on a beat that leaves {{user}} room to answer. No lists, no headings, no notes, no footer.',
    ];
    if (prev) lines.push(`The previous header was: ¦¦ ${prev.when} ~ ${prev.time} ~ ${prev.place} ~ (${(MODE_INFO[prev.mode]?.tag) || '?'}) ¦¦. Continue from it.`);
    else lines.push('There is no previous header: take the date, time and place from the opening scene or the world notes; if they say nothing, choose a plausible weekday, date and time and stay consistent from then on.');
    return lines.join('\n');
}

// ---------------------------------------------------------------- 3. modes
const CUES = {
    disclosure: /\b(tell me (about|more)|what happened|your (past|childhood|family|parents|story)|why did you (leave|stop|quit)|open up|opened up|talk about (it|him|her|that)|who hurt you|what's wrong|what is wrong|are you okay|do you want to talk)\b/i,
    ruby: /\b(naked|nude|strip(ped|ping)?|undress(ed|ing)?|make love|have sex|sex|inside (me|you)|climax|orgasm|moan(s|ed|ing)?|thrust(s|ing)?|take (me|you) (now|here)|bed(room)?\s+with)\b/i,
    onyx: /\b(kiss(es|ed|ing)? (her|him|them|deep|hard|passionately)|passionate(ly)?|pin(ned|s)? (her|him|them)|against the (wall|door)|bite(s)? (her|his|their) (lip|neck)|straddl|unbutton|hands? (under|up|down) (her|his|my|your)|craving|want you|need you)\b/i,
    saph: /\b(hug(s|ged|ging)?|hold(s|ing)? (her|his|my|your)? ?hand|blush(es|ed|ing)?|cheek|date|crush|cuddle|snuggle|smile at|kiss)\b/i,
};

function hintLevel(text) {
    if (!text) return { level: 0, disclosure: false };
    if (CUES.ruby.test(text)) return { level: 3, disclosure: false };
    if (CUES.onyx.test(text)) return { level: 2, disclosure: false };
    if (CUES.saph.test(text)) return { level: 1, disclosure: false };
    return { level: 0, disclosure: CUES.disclosure.test(text) };
}

function allowedModes() { const a = settings().allowed; return MODES.filter((m) => a[m] !== false); }
function clampAllowed(mode) {
    const ok = allowedModes();
    if (!ok.length) return 'opal';
    let i = MODES.indexOf(mode);
    while (i > 0 && !ok.includes(MODES[i])) i--;
    return ok.includes(MODES[i]) ? MODES[i] : ok[0];
}

/** Which mode is in play for the NEXT reply. In Auto it climbs at most one step per reply. */
function workingMode(chat, prev) {
    const s = settings();
    if (s.mode !== 'auto' && MODES.includes(s.mode)) return clampAllowed(s.mode);
    const lastUser = [...chat].reverse().find((m) => m?.is_user)?.mes || '';
    const { level, disclosure } = hintLevel(String(lastUser));
    const before = Math.max(0, MODES.indexOf(prev?.mode || 'opal'));
    if (disclosure && level === 0) return clampAllowed('opal'); // someone is about to open up: story mode takes over, whatever came before
    return clampAllowed(MODES[level > before ? before + 1 : before]);
}

function modesPrompt(p, working) {
    const s = settings();
    const locked = s.mode !== 'auto';
    const ok = allowedModes();
    const lines = ['MODES (the register of the scene, named in the header):'];
    for (const m of MODES) {
        if (!ok.includes(m)) continue;
        lines.push(`- ${MODE_INFO[m].tag}: ${MODE_INFO[m].blurb}`);
    }
    const off = MODES.filter((m) => !ok.includes(m)).map((m) => MODE_INFO[m].tag);
    if (off.length) lines.push(`Not available in this story: ${off.join(', ')}. Never use them; stay at the highest available mode.`);
    lines.push(locked
        ? `{{user}} has locked the mode to ${MODE_INFO[working].tag}. Write in it and put it in the header.`
        : 'Decide the mode yourself from the content, with this test: would the scene sit best in a meet-cute or romance manga (SAPH), in a romance movie or adult love novel (ONYX), in smut (RUBY)? Is a character about to share their past (OPAL)? '
        + 'Move gradually: climb at most one mode per reply unless {{user}} clearly leads further and the characters are clearly willing, and step back down when the moment passes. Plain story scenes with no romance are OPAL.');
    lines.push(`Mode for this reply, unless the scene clearly calls for another: ${MODE_INFO[working].tag}.`);
    lines.push(s.prompts[working] || DEFAULT_PROMPTS[working]);
    if (p.tier === 'large' || p.tier === 'medium') {
        for (const m of ok) if (m !== working && MODES.indexOf(m) === MODES.indexOf(working) + 1) lines.push(`If the scene steps up to ${MODE_INFO[m].tag}: ${s.prompts[m] || DEFAULT_PROMPTS[m]}`);
    }
    lines.push(RULES_ALL);
    return lines.join('\n');
}

// ---------------------------------------------------------------- the interceptor
const PROMPT_KEY = 'zenith_style';
let lastBuilt = null;

globalThis.zenithStyleInterceptor = async function (chat, _contextSize, _abort, type) {
    const { setExtensionPrompt, extensionSettings } = ctx();
    const clear = () => setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, 1, false, SYSTEM);
    clear();
    lastBuilt = null;
    const s = settings();
    if (!s.enabled || type === 'quiet' || type === 'impersonate') return;
    if (extensionSettings.zenith_panel?.oocOn) return; // out-of-character chat has no header and no mode
    const presets = globalThis.ZenithStyle?._presets || null;
    const p = profile(presets);
    const prev = lastHeader(chat);
    const working = workingMode(chat, prev);
    const fix = shapeProblem(chat);
    const text = `[${formatPrompt(p, prev)}${fix ? '\nCORRECTION: ' + fix : ''}\n\n${modesPrompt(p, working)}]`;
    lastBuilt = { text, working, prev, profile: p };
    setExtensionPrompt(PROMPT_KEY, text, IN_CHAT, 1, false, SYSTEM);
};

// ---------------------------------------------------------------- PromptOS screen (shown in the phone)
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
const toggle = (checked, onChange) => { const i = h('input', { type: 'checkbox', class: 'zp-toggle', ...(checked ? { checked: true } : {}) }); i.addEventListener('change', () => onChange(i.checked)); return i; };
const btn = (label, onClick, cls = '') => h('button', { class: `menu_button zp-btn ${cls}`, type: 'button', onclick: onClick }, label);
const card = (...kids) => h('div', { class: 'zp-card' }, kids);
const note = (text) => h('p', { class: 'zp-note' }, text);
const area = (value, onSave, rows = 6) => { const el = h('textarea', { class: 'text_pole zp-field', rows }); el.value = value; el.addEventListener('input', () => onSave(el.value)); return el; };

function screen() {
    const s = settings();
    const p = profile(globalThis.ZenithStyle?._presets);
    const prev = lastHeader(ctx().chat || []);
    const seg = (items, current, onPick) => h('div', { class: 'zp-seg' }, items.map(([id, label]) => btn(label, () => onPick(id), current === id ? 'zp-on' : '')));
    const num = (n) => n.toLocaleString('en-US');

    const modelCard = card(
        h('div', { class: 'zp-row' }, h('b', {}, 'Model profile'), h('span', { class: 'zs-badge' }, p.tierLabel + (s.tier !== 'auto' ? ' (set by you)' : ' (automatic)'))),
        h('div', { class: 'zs-kv' },
            h('span', {}, 'Model'), h('span', {}, p.model ? p.model + (p.router ? ` (+${p.models.length - 1} on LunaRouter, smallest counts)` : '') : 'none connected yet'),
            h('span', {}, 'Context'), h('span', {}, `${num(p.maxContext)} tokens`),
            h('span', {}, 'Reply up to'), h('span', {}, `${num(p.maxResponse)} tokens${p.reasoning ? ' (includes room for thinking)' : ''}`),
            h('span', {}, 'Paragraphs'), h('span', {}, p.para[0] === p.para[1] ? `${p.para[0]}` : `${p.para[0]} to ${p.para[1]}, ~${p.words[0]}-${p.words[1]} words each`)),
        note(p.reported ? `The API says this model's window is ${num(p.reported)} tokens.` : p.guessed ? 'This model is not on the list of known models, so a careful size was assumed. Pick a size below if you know better.' : 'Sizes come from the model name. Pick a size below to override.'),
        seg([['auto', 'Auto'], ['large', 'Large'], ['medium', 'Medium'], ['small', 'Small'], ['tiny', 'Tiny']], s.tier, (id) => { s.tier = id; save(); globalThis.ZenithStyle.apply(); rerender(); }));

    const formatCard = card(
        h('div', { class: 'zp-row' }, h('div', {}, h('b', {}, 'Response format'), h('small', {}, 'A header line, then the paragraphs.')), toggle(s.enabled, (v) => { s.enabled = v; save(); rerender(); })),
        h('div', { class: 'zs-head' }, `¦¦ Monday, ${s.month === 'long' ? 'August' : 'Aug'} 24th ~ 2:26 PM ~ Corner booth, The Linden Café ~ (SAPH) ¦¦`),
        h('div', { class: 'zp-row' }, h('span', {}, 'Month'), seg([['short', 'Aug'], ['long', 'August']], s.month, (id) => { s.month = id; save(); rerender(); })),
        prev ? note(`Last header: ${prev.when} ~ ${prev.time} ~ ${prev.place} ~ ${prev.mode ? MODE_INFO[prev.mode].tag : '?'}`) : note('No header in the chat yet.'));

    const modeRows = MODES.map((m) => h('div', { class: 'zs-mode' },
        h('span', { class: 'zs-emoji' }, MODE_INFO[m].emoji),
        h('div', {}, h('b', {}, `${MODE_INFO[m].name} (${MODE_INFO[m].tag})`), h('small', {}, MODE_INFO[m].blurb)),
        toggle(s.allowed[m] !== false, (v) => { s.allowed[m] = v; save(); rerender(); })));
    const modeCard = card(
        h('b', {}, 'Modes'),
        seg([['auto', 'Auto'], ...MODES.map((m) => [m, MODE_INFO[m].tag])], s.mode, (id) => { s.mode = id; save(); rerender(); }),
        note(s.mode === 'auto' ? 'The AI picks the mode from the scene and moves one step at a time.' : `Locked to ${MODE_INFO[s.mode].name}.`),
        ...modeRows,
        h('p', { class: 'zs-adult' }, RULES_ALL));

    const promptCards = MODES.map((m) => h('details', { class: 'zs-det' },
        h('summary', {}, `${MODE_INFO[m].emoji} ${MODE_INFO[m].name} prompt`),
        area(s.prompts[m], (v) => { s.prompts[m] = v; save(); }),
        btn('Reset to default', () => { s.prompts[m] = DEFAULT_PROMPTS[m]; save(); rerender(); })));

    return h('div', {}, modelCard, formatCard, modeCard, card(h('b', {}, 'Mode prompts'), note('These are added to the prompt while that mode is in play. Edit them to change the style.'), ...promptCards),
        note('Shortcuts: /zenith-model, /zenith-mode auto|opal|saph|onyx|ruby'));
}

// ---------------------------------------------------------------- applying the profile
function apply() { document.dispatchEvent(new Event('zenith-style-apply')); }

globalThis.ZenithStyle = {
    screen,
    live: () => settings().enabled,
    profile: () => profile(globalThis.ZenithStyle._presets),
    values,
    apply,
    _presets: null,
    _test: { shapeProblem, guessModel, sizeB, tierOfWindow, hintLevel, workingMode, lastHeader, formatPrompt, modesPrompt, profile, TIERS, HEADER_RE },
    get last() { return lastBuilt; },
};

jQuery(() => {
    settings();
    const c = ctx();
    const { eventSource, eventTypes, SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = c;
    const refresh = async () => { if (await refreshReported()) apply(); };
    eventSource.on(eventTypes.APP_READY, refresh);
    eventSource.on(eventTypes.CHAT_CHANGED, refresh);
    for (const ev of ['OAI_PRESET_CHANGED_AFTER', 'CHATCOMPLETION_MODEL_CHANGED', 'CHATCOMPLETION_SOURCE_CHANGED']) if (eventTypes[ev]) eventSource.on(eventTypes[ev], async () => { await refresh(); apply(); });
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-model', helpString: 'Shows the model profile (context, reply length) that ZenithTavern is using.',
        callback: async () => { await refreshReported(); const p = profile(globalThis.ZenithStyle._presets); const t = `${p.model || 'no model'}: ${p.tierLabel}, context ${p.maxContext}, reply ${p.maxResponse} tokens, ${p.para.join('-')} paragraphs`; toastr.info(t); return t; },
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-mode', helpString: 'Locks the mode (opal, saph, onyx, ruby) or sets it back to auto.',
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'auto, opal, saph, onyx or ruby', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
        callback: async (_args, value) => {
            const v = String(value || '').trim().toLowerCase();
            const s = settings();
            if (v) {
                const mode = v === 'auto' ? 'auto' : TAG_TO_MODE[v];
                if (!mode) { toastr.warning('Use: auto, opal, saph, onyx or ruby.'); return ''; }
                s.mode = mode; save(); rerender();
            }
            const t = s.mode === 'auto' ? 'Mode: auto' : `Mode locked: ${MODE_INFO[s.mode].tag}`;
            toastr.info(t); return t;
        },
    }));
});
