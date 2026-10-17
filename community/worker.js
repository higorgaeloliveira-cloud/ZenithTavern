/*
 * ZenithTavern EX-Roster server (Cloudflare Worker + Workers KV).
 *
 * Bindings needed:   STORE      (KV namespace)
 *                    ADMIN_KEY  (Secret - only you know it; lets you remove uploads)
 *
 *   GET  /                 status
 *   GET  /api/list         ?kind=character|location &q=text      public items (no private ones)
 *   GET  /api/item/:id     the whole bundle (public or private - the id is the share code)
 *   GET  /api/img/:id/:n   a picture of an item ("card", "banner" or an expression name)
 *   POST /api/publish      { bundle }                            -> { id, token }
 *   POST /api/delete       { id, token }   or header X-Admin-Key  -> { ok }
 *   GET  /admin            small page to look at and remove public uploads (asks for ADMIN_KEY)
 */
const MAX_BODY = 2_400_000;       // bytes of JSON per upload
const MAX_IMG = 420_000;          // characters per picture (data URL)
const MAX_EXPR = 16;
const HOUR = 3600_000;
const memo = { items: null, t: 0 };
const hits = new Map();           // per-isolate, best effort rate limit: ip -> [timestamps]

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-admin-key' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });
const fail = (status, error) => json({ error }, status);

const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const list = (v, n, len) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []);
const IMG_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newId = (kind) => {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  return `${kind === 'location' ? 'L' : 'C'}-${[...r].map((b) => abc[b % abc.length]).join('')}`;
};

/** Rebuilds a clean bundle from untrusted input. Returns { bundle } or { error }. */
function clean(input) {
  if (!input || typeof input !== 'object') return { error: 'No data.' };
  const kind = input.kind;
  if (kind !== 'character' && kind !== 'location') return { error: 'Unknown kind.' };
  if (input.adult !== true) return { error: 'You must confirm that everything you share is for adults (18+).' };
  const name = str(input.name, 60);
  if (name.length < 2) return { error: 'The name is too short.' };
  const d = input.data && typeof input.data === 'object' ? input.data : {};
  const data = kind === 'character' ? {
    age: Math.floor(Number(d.age)),
    species: str(d.species, 120),
    description: str(d.description, 6000),
    personality: str(d.personality, 4000),
    prompt: str(d.prompt, 4000),
    restrictions: str(d.restrictions, 4000),
    summary: str(d.summary, 400),
    places: str(d.places, 300),
    when: str(d.when, 100),
    keys: list(d.keys, 20, 40),
  } : {
    description: str(d.description, 6000),
    prompt: str(d.prompt, 4000),
    summary: str(d.summary, 400),
    hours: str(d.hours, 120),
    residents: str(d.residents, 300),
    keys: list(d.keys, 20, 40),
  };
  if (kind === 'character') {
    if (!(data.age >= 18 && data.age <= 9999)) return { error: 'Every character must be 18 or older.' };
    if (data.description.length < 20) return { error: 'The description is too short.' };
    if (!data.summary) return { error: 'The short summary is required.' };
  } else if (data.description.length < 20) return { error: 'The description is too short.' };

  const images = {};
  const im = input.images && typeof input.images === 'object' ? input.images : {};
  for (const slot of ['card', 'banner']) {
    if (im[slot] == null || im[slot] === '') continue;
    if (typeof im[slot] !== 'string' || im[slot].length > MAX_IMG || !IMG_RE.test(im[slot])) return { error: `The ${slot} picture is not valid or too big.` };
    images[slot] = im[slot];
  }
  const expressions = {};
  const ex = im.expressions && typeof im.expressions === 'object' ? Object.entries(im.expressions) : [];
  if (ex.length > MAX_EXPR) return { error: `At most ${MAX_EXPR} expressions.` };
  for (const [n, v] of ex) {
    if (!/^[a-z0-9][a-z0-9 _-]{0,23}$/i.test(n)) return { error: `Bad expression name "${n}".` };
    if (typeof v !== 'string' || v.length > MAX_IMG || !IMG_RE.test(v)) return { error: `Expression "${n}" is not valid or too big.` };
    expressions[n.toLowerCase()] = v;
  }
  if (Object.keys(expressions).length) images.expressions = expressions;

  return {
    bundle: {
      format: 'zenith-ex', v: 1, kind, name, author: str(input.author, 40) || 'Anonymous',
      visibility: input.visibility === 'private' ? 'private' : 'public', adult: true, data, images, created: new Date().toISOString(),
    },
  };
}

const meta = (id, b) => ({
  id, kind: b.kind, name: b.name, author: b.author, summary: (b.data.summary || b.data.description || '').slice(0, 220),
  age: b.data.age || null, species: (b.data.species || '').slice(0, 60), card: !!(b.images.card || b.images.banner),
  expr: Object.keys(b.images.expressions || {}).length, t: Date.now(),
});

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < HOUR);
  if (arr.length >= 12) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function load(env, id) {
  if (!/^[CL]-[A-Z0-9]{12}$/.test(id)) return null;
  for (const p of ['pub:', 'prv:']) {
    const raw = await env.STORE.get(p + id);
    if (raw) { try { return JSON.parse(raw); } catch { return null; } }
  }
  return null;
}

const ADMIN_HTML = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>EX-Roster admin</title>
<style>body{font:15px system-ui;background:#111;color:#eee;margin:0;padding:14px}input,button{font:inherit;padding:8px;border-radius:8px;border:1px solid #555;background:#222;color:#eee}
.r{display:flex;gap:8px;align-items:center;border-bottom:1px solid #333;padding:8px 0}.r b{flex:1}.r small{opacity:.6;display:block}button.d{background:#7a1f2b}</style>
<h3>EX-Roster admin</h3><input id=k type=password placeholder="ADMIN_KEY"> <button onclick="go()">Load</button><div id=o></div>
<script>
const o=document.getElementById('o');
async function go(){const k=document.getElementById('k').value;o.textContent='...';
 const r=await fetch('/api/list?all=1').then(r=>r.json());o.innerHTML='';
 for(const i of r.items){const d=document.createElement('div');d.className='r';
  d.innerHTML='<b></b><button class=d>Delete</button>';d.firstChild.innerHTML=i.name+' <small>'+i.kind+' · '+i.author+' · '+i.id+'</small>';
  d.lastChild.onclick=async()=>{if(!confirm('Delete '+i.name+'?'))return;
   const x=await fetch('/api/delete',{method:'POST',headers:{'content-type':'application/json','x-admin-key':k},body:JSON.stringify({id:i.id})});
   if(x.ok)d.remove();else alert('Refused (wrong key?)')};o.append(d)}
 if(!r.items.length)o.textContent='Nothing uploaded yet.'}
</script>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.STORE) return fail(500, 'The STORE binding (KV namespace) is missing.');

    try {
      if (path === '/') return json({ ok: true, service: 'zenith-exroster', v: 1 });
      if (path === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });

      if (path === '/api/list' && request.method === 'GET') {
        // The listing is kept in memory for 2 minutes (KV allows 1000 list calls a day on the free plan).
        let items;
        if (memo.items && Date.now() - memo.t < 120_000) items = memo.items;
        else {
          items = [];
          let cursor;
          for (let i = 0; i < 5; i++) {
            const r = await env.STORE.list({ prefix: 'pub:', cursor, limit: 1000 });
            for (const k of r.keys) if (k.metadata) items.push(k.metadata);
            if (r.list_complete) break;
            cursor = r.cursor;
          }
          items.sort((a, b) => b.t - a.t);
          memo.items = items; memo.t = Date.now();
        }
        const kind = url.searchParams.get('kind');
        const q = (url.searchParams.get('q') || '').toLowerCase().trim();
        let out = items;
        if (kind) out = out.filter((i) => i.kind === kind);
        if (q) out = out.filter((i) => `${i.name} ${i.author} ${i.summary} ${i.species}`.toLowerCase().includes(q));
        return json({ items: out.slice(0, 200) });
      }

      let m;
      if ((m = path.match(/^\/api\/item\/([A-Z0-9-]+)$/)) && request.method === 'GET') {
        const b = await load(env, m[1]);
        if (!b) return fail(404, 'Not found. Check the code.');
        const { _th, ...pub } = b;
        return json({ id: m[1], bundle: pub }, 200, { 'cache-control': 'no-store' });
      }

      if ((m = path.match(/^\/api\/img\/([A-Z0-9-]+)\/([A-Za-z0-9 _-]{1,24})$/)) && request.method === 'GET') {
        const b = await load(env, m[1]);
        const n = decodeURIComponent(m[2]).toLowerCase();
        const src = b && (n === 'card' ? (b.images.card || b.images.banner) : n === 'banner' ? b.images.banner : b.images.expressions?.[n]);
        if (!src) return new Response('', { status: 404, headers: CORS });
        const mt = src.match(/^data:(image\/[a-z]+);base64,(.*)$/);
        const bin = Uint8Array.from(atob(mt[2]), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'content-type': mt[1], 'cache-control': 'public, max-age=3600', ...CORS } });
      }

      if (path === '/api/publish' && request.method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'x';
        if (rateLimited(ip)) return fail(429, 'Too many uploads. Try again in a while.');
        const text = await request.text();
        if (text.length > MAX_BODY) return fail(413, 'The upload is too big (limit about 2 MB). Use fewer or smaller pictures.');
        let input;
        try { input = JSON.parse(text).bundle; } catch { return fail(400, 'Bad JSON.'); }
        const r = clean(input);
        if (r.error) return fail(400, r.error);
        const b = r.bundle;
        const id = newId(b.kind);
        const token = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
        b._th = await sha256(token);
        if (b.visibility === 'public') await env.STORE.put(`pub:${id}`, JSON.stringify(b), { metadata: meta(id, b) });
        else await env.STORE.put(`prv:${id}`, JSON.stringify(b));
        memo.items = null;
        return json({ id, token, visibility: b.visibility });
      }

      if (path === '/api/delete' && request.method === 'POST') {
        let body; try { body = await request.json(); } catch { return fail(400, 'Bad JSON.'); }
        const id = String(body.id || '');
        const b = await load(env, id);
        if (!b) return fail(404, 'Not found.');
        const admin = env.ADMIN_KEY && request.headers.get('x-admin-key') === env.ADMIN_KEY;
        const owner = body.token && b._th && (await sha256(String(body.token))) === b._th;
        if (!admin && !owner) return fail(403, 'Not allowed.');
        await env.STORE.delete(`pub:${id}`); await env.STORE.delete(`prv:${id}`);
        memo.items = null;
        return json({ ok: true });
      }

      return fail(404, 'Not found.');
    } catch (e) {
      return fail(500, 'Server error: ' + (e && e.message ? e.message : e));
    }
  },
};
