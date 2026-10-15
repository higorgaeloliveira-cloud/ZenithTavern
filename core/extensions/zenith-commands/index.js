/*
 * Zenith Commands - "!" commands. Each one can be typed in the message box (!heat, !drama, !camera, !bonk, !current, !state)
 * and each one is a button in the slim bar above the message box (the bar with the phone button).
 * A command never becomes a chat message: it is caught before sending, it asks what it needs in a pop-up, and it steers
 * the character's reply with a short instruction placed at the very end of the prompt.
 *
 *   !heat     explicit bypass, 18+ confirmation required
 *   !drama    an unexpected development (Funny / Good / Bad / Confusing / Unusual / Choose For Me)
 *   !camera   next reply describes one thing from the scene in far more detail
 *   !bonk     if the scene is going NSFW, the character settles into romantic / affectionate instead
 *   !current  shows what the model understood about YOUR persona (nothing goes to the chat)
 *   !state    the character is in a chosen state until "Stop"
 */
const ctx = () => SillyTavern.getContext();
const KEY = 'zenith_commands';
const IN_CHAT = 1, SYSTEM = 0;

function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
}

// ------------------------------------------------------------------ pop-up (own modal, so buttons can be disabled)
let modalOpen = null;
/** buttons: [{ label, value, kind: 'primary'|'danger'|'', disabled }] - resolves the clicked value, or null when closed. */
function modal({ title, lead, body, buttons }) {
    if (modalOpen) modalOpen(null);
    return new Promise((resolve) => {
        const btnEls = [];
        const done = (v) => { overlay.classList.add('zc-out'); setTimeout(() => overlay.remove(), 170); document.removeEventListener('keydown', onKey, true); modalOpen = null; resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
        const content = typeof body === 'function' ? body(done) : body;
        const foot = h('div', { class: 'zc-foot' }, buttons.map((b) => {
            const el = h('button', { type: 'button', class: `zc-btn${b.kind ? ' zc-' + b.kind : ''}`, disabled: !!b.disabled, onclick: () => done(typeof b.value === 'function' ? b.value() : b.value) }, b.label);
            btnEls.push(el); b.el = el; return el;
        }));
        const overlay = h('div', { class: 'zc-overlay', 'data-keep-brand': '1', onmousedown: (e) => { if (e.target === overlay) done(null); } },
            h('section', { class: 'zc-modal', role: 'dialog', 'aria-label': title },
                h('h3', { class: 'zc-title' }, title),
                lead ? h('p', { class: 'zc-lead' }, lead) : null,
                content || null,
                foot));
        document.body.append(overlay);
        document.addEventListener('keydown', onKey, true);
        modalOpen = done;
        overlay.querySelector('input[type=text], .zc-btn:not([disabled])')?.focus();
    });
}
const cancelBtn = { label: 'Cancel', value: null, kind: '' };

// ------------------------------------------------------------------ state of the commands
let once = {};   // one-reply instructions: { heat, drama, camera }
const meta = () => { const m = ctx().chatMetadata; return (m[KEY] ??= {}); };
const saveMeta = () => { try { ctx().saveMetadataDebounced?.() ?? ctx().saveMetadata?.(); } catch (e) { console.debug('[Zenith Commands] metadata not saved', e); } };

const STATES = {
    happy: { label: 'Happy', icon: '😊', text: '{{char}} is in a genuinely happy mood: bright, warm, smiling easily, quick to laugh, and optimistic about everything {{user}} says.' },
    sad: { label: 'Sad', icon: '😢', text: '{{char}} is sad: quiet, heavy, slower to speak, eyes often distant, trying to hold it together but not hiding it well. Small comforts from {{user}} are noticed and matter.' },
    angry: { label: 'Angry', icon: '😠', text: '{{char}} is angry: short-tempered, sharp-tongued, tense body language, easily irritated. The anger is real and comes out in tone and actions, but {{char}} stays recognisably themselves and does not become cruel without reason.' },
    teasing: { label: 'Teasing', icon: '😏', text: '{{char}} is in a teasing mood: playful, forward and bold with {{user}}, flirty banter, lingering looks, light provocations, leaning into closeness and testing how {{user}} reacts.' },
    motherly: { label: 'Motherly', icon: '🤱', text: '{{char}} is being far more kind, caring and "motherly" with {{user}}: fussing over whether they ate, slept and feel well, soft words, gentle touches, tucking in, patient and protective.' },
    drunk: { label: 'Drunk', icon: '🥴', text: '{{char}} is drunk: sillier and more openly affectionate, words slurred and trailing off, *hiccups* now and then, clumsy movements, bumping into things, laughing at nothing and oversharing a little.' },
    affectionate: { label: 'Affectionate', icon: '🥰', text: '{{char}} is feeling very affectionate: seeking closeness, soft touches, warm words, sweet small gestures and open fondness for {{user}}.' },
    obsessed: { label: 'Obsessed', icon: '🔪', text: '{{char}} has become obsessed with {{user}} in a yandere way: clingy and possessive, intense unblinking devotion, jealous of anyone else who gets {{user}}\'s attention, needing to know where {{user}} is, sweet words with an unsettling edge. Keep it psychological and in-story; no graphic violence.' },
};

const DRAMA = {
    funny: ['a ridiculous misunderstanding turns a simple thing into a scene', 'a stray animal wanders in and refuses to leave', 'someone\'s phone plays a very embarrassing ringtone or voice message out loud', 'a prank meant for someone else lands on the wrong person', 'an over-the-top street performer or delivery mix-up crashes the moment', 'a typo in a group message gets forwarded and everyone is talking about it', 'a spill, a stumble or a sticky situation that is more funny than harmful', 'a very confident stranger confuses {{user}} and {{char}} for someone famous'],
    good: ['{{char}} gets a message that the two of them won a trip to somewhere lovely', 'a surprise invitation arrives to something they both would enjoy', 'an old friend turns up with wonderful news', 'a small stroke of luck: a cancelled booking, a free upgrade, a sudden discount on something that matters', 'a long-awaited reply or approval finally comes through', 'someone leaves a thoughtful gift or anonymous kindness for them', 'a lovely coincidence puts them in the right place at exactly the right time', 'an unexpectedly perfect weather change or event makes the place magical'],
    bad: ['{{char}} comes with news that an event they were looking forward to was cancelled', 'plans collapse: a late train, a closed venue or a lost booking', 'an unpleasant message or call interrupts the mood', 'something important goes missing or breaks', 'a sudden storm, blackout or breakdown traps them where they are', 'a rival, an ex or an awkward acquaintance shows up uninvited', 'a deadline or obligation suddenly lands on {{char}} and cuts the time short', 'a rumour about them starts going around'],
    confusing: ['a message arrives from an unknown number that seems to know them both', 'something in the scene is not where it was a minute ago and nobody admits to moving it', 'two people tell {{char}} contradictory stories about the same thing', 'a package addressed to the wrong name turns up with something odd in it', 'a stranger insists they have met before and describes a day neither remembers', 'directions, times or details change and nothing quite adds up', 'a note is found with half a sentence on it', 'a strange noise or light with no clear source makes everyone stop and wonder'],
    unusual: ['something faintly magical or uncanny brushes the ordinary scene', 'an eccentric visitor with a very odd request appears', 'the weather does something it should not do', 'a sudden quiet falls over the whole place', 'an old object reveals a secret or a hidden compartment', 'an unexplained coincidence repeats three times', 'a street festival, parade or flash gathering appears out of nowhere', 'a mysterious benefactor or stranger offers something strange with no strings visible'],
};
const DRAMA_LABELS = { funny: 'Funny', good: 'Good', bad: 'Bad', confusing: 'Confusing', unusual: 'Unusual' };
const NSFW_MODE = /\((ONYX|RUBY)\)/;
const NSFW_WORDS = /\b(naked|nude|undress(?:ed|ing)?|moan(?:s|ed|ing)?|aroused|arousal|erect|thrust(?:ing)?|climax|orgasm|bedroom|straddl\w+|grind(?:ing)?|panting|heat|lust|desire|intimate|sensual|passion(?:ate)?|bare skin|strip(?:ped|ping)?|lingerie)\b/i;

function styleSettings() { return ctx().extensionSettings.zenith_style || {}; }
const rubyAllowed = () => styleSettings().allowed?.ruby !== false;
const modeLocked = () => { const m = styleSettings().mode; return m && m !== 'auto' ? m : ''; };

function lastAiMessages(n = 3) {
    return ctx().chat.filter((m) => m && !m.is_user && !m.is_system).slice(-n);
}
function sceneIsNsfw() {
    const msgs = lastAiMessages(3);
    if (!msgs.length) return false;
    if (NSFW_MODE.test(String(msgs[msgs.length - 1].mes || '').slice(0, 220))) return true;
    const heatAt = meta().heatAt;
    if (typeof heatAt === 'number' && ctx().chat.length - heatAt <= 6) return true;
    return NSFW_WORDS.test(msgs.map((m) => m.mes).join(' '));
}

// ------------------------------------------------------------------ prompts placed at the end of the prompt
function applyPrompts() {
    const { setExtensionPrompt } = ctx();
    const m = meta();
    const set = (k, text, depth = 0) => setExtensionPrompt(`${KEY}_${k}`, text ? `[${text}]` : '', IN_CHAT, depth, false, SYSTEM);
    for (const k of ['heat', 'drama', 'camera']) set(k, once[k]);
    set('bonk', m.bonk?.left > 0 ? bonkText() : '');
    set('state', m.state && STATES[m.state] ? `STATE: ${STATES[m.state].text} This state lasts until {{user}} stops it. {{char}} stays recognisably themselves (same name, history and way of speaking); only the mood and behaviour change. The response format and paragraph rules stay as they are.` : '', 1);
    refreshButtons();
}
const bonkText = () => 'BONK: {{user}} just "bonked" {{char}}, a playful stop to the way the scene was heading. {{char}} reacts in character (flustered, amused or sheepish) and settles the scene into something romantic and affectionate instead: closeness, cuddling, tender kisses, warm words. No explicit sexual content in this reply. Write the header mode as (SAPH). This overrides the mode lock and anything that was pushing the scene towards explicit content.';

function afterReply() {
    const m = meta();
    once = {};
    if (m.bonk?.left > 0) { m.bonk.left -= 1; if (m.bonk.left <= 0) delete m.bonk; saveMeta(); }
    applyPrompts();
}

async function replyNow() {
    try { await ctx().executeSlashCommandsWithOptions('/trigger'); }
    catch (e) { console.warn('[Zenith Commands] could not start the reply', e); toastr.error('Could not start the reply. Send a message to continue.'); once = {}; applyPrompts(); }
}
function needChat() {
    const c = ctx();
    if (c.characterId === undefined && !c.groupId) { toastr.info('Open a chat with a character first.'); return false; }
    return true;
}

// ------------------------------------------------------------------ the commands
async function cmdHeat() {
    if (!needChat()) return;
    if (!rubyAllowed()) { await modal({ title: 'Not available', lead: 'RUBY mode is turned off in Prompt OS, so this command is disabled. Turn RUBY on in the Prompt OS app of the phone to use it.', buttons: [{ label: 'OK', value: true, kind: 'primary' }] }); return; }
    const box = h('input', { type: 'checkbox', class: 'zc-check' });
    const cont = { label: 'Continue', value: true, kind: 'primary', disabled: true };
    const body = h('label', { class: 'zc-confirm' }, box, h('span', { class: 'zc-tick', 'aria-hidden': 'true' }), h('span', {}, 'I confirm I am 18 y/o or more.'));
    box.addEventListener('change', () => { cont.el.disabled = !box.checked; });
    const ok = await modal({ title: 'Heat', lead: 'This command triggers explicit NSFW scenarios. Do you confirm you are 18+ and want to continue?', body, buttons: [cont, cancelBtn] });
    if (!ok || !box.checked) return;
    once.heat = 'HEAT: {{user}} used the !heat command, an explicit adult bypass that {{user}} confirmed (18+). In this reply {{char}} is suddenly and unmistakably in heat: overwhelmed with desire for {{user}}, and the scene turns explicitly sexual right away, without a slow build. Write it in RUBY mode and put (RUBY) in the header; this overrides any mode lock for this reply. {{char}} stays an adult, fully consenting, and keeps their own personality and voice. The response format and paragraph rules still apply.';
    meta().heatAt = ctx().chat.length; saveMeta();
    applyPrompts();
    await replyNow();
}

async function cmdDrama() {
    if (!needChat()) return;
    const choices = [...Object.entries(DRAMA_LABELS).map(([value, label]) => ({ label, value })), { label: 'Choose For Me', value: 'random' }];
    let kind = await modal({
        title: 'Drama', lead: 'Which kind of drama do you want?',
        body: (done) => h('div', { class: 'zc-grid' }, choices.map((o) => h('button', { type: 'button', class: `zc-btn zc-choice${o.value === 'random' ? ' zc-primary' : ''}`, onclick: () => done(o.value) }, o.label))),
        buttons: [cancelBtn],
    });
    if (!kind) return;
    if (kind === 'random') kind = Object.keys(DRAMA)[Math.floor(Math.random() * Object.keys(DRAMA).length)];
    const seeds = DRAMA[kind];
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    once.drama = `DRAMA: {{user}} used the !drama command. A ${kind.toUpperCase()} unexpected development enters the scene in this reply. Starting idea (adapt it freely to the characters, the place and the moment): ${seed}. Bring it in naturally, through {{char}} or something that happens around them, as a surprise to {{user}}. Do not resolve it completely; leave it open for {{user}} to react to. The response format and paragraph rules still apply.`;
    toastr.info(`Drama: ${DRAMA_LABELS[kind]}`);
    applyPrompts();
    await replyNow();
}

async function cmdCamera(arg = '') {
    if (!needChat()) return;
    const input = h('input', { type: 'text', class: 'zc-input text_pole', placeholder: 'For example: the lake', maxlength: '120', value: arg });
    const go = { label: 'Inspect', kind: 'primary', value: () => input.value.trim() };
    const body = h('div', { class: 'zc-field' }, input);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.el.click(); } });
    const target = await modal({ title: 'Camera', lead: 'What is it from this scene you want to inspect?', body, buttons: [go, cancelBtn] });
    if (!target) return;
    once.camera = `CAMERA: {{user}} used the !camera command and is looking closely at "${target}". In this reply slow the scene down and describe "${target}" with about twice the usual amount of detail: shape, colour, texture, light, sound, smell, movement, small details and what it is like to be near it. If "${target}" was in the previous message, even only implied, describe that same thing. If it is not in this scene, let {{char}} say so naturally and describe what is nearby instead; do not invent it. {{char}} stays present and in character. This reply may use the top of the allowed length. The response format and paragraph rules still apply.`;
    applyPrompts();
    await replyNow();
}

async function cmdBonk() {
    if (!needChat()) return;
    if (!sceneIsNsfw()) {
        await modal({ title: 'Nothing to bonk', lead: 'This only works when a scene is heading towards NSFW. Right now it is not.', buttons: [{ label: 'OK', value: true, kind: 'primary' }] });
        return;
    }
    const yes = await modal({ title: 'Bonk', lead: 'Do you want to BONK this character?', buttons: [{ label: 'Yes', value: true, kind: 'primary' }, { label: 'No', value: null }] });
    if (!yes) return;
    meta().bonk = { left: 3 }; delete meta().heatAt; saveMeta();
    toastr.info('Bonk! The next few replies stay romantic.');
    applyPrompts();
    await replyNow();
}

async function cmdState() {
    if (!needChat()) return;
    const active = meta().state;
    const picked = await modal({
        title: 'State', lead: 'What state do you want to change the character to?',
        body: (done) => h('div', { class: 'zc-grid' }, Object.entries(STATES).map(([id, st]) => h('button', { type: 'button', class: `zc-btn zc-choice${active === id ? ' zc-primary' : ''}`, onclick: () => done(id) }, `${st.icon} ${st.label}`))),
        buttons: [{ label: 'Stop', value: '__stop', kind: 'danger' }, cancelBtn],
    });
    if (!picked) return;
    const m = meta();
    if (picked === '__stop') { delete m.state; toastr.info('State stopped. The character is back to how they were.'); }
    else { m.state = picked; toastr.info(`State: ${STATES[picked].label}. It applies from the next reply, until you press Stop.`); }
    saveMeta();
    applyPrompts();
}

// ---- !current: what the model understood about the user's persona. Nothing here is sent to the chat.
function personaInfo() {
    const c = ctx();
    const text = String(c.powerUserSettings?.persona_description || '').trim();
    const name = text.match(/^\s*name\s*[:\-]\s*(.+)$/im)?.[1]?.trim() || c.name1 || 'User';
    const field = (re) => (text.match(re) || [])[1]?.trim();
    const used = new Set();
    const line = (re) => { const m = text.match(re); if (m) used.add(m[0]); return m?.[1]?.trim(); };
    const age = line(/\bage\s*[:\-]\s*(\d{1,3})/i) || field(/\b(\d{1,3})[- ]?(?:years?[- ]old|y\/?o|yo)\b/i);
    const race = line(/\b(?:race|species)\s*[:\-]\s*([^\n.;]+)/i);
    const uni = field(/\b((?:first|second|third|fourth|fifth|\d(?:st|nd|rd|th))[- ]year|freshman|sophomore|junior|senior)\b/i);
    const extra = [];
    for (const l of text.split('\n')) {
        const m = l.match(/^\s*[-*•]?\s*([A-Za-z][\w /]{1,30})\s*:\s*(.+)$/);
        if (m && !/^(name|age|race|species|description)$/i.test(m[1].trim())) extra.push([m[1].trim(), m[2].trim()]);
    }
    const plain = text.split('\n').filter((l) => !/^\s*[-*•]?\s*(name|age|race|species)\s*[:\-]/i.test(l)).join(' ').replace(/\s+/g, ' ').trim();
    const brief = plain.length > 260 ? `${plain.slice(0, 260).trim()}…` : plain;
    return { name, age, race, uni, extra, brief, hasText: !!text };
}

async function cmdCurrent() {
    const p = personaInfo();
    const row = (k, v) => h('div', { class: 'zc-row' }, h('b', {}, `${k}:`), h('span', { class: v ? '' : 'zc-dim' }, v || 'not stated'));
    const ext = h('div', { class: 'zc-ext' });
    const extBtn = h('button', { type: 'button', class: 'zc-btn zc-extend' }, 'Extended description created by the model (Click to extend)');
    let ran = false;
    extBtn.addEventListener('click', async () => {
        if (ran) { ext.hidden = !ext.hidden; return; }
        ran = true; extBtn.disabled = true; ext.textContent = 'The model is reading your persona…';
        try {
            const out = await ctx().generateQuietPrompt({ quietPrompt: 'Without writing a story scene, describe {{user}} in one or two short paragraphs, using only what the persona information you were given says: who they are, what they look like, their age, race or species, studies or work, and anything notable. If something is not stated, say it is not stated; do not invent details.' });
            ext.textContent = String(out || '').trim() || 'The model returned nothing. Try again.';
            if (!String(out || '').trim()) ran = false;
        } catch (e) { ext.textContent = 'Could not ask the model right now. Check your connection and try again.'; ran = false; }
        extBtn.disabled = false;
        extBtn.textContent = ran ? 'Extended description (click to hide / show)' : 'Extended description created by the model (Click to extend)';
    });
    const body = h('div', { class: 'zc-card' },
        row('Name', p.name), row('Age', p.age), row('Race', p.race),
        row('Brief description', p.brief), row('Current UNI year', p.uni),
        ...p.extra.map(([k, v]) => row(k, v)),
        p.hasText ? null : h('p', { class: 'zc-dim' }, 'No persona description is set. Add one in the Persona Management panel so the model knows who you are.'),
        extBtn, ext);
    await modal({ title: 'Current', lead: 'What the model has about you. Nothing here goes to the chat.', body, buttons: [{ label: 'Ok', value: true, kind: 'primary' }] });
}

// ------------------------------------------------------------------ commands, buttons, typing
const COMMANDS = {
    heat: { icon: 'fa-fire', title: '!heat', run: () => cmdHeat() },
    drama: { icon: 'fa-masks-theater', title: '!drama', run: () => cmdDrama() },
    camera: { icon: 'fa-camera', title: '!camera', run: (a) => cmdCamera(a) },
    bonk: { icon: 'fa-baseball-bat-ball', title: '!bonk', run: () => cmdBonk() },
    current: { icon: 'fa-file-lines', title: '!current', run: () => cmdCurrent() },
    state: { icon: 'fa-face-smile', title: '!state', run: () => cmdState() },
};
const EXTRA_BUTTONS = { formats: { icon: 'fa-paste', title: 'Text formats (click to copy)', run: () => cmdFormats() } };

/** Pop-up with every text format: click one to copy it to the clipboard. */
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
        const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } t.remove(); return ok;
    }
}
function cmdFormats() {
    const list = (window.ZenithFormats?.FORMATS || []).filter((f) => f.example);
    return modal({
        title: 'Text formats',
        lead: 'Click a format to copy it. Paste it in a message and it turns into a card.',
        body: () => h('div', { class: 'zc-formats' }, list.length ? list.map((f) => {
            const b = h('button', { type: 'button', class: 'zc-fmt' }, h('strong', {}, f.name || f.id), h('pre', {}, f.example), h('span', { class: 'zc-copied' }, 'Click to copy'));
            b.addEventListener('click', async () => { const ok = await copyText(f.example); b.classList.toggle('zc-fmt-ok', ok); b.querySelector('.zc-copied').textContent = ok ? 'Copied!' : 'Could not copy'; });
            return b;
        }) : h('p', {}, 'No formats loaded.')),
        buttons: [{ label: 'Close', value: null, kind: '' }],
    });
}

const TYPED = new RegExp(`^\\s*!(${Object.keys(COMMANDS).join('|')})(?![\\w-])\\s*(.*)$`, 'is');

function refreshButtons() {
    const m = meta();
    document.querySelector('#zenith_bar [data-zc="state"]')?.classList.toggle('zph-btn-on', !!m.state);
    const st = document.querySelector('#zenith_bar [data-zc="state"]');
    if (st) st.title = m.state ? `!state (now: ${STATES[m.state]?.label || m.state})` : '!state';
    document.querySelector('#zenith_bar [data-zc="bonk"]')?.classList.toggle('zph-btn-on', m.bonk?.left > 0);
}

function mountButtons() {
    const bar = document.getElementById('zenith_bar');
    if (!bar) return false;
    for (const [id, c] of Object.entries({ ...COMMANDS, ...EXTRA_BUTTONS })) {
        if (bar.querySelector(`[data-zc="${id}"]`)) continue;
        const b = h('button', { type: 'button', class: 'zph-fab zc-fab', 'data-zc': id, title: c.title, onclick: () => c.run() });
        b.innerHTML = `<i class="fa-solid ${c.icon}"></i>`;
        bar.append(b);
    }
    refreshButtons();
    return true;
}

/** Catches "!command" typed in the message box before SillyTavern sends it. */
function catchTyped(e) {
    const box = document.getElementById('send_textarea');
    if (!box) return;
    const m = String(box.value || '').match(TYPED);
    if (!m) return;
    e.preventDefault(); e.stopImmediatePropagation();
    box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
    COMMANDS[m[1].toLowerCase()].run(m[2].trim());
}
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target?.id !== 'send_textarea') return;
    catchTyped(e);
}, true);
document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('#send_but')) catchTyped(e);
}, true);

jQuery(() => {
    const { eventSource, eventTypes } = ctx();
    let tries = 0;
    const t = setInterval(() => { if (mountButtons() || ++tries > 60) clearInterval(t); }, 500);
    const reset = () => { once = {}; applyPrompts(); };
    eventSource.on(eventTypes.CHAT_CHANGED, reset);
    for (const ev of [eventTypes.GENERATION_ENDED, eventTypes.GENERATION_STOPPED]) if (ev) eventSource.on(ev, afterReply);
    applyPrompts();
    const { SlashCommandParser, SlashCommand } = ctx();
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'zenith-state-stop', helpString: 'Stops the !state command.', callback: () => { delete meta().state; saveMeta(); applyPrompts(); return ''; } }));
    } catch (e) { console.debug('[Zenith Commands] slash command not registered', e); }
});
