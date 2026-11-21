/* Character Replying - small animated indicator shown while the character is generating. */
const MODULE = 'character_replying';
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

function injectStyles() {
    if (document.getElementById('character-replying-style')) return;
    const style = document.createElement('style');
    style.id = 'character-replying-style';
    style.textContent = `
#character-replying-indicator {
    position: fixed;
    z-index: 9999;
    left: 50%;
    bottom: calc(var(--bottom-sentinel-height, 0px) + 18px);
    transform: translateX(-50%);
    display: none;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 7px 13px 7px 12px;
    border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor, #777) 70%, transparent);
    border-radius: 18px;
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #222) 88%, transparent);
    box-shadow: 0 5px 20px rgba(0, 0, 0, .18);
    color: var(--SmartThemeBodyColor, #eee);
    font-size: 12px;
    line-height: 1;
    pointer-events: none;
    backdrop-filter: blur(8px);
}
#character-replying-indicator.cri-visible {
    display: inline-flex;
}
#character-replying-indicator .cri-label {
    opacity: .82;
    white-space: nowrap;
}
#character-replying-indicator .cri-dots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
#character-replying-indicator .cri-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: .35;
    animation: character-replying-bounce 1.2s infinite ease-in-out;
}
#character-replying-indicator .cri-dot:nth-child(2) { animation-delay: .16s; }
#character-replying-indicator .cri-dot:nth-child(3) { animation-delay: .32s; }

@keyframes character-replying-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: .35; }
    30% { transform: translateY(-3px); opacity: 1; }
}

@media (max-width: 600px) {
    #character-replying-indicator {
        bottom: calc(var(--bottom-sentinel-height, 0px) + 12px);
        max-width: calc(100vw - 28px);
    }
}
`;
    document.head.appendChild(style);
}

function ensureIndicator() {
    let el = document.getElementById('character-replying-indicator');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'character-replying-indicator';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Character is replying');
    el.innerHTML = `
        <span class="cri-label">Character is replying</span>
        <span class="cri-dots" aria-hidden="true">
            <span class="cri-dot"></span>
            <span class="cri-dot"></span>
            <span class="cri-dot"></span>
        </span>
    `;
    document.body.appendChild(el);
    return el;
}

function characterName() {
    const c = ctx();
    try {
        const name = c.name2 || c.characterName || '';
        return String(name).trim();
    } catch {
        return '';
    }
}

function show() {
    const s = settings();
    if (!s.enabled) return;
    const el = ensureIndicator();
    const label = el.querySelector('.cri-label');
    const name = characterName();
    if (label) {
        label.textContent = s.showName && name ? `${name} is replying` : 'Character is replying';
    }
    el.classList.add('cri-visible');
}

function hide() {
    const el = document.getElementById('character-replying-indicator');
    if (el) el.classList.remove('cri-visible');
}

function screen() {
    const s = settings();
    const h = (tag, attrs = {}, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') el.className = v;
            else if (v !== false && v != null) el.setAttribute(k, v);
        }
        for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
        return el;
    };
    const toggle = (checked, onChange) => {
        const i = h('input', { type: 'checkbox', class: 'zp-toggle' });
        i.checked = checked;
        i.addEventListener('change', () => onChange(i.checked));
        return i;
    };

    return h('div', {},
        h('div', { class: 'zp-card' },
            h('div', { class: 'zp-row' },
                h('div', {},
                    h('b', {}, 'Character replying'),
                    h('small', {}, 'Shows a small animated three-dot indicator while the character is generating.')
                ),
                toggle(s.enabled, (v) => {
                    s.enabled = v;
                    ctx().saveSettingsDebounced();
                    if (!v) hide();
                })
            ),
            h('div', { class: 'zp-row' },
                h('span', {}, 'Show character name'),
                toggle(s.showName, (v) => {
                    s.showName = v;
                    ctx().saveSettingsDebounced();
                })
            )
        )
    );
}

jQuery(() => {
    const c = ctx();
    const { eventSource, eventTypes } = c;
    settings();
    injectStyles();
    ensureIndicator();

    const started = eventTypes?.GENERATION_STARTED;
    const ended = eventTypes?.GENERATION_ENDED;
    const received = eventTypes?.MESSAGE_RECEIVED;
    const cancelled = eventTypes?.GENERATION_STOPPED;

    if (started) eventSource.on(started, show);
    if (ended) eventSource.on(ended, hide);
    if (received) eventSource.on(received, hide);
    if (cancelled) eventSource.on(cancelled, hide);

    if (eventTypes?.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, hide);
    if (eventTypes?.APP_READY) eventSource.on(eventTypes.APP_READY, () => {
        injectStyles();
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
