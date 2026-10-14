/*
 * LunaRouter - automatic fallback between models and APIs.
 *
 * You pick up to 6 models, say which connection each one uses (up to 2 connections) and in what
 * order they are tried. When a reply fails, LunaRouter sends the same request to the next model.
 *
 * How it works: SillyTavern sends every chat-completion reply to /api/backends/chat-completions/generate.
 * We wrap fetch(); for that one URL we change the "source" and "model" in the request, look at the
 * answer, and if it failed we repeat the request with the next model. API keys are never stored here:
 * each connection uses the key you saved in Settings for that API.
 */
const MODULE = 'luna_router';
const GENERATE_PATH = '/api/backends/chat-completions/generate';
const MAX_ROUTES = 6;
const TYPES = {
    off: { label: 'Not used', source: null },
    openrouter: { label: 'OpenRouter', source: 'openrouter', secret: 'api_key_openrouter' },
    custom: { label: 'LM Studio / local server (OpenAI-compatible)', source: 'custom', secret: 'api_key_custom' },
};
const OPENROUTER_ONLY_FIELDS = ['use_fallback', 'provider', 'quantizations', 'allow_fallbacks', 'middleout', 'transforms'];
const ctx = () => SillyTavern.getContext();

// ---------------------------------------------------------------- settings
function defaults() {
    return {
        enabled: false,
        connections: [
            { type: 'openrouter', url: '' },
            { type: 'off', url: 'http://127.0.0.1:1234/v1' },
        ],
        routes: [],           // in the order they are tried: { conn: 0|1, model: '' }
        retryEmpty: true,     // an empty reply counts as a failure
        switchOnFail: false,  // swap a model that keeps failing for another one from the same connection
        switchAfter: 3,       // ...after this many failures in a row
        switchMode: 'random', // random | similar (closest context length) | name (has a word in its name)
        switchWord: '',
        repeatSame: false,    // the same model may be called again after a failure
        repeatTimes: 3,       // ...up to this many calls in total before moving on / giving up
        continueCut: true,    // a reply that stopped before it was finished is continued by the next model
        timeoutSec: 0,        // give up on a model after this long without an answer (0 = never)
    };
}
function settings() {
    const { extensionSettings } = ctx();
    const base = defaults();
    const s = (extensionSettings[MODULE] ??= {});
    for (const [k, v] of Object.entries(base)) s[k] ??= v;
    return s;
}
const connLabel = (s, i) => `${TYPES[s.connections[i]?.type]?.label ?? '?'}`.replace(/ \(.*\)$/, '');
const routeLabel = (s, r) => `${connLabel(s, r.conn)}: ${r.model}`;
function activeRoutes(s) {
    return s.routes.filter((r) => r.model.trim() && s.connections[r.conn] && s.connections[r.conn].type !== 'off'
        && (s.connections[r.conn].type !== 'custom' || /^https?:\/\//i.test(s.connections[r.conn].url || '')));
}

// ---------------------------------------------------------------- the request / retry engine
let lastUsed = '';

/** Builds the request for one route. Pure function, so it is easy to test. */
function patchBody(body, route, conn) {
    const source = TYPES[conn.type].source;
    const b = { ...body };
    if (b.chat_completion_source !== source) {
        for (const k of OPENROUTER_ONLY_FIELDS) delete b[k];
        for (const k of Object.keys(b)) if (k.startsWith('custom_') && k !== 'custom_prompt_post_processing') delete b[k];
    }
    b.chat_completion_source = source;
    b.model = route.model.trim();
    if (source === 'custom') b.custom_url = conn.url.trim();
    return b;
}

/** Decides if an answer is good. Returns { ok, error }. Never throws. */
async function judge(res, isStream, retryEmpty) {
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.clone().text()).slice(0, 160); } catch { /* ignore */ }
        return { ok: false, error: `HTTP ${res.status}${detail ? ` ${detail}` : ''}` };
    }
    const probe = res.clone();
    try {
        if (!isStream) {
            const data = await probe.json().catch(() => null);
            if (!data) return { ok: true };
            if (data.error) return { ok: false, error: data.error?.message || 'the API returned an error' };
            if (Array.isArray(data.choices)) {
                const c0 = data.choices[0] || {};
                const m = c0.message ?? {};
                const text = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((p) => p?.text || '').join('') : (c0.text || ''));
                const hasText = !!String(text).trim();
                const fin = String(c0.finish_reason || c0.native_finish_reason || '').toLowerCase();
                const hitLimit = /length|max_tokens|max_output/.test(fin);
                if (!m.tool_calls?.length) {
                    // thinking models: the budget ran out while still thinking, so there is no reply at all
                    if (!hasText && (m.reasoning_content || m.reasoning || hitLimit)) return { ok: false, error: 'cut off while thinking', cut: true, data, text: '' };
                    if (!hasText && retryEmpty) return { ok: false, error: 'empty reply' };
                    // the reply stopped before it was finished: by the limit, or in the middle of a sentence
                    if (hasText && (hitLimit || (!fin && !/[.!?…"'”’*)\]~>]\s*$/.test(String(text).trim())))) return { ok: true, cut: true, data, text: String(text) };
                }
                return { ok: true, data, text: String(text) };
            }
            return { ok: true };
        }
        // streaming: wait for the first real "data:" line and look at it
        const reader = probe.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (value) text += decoder.decode(value, { stream: true });
                const line = text.split('\n').find((l) => l.startsWith('data:'));
                if (line) {
                    const payload = line.slice(5).trim();
                    if (payload && payload !== '[DONE]') {
                        try { const j = JSON.parse(payload); if (j?.error) return { ok: false, error: j.error?.message || 'the API returned an error' }; } catch { /* not JSON, fine */ }
                    } else if (payload === '[DONE]' && retryEmpty) return { ok: false, error: 'empty reply' };
                    return { ok: true };
                }
                if (done) return retryEmpty ? { ok: false, error: 'empty reply' } : { ok: true };
            }
        } finally { reader.cancel().catch(() => {}); }
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        return { ok: true }; // when in doubt, let SillyTavern deal with the answer itself
    }
}

async function tryRoute(realFetch, url, init, body, route, conn, s) {
    const parent = init.signal;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (parent) { if (parent.aborted) ctrl.abort(); else parent.addEventListener('abort', onAbort, { once: true }); }
    let timedOut = false;
    const timer = s.timeoutSec > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, s.timeoutSec * 1000) : null;
    try {
        const res = await realFetch(url, { ...init, body: JSON.stringify(patchBody(body, route, conn)), signal: ctrl.signal });
        const verdict = await judge(res, !!body.stream, s.retryEmpty);
        return { ...verdict, res };
    } catch (err) {
        if (parent?.aborted) throw err; // the user pressed Stop: never retry
        return { ok: false, error: timedOut ? `no answer after ${s.timeoutSec}s` : (err?.message || 'network error') };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------- change a model that keeps failing
const failCount = {};          // "conn:model" -> failures in a row (this session)
const swaps = {};              // "conn:model" -> replacement model (this session; cleared when the LunaRouter popup is saved)
const catalogCache = {};       // connection -> { at, list: [{ id, ctx }] }
const routeKey = (r) => `${r.conn}:${r.model.trim()}`;
const NOT_CHAT = /embed|whisper|tts|moderation|rerank|dall-?e|image|audio|speech|transcri/i;

async function catalogOf(s, connIndex) {
    const conn = s.connections[connIndex], type = TYPES[conn?.type];
    if (!type?.source) return [];
    const key = `${conn.type}|${conn.url || ''}`;
    const hit = catalogCache[key];
    if (hit && Date.now() - hit.at < 600000) return hit.list;
    try {
        const body = { chat_completion_source: type.source };
        if (type.source === 'custom') body.custom_url = conn.url.trim();
        const res = await realFetch('/api/backends/chat-completions/status', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
        const data = await res.json();
        const list = ((Array.isArray(data) ? data : data.data) || []).map((m) => ({
            id: m.id || m.name,
            ctx: Number(m.context_length ?? m.context_window ?? m.max_context_length ?? m.loaded_context_length ?? m.max_model_len ?? 0) || 0,
        })).filter((m) => m.id);
        catalogCache[key] = { at: Date.now(), list };
        return list;
    } catch { return []; }
}

/** Picks the replacement for a model that failed too many times, or null when there is none. */
async function pickSubstitute(s, route) {
    const list = await catalogOf(s, route.conn);
    const taken = new Set(s.routes.filter((r) => r.conn === route.conn).map((r) => r.model.trim()));
    const dead = new Set(Object.keys(failCount).filter((k) => failCount[k] >= Math.max(2, Number(s.switchAfter) || 3)).map((k) => k.split(':').slice(1).join(':')));
    const pool = list.filter((m) => !NOT_CHAT.test(m.id) && !taken.has(m.id) && !dead.has(m.id) && !Object.values(swaps).includes(m.id));
    if (!pool.length) return null;
    const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
    if (s.switchMode === 'name') {
        const word = String(s.switchWord || '').trim().toLowerCase();
        const hits = word ? pool.filter((m) => m.id.toLowerCase().includes(word)) : [];
        return hits.length ? random(hits).id : null;
    }
    if (s.switchMode === 'similar') {
        const mine = list.find((m) => m.id === route.model.trim())?.ctx || 0;
        const known = pool.filter((m) => m.ctx > 0);
        if (mine && known.length) {
            const dist = (m) => Math.abs(Math.log(m.ctx / mine));
            const best = Math.min(...known.map(dist));
            return random(known.filter((m) => dist(m) <= best + 0.05)).id; // the closest context length; ties are picked at random
        }
    }
    return random(pool).id;
}

async function routed(realFetch, input, init) {
    const s = settings();
    // "Call same model multiple times": each model gets up to repeatTimes calls in a row before the next model is tried
    const times = s.repeatSame ? Math.min(10, Math.max(2, Math.round(Number(s.repeatTimes) || 3))) : 1;
    const base = activeRoutes(s).map((r) => (swaps[routeKey(r)] ? { ...r, model: swaps[routeKey(r)], was: r.model } : r));
    const routes = base.flatMap((r) => Array(times).fill(r));
    const url = typeof input === 'string' ? input : input.url;
    let body;
    try { body = JSON.parse(init.body); } catch { return realFetch(input, init); }

    let lastFail = null;
    let carry = '';        // what earlier models already wrote (cut at the last finished sentence)
    let template = null;   // the first answer's JSON, reused to deliver the finished reply
    for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        const result = await tryRoute(realFetch, url, init, carry ? continuationBody(body, carry) : body, route, s.connections[route.conn], s);
        let sameNext = i + 1 < routes.length && routes[i + 1] === route;
        let next = i + 1 < routes.length ? routeLabel(s, routes[i + 1]) : '';
        let nextText = sameNext ? `${next} again (call ${(i % times) + 2}/${times})` : next;
        if (result.ok && !(result.cut && s.continueCut !== false && result.data)) {
            failCount[routeKey(route)] = 0;
            lastUsed = routeLabel(s, route);
            if (i > 0) toastr.success(`Answered by ${routeLabel(s, route)}`, 'LunaRouter');
            if (carry && result.data) return finishedResponse(result.data, join(carry, result.text || ''));
            return result.res;
        }
        if (result.ok || (result.cut && s.continueCut !== false)) {
            // a model stopped before the reply was finished: keep what it wrote and let the next model continue from there
            const kept = result.text ? cutAtSentence(carry ? join(carry, result.text) : result.text) : carry;
            template ??= result.data;
            carry = kept;
            console.warn(`[LunaRouter] ${routeLabel(s, route)} stopped before the reply was finished (${carry.length} characters kept)`);
            lastFail = result;
            if (next) toastr.warning(`${routeLabel(s, route)} stopped before finishing. ${nextText} will continue from there…`, 'LunaRouter');
            continue;
        }
        console.warn(`[LunaRouter] ${routeLabel(s, route)} failed: ${result.error}`);
        lastFail = result;
        const key = routeKey(route);
        failCount[key] = (failCount[key] || 0) + 1;
        if (s.switchOnFail && failCount[key] >= Math.max(2, Number(s.switchAfter) || 3)) {
            const sub = await pickSubstitute(s, route);
            if (sub) {
                const replacement = { ...route, model: sub, was: route.was || route.model };
                swaps[routeKey({ conn: route.conn, model: route.was || route.model })] = sub;
                toastr.warning(`${route.model} failed ${failCount[key]} times in a row. Switching to ${sub}.`, 'LunaRouter');
                let found = false;
                for (let k = i + 1; k < routes.length; k++) if (routes[k] === route) { routes[k] = replacement; found = true; }
                if (!found) routes.splice(i + 1, 0, ...Array(times).fill(replacement));
                sameNext = routes[i + 1] === replacement;
                next = routeLabel(s, routes[i + 1]);
                nextText = sameNext ? `${next} (new model)` : next;
            } else toastr.info(`${route.model} keeps failing, but no replacement model was found.`, 'LunaRouter');
        }
        if (next) toastr.warning(`${routeLabel(s, route)} failed (${String(result.error).slice(0, 80)}). Trying ${nextText}…`, 'LunaRouter');
        if (sameNext) await new Promise((r) => setTimeout(r, 700)); // a short breath before calling the same model again
    }
    if (carry && template) {
        toastr.warning('Every model stopped early. The reply was sent as far as it got.', 'LunaRouter');
        return finishedResponse(template, carry);
    }
    toastr.error('Every model in LunaRouter failed. The last error is shown by SillyTavern.', 'LunaRouter');
    if (lastFail?.res) return lastFail.res;      // let SillyTavern show its usual error
    throw new TypeError(lastFail?.error || 'LunaRouter: no model answered');
}

/** Keeps the text up to the last finished sentence, so the next model starts on a clean boundary (never mid-word). */
function cutAtSentence(text) {
    const t = String(text).replace(/\s+$/, '');
    const m = [...t.matchAll(/[.!?…]+["'”’*)\]~]*(?=\s|$)/g)].pop();
    if (m) return t.slice(0, m.index + m[0].length);
    return t.length >= 200 ? t.replace(/\s+\S*$/, '') : ''; // no finished sentence: only keep a long start, without its half-written last word
}
const join = (a, b) => (!b ? a : !a ? b : (/\s$/.test(a) || /^[\s.,;:!?)]/.test(b) ? a + b : `${a} ${b}`));

/** The same request, plus what has been written so far and a note to carry on from it. */
function continuationBody(body, carry) {
    if (!Array.isArray(body.messages)) return body;
    return { ...body, messages: [...body.messages,
        { role: 'assistant', content: carry },
        { role: 'user', content: '[The reply above was cut off before it was finished. Continue it from exactly where it stopped: no repeating, no restarting, no new header line, no note about the cut. Write only the rest of the reply, in the same voice, format and length rules.]' }] };
}

/** Builds the answer SillyTavern expects, holding the finished text. */
function finishedResponse(data, text) {
    const out = structuredClone(data);
    const c0 = out.choices[0];
    c0.finish_reason = 'stop';
    if (c0.message) { c0.message.content = text; delete c0.message.reasoning_content; delete c0.message.reasoning; } else c0.text = text;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const realFetch = window.fetch.bind(window);
window.fetch = function (input, init = {}) {
    try {
        const url = typeof input === 'string' ? input : input?.url || '';
        const s = settings();
        if (s.enabled && init.method === 'POST' && typeof init.body === 'string' && url.split('?')[0].endsWith(GENERATE_PATH) && activeRoutes(s).length) {
            return routed(realFetch, input, init);
        }
    } catch (err) { console.warn('[LunaRouter] skipped', err); }
    return realFetch(input, init);
};
window.LunaRouter = { patchBody, defaults };

// ---------------------------------------------------------------- the popup
function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
}

let secretState = {};
const modelLists = [[], []];
const modelStatus = ['', ''];

async function loadSecretState() {
    try { secretState = await (await fetch('/api/secrets/read', { method: 'POST', headers: ctx().getRequestHeaders() })).json(); } catch { secretState = {}; }
}

async function loadModels(draft, i, rerender) {
    const conn = draft.connections[i];
    const type = TYPES[conn.type];
    if (!type.source) return;
    modelStatus[i] = 'Loading…'; rerender();
    try {
        const body = { chat_completion_source: type.source };
        if (type.source === 'custom') body.custom_url = conn.url.trim();
        const res = await realFetch('/api/backends/chat-completions/status', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
        const data = await res.json();
        const list = (Array.isArray(data) ? data : data.data) || [];
        modelLists[i] = list.map((m) => m.id || m.name).filter(Boolean);
        modelStatus[i] = modelLists[i].length ? `${modelLists[i].length} models found` : (data.error ? 'Could not load models. Is it running, and is the key saved in Settings?' : 'No models listed');
    } catch { modelStatus[i] = 'Could not reach it.'; }
    rerender();
}

function buildForm(draft, rerenderOuter) {
    const root = h('div', { class: 'lr' });
    const render = () => {
        const keyNote = (i) => {
            const t = TYPES[draft.connections[i].type];
            if (!t.secret) return null;
            const saved = !!secretState[t.secret];
            return h('small', { class: saved ? 'lr-ok' : 'lr-warn' }, saved ? '✓ Key saved in Settings' : (draft.connections[i].type === 'custom' ? 'No key saved (fine for LM Studio)' : '⚠ No key saved yet. Add it in Settings (Advanced Options → Chat Completion Source → OpenRouter).'));
        };
        root.replaceChildren(...[
            h('p', { class: 'lr-note' }, 'When a reply fails, LunaRouter tries your next model automatically. While it is ON, it chooses the model: the one picked in Settings is ignored. It works with Chat Completion (OpenRouter, LM Studio, other OpenAI-compatible servers).'),
            h('label', { class: 'lr-row lr-main' }, h('b', {}, 'Use LunaRouter'),
                (() => { const c = h('input', { type: 'checkbox', class: 'lr-switch', ...(draft.enabled ? { checked: true } : {}) }); c.addEventListener('change', () => { draft.enabled = c.checked; }); return c; })()),

            h('h4', {}, 'Connections (up to 2)'),
            draft.connections.map((conn, i) => h('div', { class: 'lr-card' },
                h('div', { class: 'lr-row' }, h('b', {}, `Connection ${i + 1}`),
                    (() => {
                        const sel = h('select', { class: 'text_pole' }, Object.entries(TYPES).map(([k, t]) => h('option', { value: k, ...(conn.type === k ? { selected: true } : {}) }, t.label)));
                        sel.addEventListener('change', () => { conn.type = sel.value; modelLists[i] = []; modelStatus[i] = ''; render(); });
                        return sel;
                    })()),
                conn.type === 'custom' ? h('div', { class: 'lr-row' }, h('span', {}, 'Address'),
                    (() => { const u = h('input', { class: 'text_pole', type: 'text', placeholder: 'http://127.0.0.1:1234/v1', value: conn.url }); u.addEventListener('input', () => { conn.url = u.value; }); return u; })()) : null,
                keyNote(i),
                conn.type !== 'off' ? h('div', { class: 'lr-row' },
                    h('button', { type: 'button', class: 'menu_button', onclick: () => loadModels(draft, i, render) }, 'Load models'),
                    h('small', {}, modelStatus[i])) : null)),

            h('h4', {}, 'Models (up to 6, tried in this order)'),
            draft.routes.map((route, i) => h('div', { class: 'lr-route' },
                (() => {
                    const sel = h('select', { class: 'text_pole lr-order', title: 'Order' }, draft.routes.map((_, k) => h('option', { value: k, ...(k === i ? { selected: true } : {}) }, `${k + 1}${['st', 'nd', 'rd', 'th'][k]}`)));
                    sel.addEventListener('change', () => { const j = Number(sel.value); [draft.routes[i], draft.routes[j]] = [draft.routes[j], draft.routes[i]]; render(); });
                    return sel;
                })(),
                (() => {
                    const sel = h('select', { class: 'text_pole', title: 'Connection' }, draft.connections.map((c, k) => h('option', { value: k, ...(route.conn === k ? { selected: true } : {}) }, `Connection ${k + 1}${c.type === 'off' ? ' (not used)' : ` · ${TYPES[c.type].label.replace(/ \(.*\)$/, '')}`}`)));
                    sel.addEventListener('change', () => { route.conn = Number(sel.value); render(); });
                    return sel;
                })(),
                (() => {
                    const listId = `lr-models-${i}`;
                    const wrap = h('div', { class: 'lr-model' },
                        h('input', { class: 'text_pole', type: 'text', list: listId, placeholder: 'Model name', value: route.model }),
                        h('datalist', { id: listId }, (modelLists[route.conn] || []).map((m) => h('option', { value: m }))));
                    wrap.querySelector('input').addEventListener('input', (e) => { route.model = e.target.value; });
                    return wrap;
                })(),
                h('button', { type: 'button', class: 'menu_button lr-x', title: 'Remove', onclick: () => { draft.routes.splice(i, 1); render(); } }, '✕'))),
            draft.routes.length < MAX_ROUTES ? h('button', { type: 'button', class: 'menu_button lr-add', onclick: () => { draft.routes.push({ conn: 0, model: '' }); render(); } }, '+ Add model') : null,
            !draft.routes.length ? h('p', { class: 'lr-note' }, 'No models yet. Add one, choose its connection and type or pick the model name.') : null,

            h('h4', {}, 'Options'),
            h('label', { class: 'lr-row' }, h('span', {}, 'Treat an empty reply as a failure'),
                (() => { const c = h('input', { type: 'checkbox', ...(draft.retryEmpty ? { checked: true } : {}) }); c.addEventListener('change', () => { draft.retryEmpty = c.checked; }); return c; })()),
            h('label', { class: 'lr-row', title: 'If a model stops in the middle of a reply (or in the middle of thinking), the next model continues from where it stopped, and only the finished reply is sent to the chat.' }, h('span', {}, 'Finish cut-off replies with the next model'),
                (() => { const c = h('input', { type: 'checkbox', ...(draft.continueCut ? { checked: true } : {}) }); c.addEventListener('change', () => { draft.continueCut = c.checked; }); return c; })()),
            h('label', { class: 'lr-row', title: 'When a model fails several times in a row, replace it with another model from the same connection.' }, h('span', {}, 'Change model after multiple failures?'),
                (() => { const c = h('input', { type: 'checkbox', ...(draft.switchOnFail ? { checked: true } : {}) }); c.addEventListener('change', () => { draft.switchOnFail = c.checked; render(); }); return c; })()),
            draft.switchOnFail ? h('div', { class: 'lr-sub lr-switch' },
                h('label', { class: 'lr-row' }, h('span', {}, 'After this many failures in a row (2-10)'),
                    (() => { const n = h('input', { class: 'text_pole lr-num', type: 'number', min: 2, max: 10, value: draft.switchAfter }); n.addEventListener('input', () => { draft.switchAfter = Math.min(10, Math.max(2, Math.round(Number(n.value) || 3))); }); return n; })()),
                [['random', 'Shift to a random model'], ['similar', 'Shift to a model with a similar context length'], ['name', 'Shift to a model with this word in the name:']].map(([id, label]) =>
                    h('label', { class: 'lr-row lr-radio' },
                        (() => { const r = h('input', { type: 'radio', name: 'lr-switch-mode', ...(draft.switchMode === id ? { checked: true } : {}) }); r.addEventListener('change', () => { draft.switchMode = id; render(); }); return r; })(),
                        h('span', {}, label))),
                draft.switchMode === 'name' ? (() => { const w = h('input', { class: 'text_pole', type: 'text', placeholder: 'for example: llama', value: draft.switchWord || '' }); w.addEventListener('input', () => { draft.switchWord = w.value; }); return w; })() : null,
                h('p', { class: 'lr-note' }, 'The replacement comes from the models your connection offers (load them once with "Load models"). It is used for this session; saving this window starts fresh.'),
                Object.keys(swaps).length ? h('p', { class: 'lr-note' }, `Replaced this session: ${Object.entries(swaps).map(([k, v]) => `${k.split(':').slice(1).join(':')} → ${v}`).join(', ')}`) : null) : null,
            h('label', { class: 'lr-row', title: 'When a model fails, call that same model again before moving on to the next one.' }, h('span', {}, 'Call same model multiple times'),
                (() => { const c = h('input', { type: 'checkbox', ...(draft.repeatSame ? { checked: true } : {}) }); c.addEventListener('change', () => { draft.repeatSame = c.checked; render(); }); return c; })()),
            draft.repeatSame ? h('label', { class: 'lr-row lr-sub' }, h('span', {}, 'How many times the same model can be called before giving up (2-10)'),
                (() => { const n = h('input', { class: 'text_pole lr-num', type: 'number', min: 2, max: 10, value: draft.repeatTimes }); n.addEventListener('input', () => { draft.repeatTimes = Math.min(10, Math.max(2, Math.round(Number(n.value) || 3))); }); return n; })()) : null,
            h('label', { class: 'lr-row' }, h('span', {}, 'Give up on a model after (seconds, 0 = never)'),
                (() => { const n = h('input', { class: 'text_pole lr-num', type: 'number', min: 0, max: 600, value: draft.timeoutSec }); n.addEventListener('input', () => { draft.timeoutSec = Math.max(0, Number(n.value) || 0); }); return n; })()),
            lastUsed ? h('p', { class: 'lr-note' }, `Last reply came from: ${lastUsed}`) : null,
        ].flat(Infinity).filter(Boolean));
    };
    render();
    return root;
}

async function openRouterPopup() {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT, saveSettingsDebounced } = ctx();
    await loadSecretState();
    const current = settings();
    const draft = structuredClone({ enabled: current.enabled, connections: current.connections, routes: current.routes, retryEmpty: current.retryEmpty, continueCut: current.continueCut, switchOnFail: current.switchOnFail, switchAfter: current.switchAfter, switchMode: current.switchMode, switchWord: current.switchWord, repeatSame: current.repeatSame, repeatTimes: current.repeatTimes, timeoutSec: current.timeoutSec });
    const content = h('div', { class: 'lr-popup' }, h('h3', {}, '🌙 LunaRouter'), buildForm(draft));
    const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, '', { okButton: 'Save', cancelButton: 'Cancel', wide: true, allowVerticalScrolling: true });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;
    Object.assign(current, draft);
    for (const k of Object.keys(swaps)) delete swaps[k];          // a saved setup starts fresh
    for (const k of Object.keys(failCount)) delete failCount[k];
    saveSettingsDebounced();
    updateBadge();
    const n = activeRoutes(current).length;
    toastr.success(current.enabled ? (n ? `LunaRouter is ON with ${n} model${n > 1 ? 's' : ''}.` : 'LunaRouter is ON, but no usable model is set yet.') : 'LunaRouter saved (OFF).', 'LunaRouter');
}

function updateBadge() {
    const s = settings();
    document.querySelectorAll('.luna-router-btn .lr-badge').forEach((b) => {
        b.textContent = s.enabled ? 'ON' : 'OFF';
        b.classList.toggle('lr-badge-on', s.enabled);
    });
}

/** Adds the LunaRouter button right under the "Connect" button of the API panel. */
function mountButton() {
    if (document.querySelector('.luna-router-btn')) return true;
    const connect = [...document.querySelectorAll('#openai_api .api_button')].find((el) => el.textContent.trim() === 'Connect');
    if (!connect) return false;
    const row = connect.parentElement;
    const wrap = h('div', { class: 'luna-router-btn' },
        h('div', { class: 'menu_button menu_button_icon lr-open', onclick: openRouterPopup, title: 'Automatic fallback between models and APIs' },
            h('i', { class: 'fa-solid fa-route' }), h('span', {}, 'LunaRouter'), h('span', { class: 'lr-badge' }, 'OFF')));
    row.after(wrap);
    updateBadge();
    return true;
}

jQuery(() => {
    settings();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'luna-router',
        helpString: 'Turns LunaRouter on or off, or opens its window: /luna-router on | off | open',
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'on, off or open', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
        callback: async (_args, value) => {
            const v = String(value || 'open').trim().toLowerCase();
            if (v === 'on' || v === 'off') { settings().enabled = v === 'on'; ctx().saveSettingsDebounced(); updateBadge(); return `LunaRouter ${v}`; }
            openRouterPopup();
            return '';
        },
    }));
    // The API panel is built early but its buttons may appear a moment later: retry briefly.
    let tries = 0;
    const timer = setInterval(() => { if (mountButton() || ++tries > 40) clearInterval(timer); }, 500);
});
