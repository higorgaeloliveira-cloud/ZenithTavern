// Zenith Formats: turns plain text blocks typed in a message into styled cards.
// Add a new format by pushing one object into FORMATS (see the Phone one).
(() => {
    const SEP = '¦';
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const parts = (line) => line.split(SEP).map((p) => p.trim());
    const key = (line) => (line.split(SEP)[0] || '').trim().toLowerCase();

    const FORMATS = [
        {
            id: 'header',
            name: 'Header (place, date, time)',
            example: '¦¦ Wednesday, Oct 27th ~ 8:55 PM ~ Kinji\'s Residence ~ (SAPH) ¦¦\n¦¦ DAY 2/14 ¦¦\n¦¦ Collar Status: [Active] ¦¦',
            test: (line) => /^¦¦.*¦¦$/.test(line.trim()),
            cont: (line) => /^¦¦.*¦¦$/.test(line.trim()),
            render(lines) {
                const cells = (l) => l.trim().replace(/^¦¦\s*/, '').replace(/\s*¦¦$/, '').split('~').map((x) => x.trim()).filter(Boolean);
                const [main, ...extra] = lines;
                const [date = '', time = '', place = '', tag = ''] = cells(main);
                const chips = extra.map((l) => cells(l).join(' ~ ')).filter(Boolean);
                return `<div class="zf-header">
${place ? `<div class="zf-place">${esc(place)}</div>` : ''}
<div class="zf-meta">${tag ? `<span class="zf-tag"><i class="fa-solid fa-circle-nodes"></i> ${esc(tag.replace(/^\(|\)$/g, ''))}</span>` : ''}${date ? `<span>${esc(date)}</span>` : ''}${time ? `<span>${esc(time)}</span>` : ''}</div>
${chips.length ? `<div class="zf-chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
</div>`;
            },
        },
        {
            id: 'phone',
            name: 'Phone (texting)',
            example: 'Phone¦Weynet - Kinji¦85%\nTexting¦Lurkle\nIncoming¦2:34 PM¦Lurkle¦u a stalker or something? lol\nOutgoing¦2:36 PM¦Lurkle¦who is this',
            // a block starts at a line that begins with one of these words and the separator
            starts: ['phone'],
            // lines that continue the block
            lines: ['phone', 'texting', 'incoming', 'outgoing'],
            render(lines) {
                let title = 'Phone', battery = '', contact = '';
                const msgs = [];
                for (const line of lines) {
                    const p = parts(line);
                    const k = p[0].toLowerCase();
                    if (k === 'phone') { title = p[1] || title; battery = p[2] || ''; }
                    else if (k === 'texting') contact = p.slice(1).join(' ');
                    else if (k === 'incoming' || k === 'outgoing') {
                        // Incoming¦time¦name¦text   or   Outgoing¦time¦text   (name is optional)
                        const time = p[1] || '';
                        const hasName = p.length >= 4;
                        msgs.push({ out: k === 'outgoing', time, name: hasName ? p[2] : '', text: (hasName ? p.slice(3) : p.slice(2)).join(` ${SEP} `) });
                    }
                }
                const pct = parseInt(battery, 10);
                const bat = battery ? `<span class="zf-bat">${esc(battery)}<i class="zf-batt"><b style="width:${Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 100}%"></b></i></span>` : '';
                return `<div class="zf-phone">
<div class="zf-bar"><span class="zf-title">${esc(title)}</span>${bat}</div>
${contact ? `<div class="zf-contact">✧ ${esc(contact)} ✧</div>` : ''}
<div class="zf-msgs">${msgs.map((m) => `<div class="zf-msg ${m.out ? 'zf-out' : 'zf-in'}">${m.name ? `<div class="zf-name">${esc(m.name)}</div>` : ''}<div class="zf-text">${esc(m.text)}</div><div class="zf-time">${esc(m.time)}</div></div>`).join('')}</div>
<div class="zf-input"><span>Type a message...</span><b>Send</b></div>
</div>`;
            },
        },
    ];

    const startsOf = (line) => FORMATS.find((f) => (f.test ? f.test(line) : line.includes(SEP) && f.starts.includes(key(line))));
    const continues = (f, line) => (f.cont ? f.cont(line) : line.includes(SEP) && f.lines.includes(key(line)));

    /** Splits the visible text of one element into lines (keeps <br> breaks as line breaks). */
    function linesOf(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
        return clone.textContent.split('\n');
    }

    function process(mes) {
        const root = mes.querySelector('.mes_text');
        if (!root || root.dataset.zfDone === root.textContent.length + '') return;
        if (!root.textContent.includes(SEP)) return;
        for (const p of [...root.querySelectorAll('p')]) {
            if (!p.textContent.includes(SEP) || p.closest('.zf-phone, .zf-header')) continue;
            const lines = linesOf(p);
            const out = [];
            let i = 0, changed = false;
            while (i < lines.length) {
                const fmt = startsOf(lines[i].trim());
                if (!fmt) { out.push(esc(lines[i])); i++; continue; }
                const block = [];
                for (;;) {
                    let j = i;
                    while (j < lines.length && !lines[j].trim()) j++; // blank lines left by <br>
                    if (j < lines.length && continues(fmt, lines[j])) { block.push(lines[j].trim()); i = j + 1; } else break;
                }
                out.push(fmt.render(block));
                changed = true;
            }
            if (!changed) continue;
            const holder = document.createElement('div');
            holder.className = 'zf-holder';
            holder.innerHTML = out.map((o) => (/^<div class="zf-/.test(o) ? o : `<p>${o}</p>`)).join('');
            p.replaceWith(...holder.childNodes);
        }
        root.dataset.zfDone = root.textContent.length + '';
    }

    const all = () => document.querySelectorAll('#chat .mes').forEach(process);
    function start() {
        const { eventSource, eventTypes } = SillyTavern.getContext();
        const one = (id) => setTimeout(() => { const m = document.querySelector(`#chat .mes[mesid="${id}"]`); m ? process(m) : all(); }, 0);
        for (const ev of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED, eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_SWIPED]) if (ev) eventSource.on(ev, one);
        eventSource.on(eventTypes.CHAT_CHANGED, () => setTimeout(all, 400));
        setTimeout(all, 800);
        // safety net: any change in the chat (new message, edit, swipe) is checked once things settle
        let t = null;
        const chat = document.getElementById('chat');
        if (chat) new MutationObserver(() => { clearTimeout(t); t = setTimeout(all, 150); }).observe(chat, { childList: true, subtree: true, characterData: true });
    }
    window.ZenithFormats = { FORMATS, process, all };
    (window.SillyTavern?.getContext ? start : () => window.addEventListener('load', start))();
})();
