/*
 * Zenith Expressions - makes SillyTavern's built-in Character Expressions show a character's sprites out of the box.
 * Roster sprites are installed to characters/<Name>/ (that is where the built-in extension looks). This only sets defaults, once:
 *  - classifier = the chat model itself (no model download), only sprites the character really has are offered,
 *  - missing expressions fall back to neutral (so a half-finished set still works).
 * Change anything later in Extensions > Character Expressions; it is never overwritten. /zenith-expressions reset re-applies the defaults.
 */
(() => {
    const FLAG = 'zenith_expressions_init';
    const apply = (force) => {
        const c = SillyTavern.getContext();
        const s = (c.extensionSettings.expressions ??= {});
        if (!force && s[FLAG]) return;
        s.api = 2;                       // 2 = LLM (the connected chat model)
        s.filterAvailable = true;        // only offer expressions the character has a sprite for
        s.fallback_expression = 'neutral';
        s.showDefault = false;           // no placeholder image when a character has no sprites
        s[FLAG] = true;
        c.saveSettingsDebounced?.();
    };
    const start = () => {
        try { apply(false); } catch (e) { console.warn('[Zenith Expressions]', e); }
        try {
            const { SlashCommandParser, SlashCommand } = SillyTavern.getContext();
            SlashCommandParser?.addCommandObject?.(SlashCommand.fromProps({
                name: 'zenith-expressions',
                helpString: 'reset - re-apply the ZenithTavern expression defaults (model-based classifier, neutral fallback)',
                callback: (_a, v) => { apply(String(v).trim() === 'reset'); return 'Expression defaults applied.'; },
            }));
        } catch { /* optional */ }
    };
    const c = SillyTavern.getContext();
    c.eventSource.on(c.eventTypes.APP_READY, start);
})();
