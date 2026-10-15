// Zenith Welcome: version + release date in the welcome title, and the "Messages Available" counter.
(() => {
    const ctx = () => SillyTavern.getContext();
    const LS = 'zenith_usage';
    const read = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
    const write = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* ignore */ } };
    let info = { version: '', released: '' };
    let usage = null;
    let busy = false;

    const niceDate = (iso) => { try { return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; } };
    const money = (n) => (n > 0 && n < 0.1 ? `$${Number(n).toFixed(4)}` : `$${Number(n).toFixed(2)}`);

    function estimate() {
        if (!usage?.ok) return null;
        const st = read();
        const costs = (st.costs || []).filter((c) => c > 0);
        if (usage.left == null) return { text: '∞', sub: 'No limit on this key' };
        if (!costs.length) return { text: '—', sub: `${money(usage.left)} credit left. The number appears after your first reply.` };
        const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
        return { text: `~${Math.max(0, Math.floor(usage.left / avg)).toLocaleString()}`, sub: `${money(usage.left)} credit left · about ${money(avg)} per message` };
    }

    function paint() {
        for (const root of document.querySelectorAll('.welcomePanel')) {
            const v = root.querySelector('.welcomeHeaderVersionDisplay');
            if (v && info.version && !v.dataset.zw) {
                v.dataset.zw = '1';
                v.title = v.textContent.trim();
                v.textContent = `ZenithTavern v${info.version}${info.released ? ` · updated ${niceDate(info.released)}` : ''}`;
            }
            let card = root.querySelector('.zw-usage');
            if (!card) {
                card = document.createElement('div');
                card.className = 'zw-usage';
                card.innerHTML = '<div class="zw-main"><span class="zw-label">Messages Available:</span> <b class="zw-num">…</b></div><div class="zw-sub"></div><button type="button" class="zw-btn" title="Refresh"><i class="fa-solid fa-rotate"></i></button><button type="button" class="zw-key" title="Open API connections"><i class="fa-solid fa-key"></i></button>';
                card.querySelector('.zw-btn').addEventListener('click', () => refresh(true));
                card.querySelector('.zw-key').addEventListener('click', () => document.getElementById('API-status-top')?.click());
                root.querySelector('.welcomeHeader')?.after(card);
            }
            const e = estimate();
            card.querySelector('.zw-num').textContent = e ? e.text : usage?.reason === 'no-key' ? '0' : usage ? '?' : '…';
            card.querySelector('.zw-sub').textContent = e ? e.sub
                : usage?.reason === 'no-key' ? 'Connect an OpenRouter key (key button) to see how many messages you have left.'
                : usage ? `Could not read the balance (${usage.error || 'unknown'}).` : 'Checking…';
        }
    }

    async function refresh(manual) {
        if (busy) return; busy = true;
        try {
            const res = await fetch('/api/plugins/zenith-system/usage', { headers: ctx().getRequestHeaders() });
            const next = await res.json();
            if (next.ok && !manual) {
                // every finished reply: what it cost = how much the total usage grew
                const st = read();
                if (usage?.ok && next.usage > usage.usage) { st.costs = [...(st.costs || []), next.usage - usage.usage].slice(-20); write(st); }
            }
            usage = next;
        } catch (e) { usage = { ok: false, reason: 'error', error: 'server not reachable' }; }
        busy = false; paint();
    }

    async function start() {
        try { info = await (await fetch('/api/plugins/zenith-system/version', { headers: ctx().getRequestHeaders() })).json(); } catch { /* ignore */ }
        await refresh(true);
        let t = null;
        new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 100); }).observe(document.body, { childList: true, subtree: true });
        const { eventSource, eventTypes } = ctx();
        for (const ev of [eventTypes.GENERATION_ENDED]) if (ev) eventSource.on(ev, () => setTimeout(() => refresh(false), 1500));
        paint();
    }
    (window.SillyTavern?.getContext ? start : () => window.addEventListener('load', start))();
})();
