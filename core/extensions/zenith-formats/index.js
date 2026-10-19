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
            example: '¦¦ Monday, Sep 7th ~ 8:55 PM ~ Place Name ~ (OPAL) ¦¦\n¦¦ DAY 2/14 ¦¦\n¦¦ Extra line here ¦¦',
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
            id: 'zdroid',
            name: 'Z-Droid (phone texting)',
            example: 'Z-Droid¦Zenet - Alex¦85%\nTexting¦Sam\nIncoming¦2:34 PM¦Sam¦Incoming message text here\nOutgoing¦2:36 PM¦Sam¦Your reply text here',
            // a block starts at a line that begins with one of these words and the separator
            starts: ['z-droid', 'zdroid', 'phone'],
            // lines that continue the block
            lines: ['z-droid', 'zdroid', 'phone', 'texting', 'incoming', 'outgoing'],
            render(lines) {
                let title = 'Z-Droid', battery = '', contact = '';
                const msgs = [];
                for (const line of lines) {
                    const p = parts(line);
                    const k = p[0].toLowerCase();
                    if (k === 'phone' || k === 'z-droid' || k === 'zdroid') { title = p[1] || title; battery = p[2] || ''; }
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
        // ------------------------------------------------------------ Discord
        {
            id: 'discord',
            name: 'Discord (chat)',
            example: 'Discord¦general\nMessage¦🦊¦Alex¦Today at 11:05 PM¦Message text goes here.¦💗 WYLD\nMessage¦🤖¦Helper¦Today at 11:06 PM¦Another message from a bot.¦✓ APP\nMessage¦🌸¦Sam¦Today at 11:07 PM¦A third message from someone else.¦¦#ff7ab2',
            starts: ['discord'],
            lines: ['discord', 'message'],
            render(lines) {
                let channel = 'general';
                const msgs = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'discord') channel = (p[1] || channel).replace(/^#/, '');
                    else msgs.push({ av: p[1] || '🙂', name: p[2] || 'User', time: p[3] || '', text: p[4] || '', tag: p[5] || '', color: /^#[0-9a-f]{3,8}$/i.test(p[6] || '') ? p[6] : '' });
                }
                const hue = (n) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
                const tagHtml = (t) => (!t ? '' : /app$/i.test(t) ? `<span class="zf-dtag zf-dapp">${esc(t)}</span>` : `<span class="zf-dtag">${esc(t)}</span>`);
                return `<div class="zf-card zf-discord">
<div class="zf-dhead"><span class="zf-dhash">#</span>${esc(channel)}</div>
${msgs.map((m) => `<div class="zf-dmsg"><div class="zf-dav" style="background:hsl(${hue(m.name)} 45% 38%)">${esc(m.av)}</div><div class="zf-dbody"><div class="zf-dtop"><span class="zf-dname"${m.color ? ` style="color:${m.color}"` : ''}>${esc(m.name)}</span>${tagHtml(m.tag)}<span class="zf-dtime">${esc(m.time)}</span></div><div class="zf-dtext">${esc(m.text)}</div></div></div>`).join('')}
</div>`;
            },
        },
        // ------------------------------------------------------------ Whiteboard (classroom)
        {
            id: 'whiteboard',
            name: 'Whiteboard (classroom)',
            example: 'Whiteboard¦Lesson Title Here\nWrite¦First line the teacher writes goes here\nWrite¦Second line of the lesson goes here\nWrite¦Important point to remember¦red\nWrite¦A note in another color¦blue\nWrite¦Homework: text goes here',
            starts: ['whiteboard'],
            lines: ['whiteboard', 'write', 'note', 'scribble'],
            render(lines) {
                let title = '';
                const rows = [];
                const cols = { red: 'red', blue: 'blue', green: 'green', black: '' };
                lines.forEach((l, i) => {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'whiteboard') { title = p[1] || ''; return; }
                    const last = (p[p.length - 1] || '').toLowerCase();
                    const hasCol = p.length >= 3 && last in cols;
                    const text = (hasCol ? p.slice(1, -1) : p.slice(1)).join(' ');
                    rows.push(`<div class="zf-wline${hasCol && cols[last] ? ' zf-wc-' + cols[last] : ''}" style="--r:${((i * 7) % 5 - 2) * 0.25}deg">${esc(text)}</div>`);
                });
                return `<div class="zf-card zf-whiteboard"><div class="zf-wsurface">${title ? `<div class="zf-wtitle">${esc(title)}</div>` : ''}${rows.join('')}</div><div class="zf-wtray"><i class="zf-mk zf-mk-k"></i><i class="zf-mk zf-mk-r"></i><i class="zf-mk zf-mk-b"></i><i class="zf-er"></i></div></div>`;
            },
        },
        // ------------------------------------------------------------ Clipboard
        {
            id: 'clipboard',
            name: 'Clipboard (checklist)',
            example: 'Clipboard¦Checklist\nItem¦x¦Finished item text here\nItem¦x¦Another finished item\nItem¦ ¦Item still to do\nItem¦ ¦Another item still to do',
            starts: ['clipboard'],
            lines: ['clipboard', 'item'],
            render(lines) {
                let title = '';
                const items = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'clipboard') title = p[1] || '';
                    else items.push({ done: /^(x|\[x\]|✓|yes|done)$/i.test(p[1] || ''), text: p.slice(2).join(' ') });
                }
                return `<div class="zf-card zf-clip"><div class="zf-cclip"></div><div class="zf-cpaper">${title ? `<div class="zf-ctitle">${esc(title)}</div>` : ''}${items.map((i) => `<div class="zf-citem${i.done ? ' zf-cdone' : ''}"><span class="zf-cbox">${i.done ? '✓' : ''}</span><span>${esc(i.text)}</span></div>`).join('')}</div></div>`;
            },
        },
        // ------------------------------------------------------------ Clipboard (report)
        {
            id: 'report',
            name: 'Clipboard (report / notes)',
            example: 'Report¦Report Title Here\nField¦Date¦Mon, Sep 7th\nField¦Author¦Name Here\nSection¦Objective¦Text describing the objective goes here.\nSection¦Overview¦A longer overview of the situation goes here.\nSection¦Observations¦What was seen and noted goes here.\nSection¦Conclusion¦Closing remarks go here.',
            starts: ['report'],
            lines: ['report', 'field', 'section'],
            render(lines) {
                let title = '';
                const fields = [], secs = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'report') title = p[1] || '';
                    else if (k === 'field') fields.push(`<div><b>${esc(p[1] || '')}</b><span>${esc(p.slice(2).join(' '))}</span></div>`);
                    else if (p.length >= 3) secs.push(`<div class="zf-csec"><b>${esc(p[1])}</b><p>${esc(p.slice(2).join(' '))}</p></div>`);
                    else secs.push(`<div class="zf-csec"><p>${esc(p[1] || '')}</p></div>`);
                }
                return `<div class="zf-card zf-clip zf-clip2"><div class="zf-cclip"></div><div class="zf-cpaper zf-cpaper2">${title ? `<div class="zf-ctitle">${esc(title)}</div>` : ''}${fields.length ? `<div class="zf-cfields">${fields.join('')}</div>` : ''}${secs.join('')}</div></div>`;
            },
        },
        // ------------------------------------------------------------ Terminal
        {
            id: 'terminal',
            name: 'Terminal (console)',
            example: 'Terminal¦user@host:~\nRun¦command goes here\nOut¦Output text goes here\nOut¦More output text\nWarn¦A warning line\nErr¦An error line\nRun¦another command',
            starts: ['terminal'],
            lines: ['terminal', 'run', 'out', 'warn', 'err'],
            render(lines) {
                let host = 'user@host:~';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase(), t = p.slice(1).join(' ');
                    if (k === 'terminal') host = p[1] || host;
                    else if (k === 'run') rows.push(`<div><span class="zf-tp">${esc(host)}$</span> ${esc(t)}</div>`);
                    else rows.push(`<div class="zf-t-${k}">${esc(t)}</div>`);
                }
                return `<div class="zf-card zf-term"><div class="zf-tbar"><i></i><i></i><i></i><span>${esc(host)}</span></div><div class="zf-tbody">${rows.join('')}<div><span class="zf-tp">${esc(host)}$</span> <span class="zf-tcur"></span></div></div></div>`;
            },
        },
        // ------------------------------------------------------------ Email
        {
            id: 'email',
            name: 'Email',
            example: 'Email¦sender@example.com¦you@example.com¦Subject line here¦Mon, 7 Sep, 9:41 AM\nBody¦First paragraph of the email goes here.\nBody¦Second paragraph of the email goes here.\nBody¦Closing line, Sender',
            starts: ['email'],
            lines: ['email', 'body'],
            render(lines) {
                let from = '', to = '', subj = '', date = '';
                const body = [];
                for (const l of lines) {
                    const p = parts(l);
                    if (p[0].toLowerCase() === 'email') [, from = '', to = '', subj = '', date = ''] = p;
                    else body.push(`<p>${esc(p.slice(1).join(' '))}</p>`);
                }
                return `<div class="zf-card zf-email"><div class="zf-esub">${esc(subj)}</div><div class="zf-emeta"><div class="zf-eav">${esc((from || '?')[0].toUpperCase())}</div><div><b>${esc(from)}</b><small>to ${esc(to)}</small></div><span>${esc(date)}</span></div><div class="zf-ebody">${body.join('')}</div></div>`;
            },
        },
        // ------------------------------------------------------------ Social post
        {
            id: 'post',
            name: 'Social post',
            example: 'Post¦🦊¦Alex¦@alex¦2h¦Post text goes here, with #hashtags if you like.¦128¦14¦9\nPost¦🌸¦Sam¦@sam¦1h¦A second post from someone else.¦52¦3¦1',
            starts: ['post'],
            lines: ['post'],
            render(lines) {
                return `<div class="zf-card zf-posts">${lines.map((l) => {
                    const p = parts(l);
                    return `<div class="zf-post"><div class="zf-pav">${esc(p[1] || '🙂')}</div><div class="zf-pbody"><div class="zf-ptop"><b>${esc(p[2] || '')}</b><span>${esc(p[3] || '')} · ${esc(p[4] || '')}</span></div><div class="zf-ptext">${esc(p[5] || '')}</div><div class="zf-pstats"><span>💬 ${esc(p[7] || '0')}</span><span>🔁 ${esc(p[8] || '0')}</span><span>♥ ${esc(p[6] || '0')}</span></div></div></div>`;
                }).join('')}</div>`;
            },
        },
        // ------------------------------------------------------------ Diary
        {
            id: 'diary',
            name: 'Diary page',
            example: 'Diary¦Monday, Sep 7th¦Cloudy, a little cold\nEntry¦First paragraph of the diary entry goes here.\nEntry¦Second paragraph of the diary entry goes here.\nEntry¦Closing line of the entry.',
            starts: ['diary'],
            lines: ['diary', 'entry'],
            render(lines) {
                let date = '', mood = '';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l);
                    if (p[0].toLowerCase() === 'diary') [, date = '', mood = ''] = p; else rows.push(`<p>${esc(p.slice(1).join(' '))}</p>`);
                }
                return `<div class="zf-card zf-diary"><div class="zf-dyhead"><b>${esc(date)}</b>${mood ? `<span>${esc(mood)}</span>` : ''}</div>${rows.join('')}</div>`;
            },
        },
        // ------------------------------------------------------------ News
        {
            id: 'news',
            name: 'News article',
            example: 'News¦Headline text goes here¦The Asterhaven Courier¦Mon, Sep 7th\nStory¦First paragraph of the article goes here, giving the main facts.\nStory¦Second paragraph of the article goes here with a little more detail.',
            starts: ['news'],
            lines: ['news', 'story'],
            render(lines) {
                let head = '', src = '', date = '';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l);
                    if (p[0].toLowerCase() === 'news') [, head = '', src = '', date = ''] = p; else rows.push(`<p>${esc(p.slice(1).join(' '))}</p>`);
                }
                return `<div class="zf-card zf-news"><div class="zf-nsrc"><b>${esc(src)}</b><span>${esc(date)}</span></div><div class="zf-nhead">${esc(head)}</div><div class="zf-nbody">${rows.join('')}</div></div>`;
            },
        },
        // ------------------------------------------------------------ Receipt
        {
            id: 'receipt',
            name: 'Receipt',
            example: 'Receipt¦Store Name¦Sep 7, 6:42 PM\nBuy¦Item one¦3.50\nBuy¦Item two¦4.25\nBuy¦Item three¦1.00\nTotal¦8.75',
            starts: ['receipt'],
            lines: ['receipt', 'buy', 'total'],
            render(lines) {
                let store = '', date = '', total = '';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'receipt') [, store = '', date = ''] = p;
                    else if (k === 'total') total = p[1] || '';
                    else rows.push(`<div class="zf-rrow"><span>${esc(p[1] || '')}</span><span>${esc(p[2] || '')}</span></div>`);
                }
                return `<div class="zf-card zf-receipt"><div class="zf-rstore">${esc(store)}</div><div class="zf-rdate">${esc(date)}</div><div class="zf-rline"></div>${rows.join('')}<div class="zf-rline"></div><div class="zf-rrow zf-rtotal"><span>TOTAL</span><span>${esc(total)}</span></div><div class="zf-rthx">THANK YOU</div></div>`;
            },
        },
        // ------------------------------------------------------------ Radio
        {
            id: 'radio',
            name: 'Radio broadcast',
            example: 'Radio¦WAST 88.1¦Late Night Show\nSay¦Host¦Spoken text of the radio host goes here.\nSong¦Song Title Here¦Artist Name\nSay¦Caller¦A caller says something here.',
            starts: ['radio'],
            lines: ['radio', 'say', 'song'],
            render(lines) {
                let st = '', show = '';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l), k = p[0].toLowerCase();
                    if (k === 'radio') [, st = '', show = ''] = p;
                    else if (k === 'song') rows.push(`<div class="zf-rsong">♪ <b>${esc(p[1] || '')}</b> <span>${esc(p[2] || '')}</span></div>`);
                    else rows.push(`<div class="zf-rsay"><b>${esc(p[1] || '')}</b><span>${esc(p.slice(2).join(' '))}</span></div>`);
                }
                return `<div class="zf-card zf-radio"><div class="zf-rtop"><span class="zf-air">● ON AIR</span><b>${esc(st)}</b><small>${esc(show)}</small></div>${rows.join('')}</div>`;
            },
        },
        // ------------------------------------------------------------ Status
        {
            id: 'status',
            name: 'Status screen',
            example: 'Status¦Alex¦Level 3 student\nStat¦Energy¦70¦100\nStat¦Mood¦55¦100\nStat¦Money¦20¦100\nStat¦Focus¦90¦100',
            starts: ['status'],
            lines: ['status', 'stat'],
            render(lines) {
                let name = '', sub = '';
                const rows = [];
                for (const l of lines) {
                    const p = parts(l);
                    if (p[0].toLowerCase() === 'status') [, name = '', sub = ''] = p;
                    else {
                        const v = parseFloat(p[2]) || 0, max = parseFloat(p[3]) || 100;
                        rows.push(`<div class="zf-srow"><span>${esc(p[1] || '')}</span><i><b style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></b></i><em>${esc(p[2] || '0')}/${esc(String(max))}</em></div>`);
                    }
                }
                return `<div class="zf-card zf-status"><div class="zf-sname">${esc(name)}</div>${sub ? `<div class="zf-ssub">${esc(sub)}</div>` : ''}${rows.join('')}</div>`;
            },
        },
        // ------------------------------------------------------------ Student ID
        {
            id: 'idcard',
            name: 'Student ID card',
            example: 'ID¦Alex Example¦3rd year¦Marine Biology¦Marlowe Hall 218¦🦊',
            starts: ['id'],
            lines: ['id'],
            render(lines) {
                const p = parts(lines[0]);
                return `<div class="zf-card zf-id"><div class="zf-idtop">ASTERHAVEN UNIVERSITY<small>STUDENT ID</small></div><div class="zf-idmain"><div class="zf-idpic">${esc(p[5] || '🙂')}</div><div class="zf-idinfo"><b>${esc(p[1] || '')}</b><span>${esc(p[2] || '')}</span><span>${esc(p[3] || '')}</span><span>${esc(p[4] || '')}</span></div></div><div class="zf-idbar"></div></div>`;
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
            if (!p.textContent.includes(SEP) || p.closest('.zf-phone, .zf-header, .zf-card')) continue;
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
    const preview = (f) => { try { return f.render(f.example.split('\n')); } catch (e) { return ''; } };
    window.ZenithFormats = { FORMATS, process, all, preview };
    (window.SillyTavern?.getContext ? start : () => window.addEventListener('load', start))();
})();
