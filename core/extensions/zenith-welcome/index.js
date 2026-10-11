/*
 * Zenith Welcome - customizes SillyTavern's first-run popup without editing SillyTavern.
 *
 * How it works (read this if you want to change the popup):
 *  - SillyTavern builds the popup from a hidden template in index.html (#onboarding_template).
 *    Extensions are loaded BEFORE the popup is shown, so we can rewrite that template first.   -> rewriteTemplate()
 *  - The persona name box is added by SillyTavern after the template, so the risk notice that
 *    must appear BELOW it is inserted after the popup opens.                                   -> watchForPopup()
 *  - "Yes" presses SillyTavern's own (hidden) Save button, so the popup closes normally.
 *  - "No" asks the server plugin to shut down; the launcher window then closes itself.
 *  - The popup only appears on a fresh profile. Saying "Yes" is remembered by SillyTavern,
 *    so it is not shown again. Saying "No" remembers nothing: it asks again next time.
 */

const APP_NAME = 'ZenithTavern';

const RISK_TEXT = 'THIS FORK, AS PROMISING AS IT MAY (OR MAY NOT) LOOK, CAN HAVE SOME SETTINGS THAT MAY NOT BE TO ALL PUBLIC. '
    + 'YOU WILL BE ENTERING AT YOUR OWN RISK. DO YOU CONFIRM?';

/** Edit the hidden template: new title, remove the "Looking for AI characters?" block. */
function rewriteTemplate() {
    const template = document.querySelector('#onboarding_template .onboarding');
    if (!template || template.dataset.zenith) return;
    template.dataset.zenith = '1';

    const title = template.querySelector(':scope > h3');
    if (title) {
        title.setAttribute('data-i18n', 'zenith_welcome_title'); // stop SillyTavern's translator from restoring the old text
        title.textContent = `Welcome to ${APP_NAME}!`;
    }

    // Credit + honesty: the help links below lead to SillyTavern's own docs and community.
    const links = template.querySelector(':scope > ul');
    if (links) {
        const credit = document.createElement('p');
        credit.dataset.keepBrand = '1'; // Zenith Branding must not rewrite this line
        credit.style.fontSize = '0.85em';
        credit.style.opacity = '0.75';
        credit.textContent = `${APP_NAME} is built on the open-source SillyTavern (AGPL-3.0). `
            + `The links above lead to SillyTavern's own documentation and community.`;
        links.after(credit);
    }

    const characters = template.querySelector('.external_import_button')?.closest('.textAlignCenter');
    if (characters) {
        const spacer = characters.previousElementSibling;
        characters.remove();
        if (spacer?.classList.contains('expander')) spacer.remove();
    }
}

/** Shown after "No" (or if the server could not be closed automatically). */
function showDeclined(closedAutomatically) {
    document.body.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'zenith-declined';
    box.textContent = closedAutomatically
        ? `${APP_NAME} has been closed. You can close this tab.`
        : `Please close the ${APP_NAME} window (the black console window) and this tab.`;
    document.body.append(box);
}

async function decline() {
    const { getRequestHeaders } = SillyTavern.getContext();
    try {
        const response = await fetch('/api/plugins/zenith-system/decline', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
        });
        showDeclined(response.ok);
    } catch {
        // The server may already be gone, which is what we wanted.
        showDeclined(true);
    }
}

/** Add the risk notice + Yes/No under the persona name, and block ways to skip it. */
function attachGate(content) {
    if (content.dataset.zenithGate) return;
    const dialog = content.closest('dialog');
    const input = dialog?.querySelector('.popup-input');
    const okButton = dialog?.querySelector('.popup-button-ok');
    if (!dialog || !input || !okButton) return; // popup not fully built yet; try again on next change
    content.dataset.zenithGate = '1';

    okButton.style.display = 'none'; // "Yes" replaces the Save button

    const box = document.createElement('div');
    box.className = 'zenith-risk';
    box.innerHTML = '<p class="zenith-risk-text"></p>'
        + '<div class="zenith-risk-buttons">'
        + '<button type="button" class="menu_button zenith-yes">Yes</button>'
        + '<button type="button" class="menu_button zenith-no">No</button>'
        + '</div>';
    box.querySelector('.zenith-risk-text').textContent = RISK_TEXT;
    input.after(box);

    box.querySelector('.zenith-yes').addEventListener('click', () => {
        box.querySelectorAll('button').forEach(b => { b.disabled = true; });
        okButton.click(); // saves the persona name and closes the popup, exactly like Save did
    });
    box.querySelector('.zenith-no').addEventListener('click', () => {
        box.querySelectorAll('button').forEach(b => { b.disabled = true; });
        decline();
    });

    // Escape or clicking outside must not be a way around the question.
    dialog.addEventListener('cancel', (event) => event.preventDefault());
}

function watchForPopup() {
    // Escape is handled by SillyTavern's own popup code; swallow it first while our notice is on screen.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.querySelector('.zenith-risk')) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    const observer = new MutationObserver(() => {
        document.querySelectorAll('dialog .onboarding:not([data-zenith-gate])').forEach(attachGate);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

rewriteTemplate();
watchForPopup();
