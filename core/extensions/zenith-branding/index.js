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
let zenithNumber = ''; // the ZenithTavern version number, shown in the version line (see showNumber)
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
        return /^SillyTavern\b/.test(text) ? `${TO}${zenithNumber ? ' v' + zenithNumber : ''} (${text})` : text;
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

// The version line reads "ZenithTavern v0.3.5 (SillyTavern 1.19.0)" so you can see at a glance which version you run.
async function showNumber() {
    try {
        const res = await fetch('/api/plugins/zenith-system/version', { headers: SillyTavern.getContext().getRequestHeaders() });
        zenithNumber = String((await res.json()).version || '');
    } catch { return; }
    if (!zenithNumber) return;
    for (const el of document.querySelectorAll('#version_display, #version_display_welcome')) {
        for (const node of el.childNodes) {
            if (node.nodeType === 3 && /^ZenithTavern \(/.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(/^ZenithTavern /, `ZenithTavern v${zenithNumber} `);
        }
    }
}
jQuery(showNumber);
