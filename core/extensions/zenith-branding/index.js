/*
 * Zenith Branding - shows "ZenithTavern" instead of "SillyTavern" in the interface.
 *
 * It changes only what is DISPLAYED (menus, popups, the tab title). It never touches:
 *   - the chat itself (your messages and the characters' messages),
 *   - text inside links that point to SillyTavern (docs, Discord, GitHub keep their honest names),
 *   - anything marked data-keep-brand (e.g. the credit line in the welcome popup),
 *   - code blocks, text boxes, or any file on disk.
 * To change the name, edit the two constants below.
 */

const FROM = /SillyTavern/g;
const TO = 'ZenithTavern';
const ATTRIBUTES = ['title', 'placeholder', 'alt', 'aria-label'];
const NEVER_INSIDE = '#chat, textarea, input, code, pre, script, style, [contenteditable="true"], [data-keep-brand]';

function isProtected(element) {
    if (!element || element.closest(NEVER_INSIDE)) return true;
    const link = element.closest('a');
    return Boolean(link && /sillytavern/i.test(link.getAttribute('href') || ''));
}

function rewrite(text, element) {
    // The version line keeps the engine's real name and number, which is useful when asking for help.
    if (element.closest('#version_display, #version_display_welcome')) {
        return /^SillyTavern\b/.test(text) ? `${TO} (${text})` : text;
    }
    return text.replace(FROM, TO);
}

function fixTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.includes('SillyTavern')) return;
    const element = node.parentElement;
    if (isProtected(element)) return;
    const updated = rewrite(node.nodeValue, element);
    if (updated !== node.nodeValue) node.nodeValue = updated;
}

function fixAttributes(element) {
    if (isProtected(element)) return;
    for (const name of ATTRIBUTES) {
        const value = element.getAttribute?.(name);
        if (value && value.includes('SillyTavern')) element.setAttribute(name, value.replace(FROM, TO));
    }
}

function fixTree(root) {
    if (root.nodeType === Node.TEXT_NODE) return fixTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    fixAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) fixTextNode(node);
    root.querySelectorAll?.(ATTRIBUTES.map(a => `[${a}*="SillyTavern"]`).join(',')).forEach(fixAttributes);
}

function fixTitle() {
    if (document.title.includes('SillyTavern')) document.title = document.title.replace(FROM, TO);
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        const target = mutation.target.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
        if (target?.closest?.('#chat')) continue; // cheap exit: chat streaming makes a lot of mutations
        if (mutation.type === 'childList') mutation.addedNodes.forEach(fixTree);
        else if (mutation.type === 'characterData') fixTextNode(mutation.target);
        else if (mutation.type === 'attributes') fixAttributes(mutation.target);
    }
    fixTitle();
});

function start() {
    fixTitle();
    fixTree(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
    const titleElement = document.querySelector('title');
    if (titleElement) new MutationObserver(fixTitle).observe(titleElement, { childList: true, characterData: true, subtree: true });
}

start();
