/*
 * Zenith UI - the streamlined interface.
 *
 *  - hides the settings that people tend to break (AI response config, formatting, user settings, backgrounds)
 *  - merges API connection + a few UI settings + extensions into ONE Settings menu (the gear)
 *  - adds a Home button, renames "Persona Management"/"Character Management", swaps the icons
 *  - locks the AI response values (context size, response length, temperature) to the presets in tavern.config.json
 *
 * Hiding is for convenience, not security. Creator mode shows everything again:
 *   type /zenith-dev on.  Back to normal: /zenith-dev off.
 * (A ?dev=1 web address is NOT supported: SillyTavern's Backgrounds tabs would load a second copy of the page when the address has a query.)
 */
const DEV_KEY = 'zenith_dev';
const ctx = () => SillyTavern.getContext();
const $q = (sel) => document.querySelector(sel);

function devMode() {
    try {
        return localStorage.getItem(DEV_KEY) === '1';
    } catch { return false; }
}

// ------------------------------------------------------------ presets (locked AI response values)
let presets = null;

async function loadPresets() {
    try {
        const res = await fetch('/api/plugins/zenith-system/presets', { headers: ctx().getRequestHeaders() });
        if (res.ok) presets = await res.json();
    } catch { /* keep null: nothing is enforced */ }
}

function setControl(selector, value, events = ['input']) {
    const el = $(selector);
    if (!el.length || Number(el.val()) === value) return;
    // a range slider silently clamps to its own max, so widen the max first
    if (el.attr('max') && Number(el.attr('max')) < value) el.attr('max', value);
    el.val(value);
    events.forEach((e) => el.trigger(e));
}

function applyPresets() {
    if (!presets || !presets.enforce) return;
    // ZenithStyle (zenith-style) turns the fixed numbers into ones that fit the selected model
    if (globalThis.ZenithStyle) globalThis.ZenithStyle._presets = presets;
    const p = globalThis.ZenithStyle ? globalThis.ZenithStyle.values(presets) : presets;
    const oai = ctx().chatCompletionSettings;
    // Chat completion (OpenRouter, OpenAI, Claude, ...)
    if (!oai.max_context_unlocked) { $('#oai_max_context_unlocked').prop('checked', true).trigger('input'); }
    if (p.maxContext) setControl('#openai_max_context', p.maxContext);
    if (p.maxResponseTokens) setControl('#openai_max_tokens', p.maxResponseTokens);
    if (p.temperature != null) setControl('#temp_openai', p.temperature);
    // Text completion / other APIs
    if (p.maxResponseTokens) setControl('#amount_gen', p.maxResponseTokens);
    if (p.maxContext && ctx().powerUserSettings.max_context_unlocked) setControl('#max_context', p.maxContext);
}

// ------------------------------------------------------------ streaming (a switch in Settings, OFF by default)
const streamingOn = () => ctx().extensionSettings.zenith_ui?.streaming === true;

function applyStreaming() {
    if (devMode()) return;
    const want = streamingOn();
    for (const sel of ['#stream_toggle', '#streaming_textgenerationwebui', '#streaming_kobold']) {
        const el = $(sel);
        if (el.length && el.prop('checked') !== want) el.prop('checked', want).trigger('input').trigger('change');
    }
}

function mountStreamingSwitch() {
    const api = document.getElementById('rm_api_block');
    if (!api || document.getElementById('zenith_streaming')) return;
    const box = document.createElement('div');
    box.id = 'zenith_streaming';
    box.style.cssText = 'width:100%;margin-top:14px;padding:10px 0;border-top:1px solid var(--SmartThemeBorderColor,#444);display:flex;flex-direction:column;gap:6px';
    box.innerHTML = '<label class="zn-row"><span>Streaming</span><span class="zn-state"></span><input type="checkbox" class="zn-switch"></label>'
        + '<p class="zn-note">Off (default): each reply appears whole, once it is finished. On: text appears word by word while it is written. Streaming is off by default because it can cut replies short or garble them with some models and routes.</p>';
    const input = box.querySelector('input');
    const state = box.querySelector('.zn-state');
    const paint = () => { input.checked = streamingOn(); state.textContent = streamingOn() ? 'ON' : 'OFF'; };
    input.addEventListener('change', () => {
        const { extensionSettings, saveSettingsDebounced } = ctx();
        (extensionSettings.zenith_ui ??= {}).streaming = input.checked;
        saveSettingsDebounced(); paint(); applyStreaming();
    });
    paint();
    const settings = document.getElementById('user-settings-block');
    if (settings && api.contains(settings)) settings.before(box); else api.append(box);
}

// Runs before every generation, so the values are right even after a model switch lowered them.
document.addEventListener('zenith-style-apply', () => { if (!devMode()) applyPresets(); });

globalThis.zenithUiInterceptor = async function () {
    if (!devMode()) { applyPresets(); applyStreaming(); }
};

// ------------------------------------------------------------ one-time default: OpenRouter
function defaultToOpenRouter() {
    const { extensionSettings, saveSettingsDebounced } = ctx();
    const s = (extensionSettings.zenith_ui ??= {});
    if (s.apiDefaultApplied) return;
    s.apiDefaultApplied = true;
    saveSettingsDebounced();
    if (ctx().mainApi === 'openai' && ctx().chatCompletionSettings.chat_completion_source !== 'openai') return; // already customized
    $('#main_api').val('openai').trigger('change');
    $('#chat_completion_source').val('openrouter').trigger('change');
}

// ------------------------------------------------------------ one-time: switch on the starter lorebooks
// Lorebooks the launcher installs from core/worlds are turned on for all chats ONCE (World Info > "Active World(s)").
// If you switch one off later it stays off: each name is only handled once. Add names here for new starter worlds.
const STARTER_WORLDS = ['Asterhaven', 'Characters', 'Sub-bots'];
function activateStarterWorlds() {
    const { extensionSettings, saveSettingsDebounced } = ctx();
    const s = (extensionSettings.zenith_ui ??= {});
    const done = (s.startersActivated ??= []);
    const select = $('#world_info');
    let changed = false;
    for (const name of STARTER_WORLDS) {
        if (done.includes(name)) continue;
        const option = select.find('option').filter((_, o) => o.textContent === name);
        if (!option.length) continue; // not installed (yet)
        option.prop('selected', true);
        done.push(name);
        changed = true;
    }
    if (changed) { select.trigger('change'); saveSettingsDebounced(); }
}

// ------------------------------------------------------------ one-time: switch to the ZenithTavern theme
// The launcher installs "Zenith Gold" into SillyTavern's theme list. It is selected ONCE, the first time.
// Pick another theme later and it stays that way.
const STARTER_THEME = 'Zenith Gold';
function applyStarterTheme() {
    const { extensionSettings, saveSettingsDebounced, executeSlashCommandsWithOptions } = ctx();
    const s = (extensionSettings.zenith_ui ??= {});
    if (s.themeApplied === STARTER_THEME) return;
    const exists = $('#themes option').filter((_, o) => o.value === STARTER_THEME).length > 0;
    if (!exists) return; // not installed (yet)
    s.themeApplied = STARTER_THEME;
    saveSettingsDebounced();
    executeSlashCommandsWithOptions(`/theme ${STARTER_THEME}`);
}

// ------------------------------------------------------------ DOM changes
function setTitle(el, text) {
    if (!el) return;
    el.setAttribute('title', text);
    el.setAttribute('data-i18n', `[title]${text}`);
}

function renameThings() {
    setTitle($q('#API-status-top'), 'Settings');
    setTitle($q('#persona-management-button .drawer-icon'), 'User Persona');
    setTitle($q('#rightNavDrawerIcon'), 'Character List');
    const heading = $q('#persona-management-button [data-i18n="Persona Management"]');
    if (heading) { heading.textContent = 'User Persona'; heading.setAttribute('data-i18n', 'zenith_user_persona'); }
}

function addHomeButton() {
    const persona = $q('#persona-management-button');
    if (!persona || $q('#zenith_home')) return;
    const home = document.createElement('div');
    home.id = 'zenith_home';
    home.className = 'drawer';
    home.innerHTML = '<div class="drawer-toggle"><div class="drawer-icon fa-solid fa-house fa-fw closedIcon" title="Home"></div></div>';
    home.addEventListener('click', () => {
        // close any open (unpinned) menu first, then leave the current chat
        $('.drawer-content.openDrawer:not(.pinnedOpen)').each(function () {
            $(this).closest('.drawer').find('.drawer-toggle').first().trigger('click');
        });
        ctx().executeSlashCommandsWithOptions('/closechat');
    });
    persona.before(home);
}

function mergeSettings() {
    const api = $q('#rm_api_block');
    if (!api || api.dataset.zenithMerged) return;
    api.dataset.zenithMerged = '1';

    // "Advanced Options" switch: shows the API type pickers that are hidden by default
    const toggle = document.createElement('div');
    toggle.id = 'zenith_adv_toggle';
    toggle.innerHTML = '<label><input id="zenith_adv_checkbox" type="checkbox"> <span>Advanced Options</span></label>';
    api.prepend(toggle);
    toggle.querySelector('input').addEventListener('change', (e) => api.classList.toggle('zenith-adv', e.target.checked));

    // Move whole blocks (not copies) so every setting keeps working
    for (const sel of ['#user-settings-block', '#rm_extensions_block']) {
        const block = $q(sel);
        if (!block) continue;
        block.classList.remove('drawer-content', 'closedDrawer', 'openDrawer');
        block.classList.add('zenith-merged');
        api.append(block);
    }
}

function init() {
    if (devMode()) {
        document.body.classList.add('zenith-dev');
        return;
    }
    document.body.classList.add('zenith-ui');
    renameThings();
    addHomeButton();
    mergeSettings();
}

jQuery(async () => {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE, eventSource, eventTypes } = ctx();

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'zenith-dev',
        helpString: 'Creator mode: shows every hidden setting. /zenith-dev on | off (the page reloads).',
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'on or off', typeList: [ARGUMENT_TYPE.STRING], isRequired: true })],
        callback: async (_args, value) => {
            const on = String(value).trim().toLowerCase() !== 'off';
            try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch { return 'Could not save the setting in this browser.'; }
            setTimeout(() => location.reload(), 400);
            return on ? 'Creator mode on. Reloading...' : 'Creator mode off. Reloading...';
        },
    }));

    init();
    if (devMode()) return;

    await loadPresets();
    eventSource.on(eventTypes.APP_READY, () => { defaultToOpenRouter(); applyPresets(); mountStreamingSwitch(); applyStreaming(); setTimeout(activateStarterWorlds, 1500); setTimeout(applyStarterTheme, 1500); });
    eventSource.on(eventTypes.CHAT_CHANGED, () => { applyPresets(); applyStreaming(); });
    eventSource.on(eventTypes.CHATCOMPLETION_MODEL_CHANGED ?? 'chatcompletion_model_changed', applyPresets);
});
