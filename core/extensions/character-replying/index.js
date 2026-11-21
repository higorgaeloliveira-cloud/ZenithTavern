/* Character Replying - polished generation indicator. */
const KEY = 'character_replying';

function ctx() {
    return SillyTavern.getContext();
}

function settings() {
    const { extensionSettings } = ctx();
    const s = (extensionSettings[KEY] ??= {});
    s.enabled ??= true;
    s.showName ??= true;
    return s;
}

function ensureIndicator() {
    let el = document.getElementById('character-replying-indicator');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'character-replying-indicator';
    el.className = 'cri-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML = `
        <span class="cri-mark" aria-hidden="true">
            <span class="cri-dot"></span><span class="cri-dot"></span><span class="cri-dot"></span>
        </span>
        <span class="cri-label">Character is replying</span>
    `;
    document.body.appendChild(el);
    return el;
}

function characterName() {
    const c = ctx();
    return String(c.name2 || c.characterName || '').trim();
}

function updateLabel() {
    const el = ensureIndicator();
    const label = el.querySelector('.cri-label');
    const s = settings();
    const name = characterName();
    if (label) label.textContent = s.showName && name ? `${name} is replying` : 'Character is replying';
    el.setAttribute('aria-label', label?.textContent || 'Character is replying');
}

function show() {
    if (!settings().enabled) return;
    updateLabel();
    ensureIndicator().classList.add('cri-visible');
}

function hide() {
    document.getElementById('character-replying-indicator')?.classList.remove('cri-visible');
}

function makeToggle(checked, label, description, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'cri-setting';
    const copy = document.createElement('span');
    copy.className = 'cri-setting-copy';
    const title = document.createElement('span');
    title.className = 'cri-setting-title';
    title.textContent = label;
    copy.append(title);
    if (description) {
        const desc = document.createElement('span');
        desc.className = 'cri-setting-description';
        desc.textContent = description;
        copy.append(desc);
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cri-switch-input';
    input.checked = checked;
    const visual = document.createElement('span');
    visual.className = 'cri-switch';
    visual.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(copy, input, visual);
    return wrap;
}

function screen() {
    const s = settings();
    const root = document.createElement('section');
    root.className = 'cri-settings';

    const intro = document.createElement('div');
    intro.className = 'cri-settings-intro';
    const icon = document.createElement('div');
    icon.className = 'cri-preview-mark';
    icon.innerHTML = '<span></span><span></span><span></span>';
    const text = document.createElement('div');
    text.className = 'cri-intro-copy';
    const heading = document.createElement('div');
    heading.className = 'cri-settings-heading';
    heading.textContent = 'Character Replying';
    const sub = document.createElement('p');
    sub.textContent = 'A subtle typing indicator appears while a character is generating a response.';
    text.append(heading, sub);
    intro.append(icon, text);

    const options = document.createElement('div');
    options.className = 'cri-settings-options';
    options.append(
        makeToggle(s.enabled, 'Enable indicator', 'Show the animated reply bubble during generation.', (value) => {
            s.enabled = value;
            ctx().saveSettingsDebounced();
            if (!value) hide();
        }),
        makeToggle(s.showName, 'Show character name', 'Personalize the indicator with the active character’s name.', (value) => {
            s.showName = value;
            ctx().saveSettingsDebounced();
            if (document.getElementById('character-replying-indicator')?.classList.contains('cri-visible')) updateLabel();
        })
    );

    root.append(intro, options);
    return root;
}

jQuery(() => {
    const c = ctx();
    const { eventSource, eventTypes } = c;
    settings();
    ensureIndicator();

    if (eventTypes?.GENERATION_STARTED) eventSource.on(eventTypes.GENERATION_STARTED, show);
    if (eventTypes?.GENERATION_ENDED) eventSource.on(eventTypes.GENERATION_ENDED, hide);
    if (eventTypes?.MESSAGE_RECEIVED) eventSource.on(eventTypes.MESSAGE_RECEIVED, hide);
    if (eventTypes?.GENERATION_STOPPED) eventSource.on(eventTypes.GENERATION_STOPPED, hide);
    if (eventTypes?.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, hide);
    if (eventTypes?.APP_READY) eventSource.on(eventTypes.APP_READY, () => {
        ensureIndicator();
        hide();
    });
});

globalThis.CharacterReplying = {
    screen,
    show,
    hide,
    enabled: () => settings().enabled,
};
