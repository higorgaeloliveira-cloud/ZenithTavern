/*
 * ZenithTavern Core - your first extension. Read this file top to bottom; it shows the four
 * things almost every SillyTavern extension does:
 *   1. keep settings            (extensionSettings)
 *   2. show a settings panel    (settings.html)
 *   3. change what the AI sees  (the "interceptor" + setExtensionPrompt)
 *   4. add a /command           (SlashCommandParser)
 * plus how to call your own server plugin (see overlay/plugins/mytavern-server).
 */

const MODULE = 'mytavern_core';          // the key your settings are saved under
const PROMPT_KEY = 'mytavern_core_note'; // the key of the injected prompt (so we can replace/clear it)
const DEFAULTS = Object.freeze({ enabled: false, note: '' });

/** Settings are saved automatically in the user's settings.json. */
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
        extensionSettings[MODULE][key] ??= value;
    }
    return extensionSettings[MODULE];
}

/**
 * 3. The interceptor. SillyTavern calls this before every generation because manifest.json
 * says "generate_interceptor": "myTavernInterceptor". It must be a global function.
 * We don't edit the chat; we register one extra prompt, or clear it.
 */
globalThis.myTavernInterceptor = async function (chat, contextSize, abort, type) {
    const { setExtensionPrompt } = SillyTavern.getContext();
    const settings = getSettings();
    const active = settings.enabled && settings.note.trim() && type !== 'quiet';

    // setExtensionPrompt(key, text, position, depth, scan, role)
    //   position: 0 = in main prompt, 1 = inside the chat, 2 = before main prompt
    //   depth:    for position 1, how many messages from the end (0 = very end)
    //   role:     0 = system, 1 = user, 2 = assistant
    setExtensionPrompt(PROMPT_KEY, active ? settings.note.trim() : '', 1, 1, false, 0);
};

/** 2. Build the settings panel and wire it up. */
async function mountSettings() {
    const { renderExtensionTemplateAsync, saveSettingsDebounced } = SillyTavern.getContext();
    const html = await renderExtensionTemplateAsync('third-party/mytavern-core', 'settings');
    $('#extensions_settings2').append(html);

    const settings = getSettings();
    $('#mytavern_enabled').prop('checked', settings.enabled).on('input', function () {
        settings.enabled = this.checked;
        saveSettingsDebounced();
    });
    $('#mytavern_note').val(settings.note).on('input', function () {
        settings.note = this.value;
        saveSettingsDebounced();
    });

    // Calling the server plugin: GET /api/plugins/<plugin id>/<route>
    $('#mytavern_ping').on('click', async () => {
        const { getRequestHeaders } = SillyTavern.getContext();
        const out = $('#mytavern_ping_result').text('...');
        try {
            const response = await fetch('/api/plugins/mytavern-server/ping', { headers: getRequestHeaders() });
            const data = await response.json();
            out.text(`OK - server says: ${data.message}`);
        } catch (error) {
            out.text('Failed - is the server plugin enabled?');
            console.error('[ZenithTavern] ping failed', error);
        }
    });
}

/** 4. A slash command. Type /mt-hello in the chat box. */
function registerCommands() {
    const { SlashCommandParser, SlashCommand } = SillyTavern.getContext();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'mt-hello',
        helpString: 'Says hello from ZenithTavern Core and shows whether the note is on.',
        callback: async () => {
            const settings = getSettings();
            return `Hello from ZenithTavern! Note is ${settings.enabled ? 'ON' : 'OFF'}.`;
        },
    }));
}

// Entry point: runs when SillyTavern loads the extension.
jQuery(async () => {
    getSettings();
    registerCommands();
    await mountSettings();
    console.log('[ZenithTavern] core extension loaded');
});
