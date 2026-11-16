/*
 * ZenithTavern storage (Cloudflare Worker + Workers KV). Replaces the old EX-Roster server.
 *
 * Bindings needed (the same two the old Worker used):
 *   STORE      KV namespace
 *   ADMIN_KEY  Secret text. Only you know it. Every write needs it.
 *
 * Public (anyone, read only; this is what ZenithTavern's Roster-Downloader reads):
 *   GET /roster.json      the catalogue (built by "Rebuild roster", see below)
 *   GET /<path>           a stored file, for example  /riko-hayami/card.png  or  /riko-hayami/sets/casual.zip
 *
 * Admin (header  x-admin-key: <ADMIN_KEY>):
 *   GET    /admin                    a small page to do all of this from a browser (phone friendly)
 *   GET    /api/ping                 checks the key
 *   GET    /api/list                 every stored file: path, size, sha256
 *   PUT    /api/put?path=<path>      body = the file (up to 25 MiB). The sha256 is computed here.
 *   DELETE /api/file?path=<path>
 *   PUT    /api/meta                 JSON { id, name, file, tagline, tags, version, card?, thumb?, defaultSet? }  one per character
 *   GET    /api/metas                every character record
 *   DELETE /api/meta?id=<id>
 *   POST   /api/rebuild              builds /roster.json from the character records and the stored files:
 *                                      card    = <id>/card.png (or meta.card)
 *                                      sprites = every image directly inside <id>/sprites/        (loose expressions)
 *                                      images  = every image directly inside <id>/images/
 *                                      sets    = every zip directly inside <id>/sets/             (outfits: casual.zip, lingerie.zip, naked.zip ...)
 *                                    A zip holds one outfit: the expression images named after the emotion (neutral.webp, joy.webp ...).
 *                                    When a character has sets, ZenithTavern uses the sets and ignores the loose sprites.
 *                                    Run it once after a batch of uploads.
 *   POST   /api/purge-old            removes the leftovers of the old EX-Roster (keys "pub:" and "prv:")
 *
 * Free plan limits to keep in mind: 1 GB of KV storage, 100,000 reads a day, 1,000 writes/lists/deletes a day, 25 MiB per file.
 */
const MAX_FILE = 25 * 1024 * 1024;
const PATH_RE = /^(?!.*\.\.)[A-Za-z0-9 _.()'&+-]+(\/[A-Za-z0-9 _.()'&+-]+)*$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IMAGE_RE = /\.(png|webp|gif|jpe?g)$/i;
const TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', json: 'application/json', zip: 'application/zip' };
const FILE = 'roster:file:';
const META = 'roster:meta:';
const MANIFEST = 'roster:manifest';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const fail = (status, error) => json({ error }, status);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.length || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const isAdmin = (request, env) => !!env.ADMIN_KEY && sameKey(request.headers.get('x-admin-key') || '', env.ADMIN_KEY);

async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const r = await env.STORE.list({ prefix, cursor, limit: 1000 });
    out.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

/** Builds roster.json from the character records and the stored files. */
async function rebuild(env) {
  const files = new Map();
  for (const k of await listAll(env, FILE)) files.set(k.name.slice(FILE.length), k.metadata || {});
  const characters = [];
  const skipped = [];
  let spriteCount = 0;
  let setCount = 0;
  for (const k of await listAll(env, META)) {
    const m = await env.STORE.get(k.name, 'json');
    if (!m || !ID_RE.test(m.id)) continue;
    const cardPath = m.card || `${m.id}/card.png`;
    const cardInfo = files.get(cardPath);
    if (!cardInfo || !cardInfo.sha256) { skipped.push(`${m.id} (no card at ${cardPath})`); continue; }
    const under = (folder) => [...files.entries()]
      .filter(([p, info]) => p.startsWith(`${m.id}/${folder}/`) && !p.slice(m.id.length + folder.length + 2).includes('/') && IMAGE_RE.test(p) && info.sha256)
      .map(([p, info]) => ({ path: p, as: p.slice(p.lastIndexOf('/') + 1), sha256: info.sha256 }))
      .sort((a, b) => a.as.localeCompare(b.as));
    const sprites = under('sprites');
    const images = under('images');
    // outfits: every zip directly inside <id>/sets/ ; the file name (without .zip) is the outfit's id
    const sets = [];
    for (const [p, info] of files.entries()) {
      if (!p.startsWith(`${m.id}/sets/`) || p.slice(m.id.length + 6).includes('/') || !/\.zip$/i.test(p) || !info.sha256) continue;
      const base = p.slice(p.lastIndexOf('/') + 1).replace(/\.zip$/i, '');
      const sid = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40);
      if (!sid || sets.some((s) => s.id === sid)) continue;
      sets.push({ id: sid, name: base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40), path: p, size: info.size || 0, sha256: info.sha256 });
    }
    sets.sort((a, b) => a.id.localeCompare(b.id));
    const wanted = typeof m.defaultSet === 'string' ? m.defaultSet : 'casual';
    const defaultSet = sets.some((s) => s.id === wanted) ? wanted : (sets[0] ? sets[0].id : '');
    spriteCount += sprites.length;
    setCount += sets.length;
    characters.push({
      id: m.id, name: m.name, file: m.file, tagline: m.tagline || '', tags: m.tags || [], version: m.version || 1,
      card: cardPath, ...(m.thumb && files.has(m.thumb) ? { thumb: m.thumb } : {}), sha256: cardInfo.sha256, sprites, images, sets, defaultSet,
    });
  }
  characters.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = { version: 1, generatedAt: new Date().toISOString(), characters };
  await env.STORE.put(MANIFEST, JSON.stringify(manifest));
  return { characters: characters.length, sprites: spriteCount, sets: setCount, skipped };
}

const ADMIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZenithTavern storage</title>
<style>
:root{color-scheme:dark}body{font:15px/1.45 system-ui,sans-serif;background:#0e0e11;color:#eaeaea;margin:0;padding:14px;max-width:760px;margin-inline:auto}
h1{font-size:1.2em;color:#f5c451}h2{font-size:1em;margin:22px 0 8px;color:#f5c451;border-bottom:1px solid #333;padding-bottom:4px}
input,button,textarea{font:inherit;padding:9px 10px;border-radius:8px;border:1px solid #555;background:#1a1a1f;color:#eee;max-width:100%;box-sizing:border-box}
input[type=text],input[type=password],input[type=number]{width:100%;margin:3px 0}button{cursor:pointer}button.go{background:#5a4510;border-color:#f5c451}button.del{background:#6e1d28;padding:5px 9px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}.f{display:flex;gap:8px;align-items:center;border-bottom:1px solid #26262b;padding:6px 0;font-size:.86em}
.f b{flex:1;word-break:break-all;font-weight:400}.f small{opacity:.6;white-space:nowrap}#msg{margin:10px 0;padding:8px 10px;border-radius:8px;background:#1a1a1f;white-space:pre-wrap}
.ok{border-left:3px solid #4cd964}.bad{border-left:3px solid #ff5a5a}label{display:block;margin-top:6px;font-size:.85em;opacity:.8}
</style></head><body>
<h1>ZenithTavern storage</h1>
<div id="msg">Enter your ADMIN_KEY, then press Check key.</div>
<input id="key" type="password" placeholder="ADMIN_KEY" autocomplete="off">
<div class="row"><button class="go" onclick="check()">Check key</button><a href="/roster.json" target="_blank" style="color:#9ecbff">Open roster.json</a></div>

<h2>1. Character record</h2>
<label>Id (letters, digits, dash. Example: riko-kitsumi)</label><input id="m_id" type="text">
<label>Name (as on the card)</label><input id="m_name" type="text">
<label>Card file name (shown in the Character List, ends in .png)</label><input id="m_file" type="text" placeholder="Riko Hayami.png">
<label>Tagline</label><input id="m_tag" type="text">
<label>Tags (comma separated)</label><input id="m_tags" type="text">
<label>Version (a whole number; raise it to show HAS UPDATE)</label><input id="m_ver" type="number" min="1" value="1">
<div class="row"><button onclick="saveMeta()">Save record</button><button onclick="loadMetas()">Show saved records</button></div>
<div id="metas"></div>

<h2>2. Upload files</h2>
<label>Folder in storage. Outfits (one zip each, named casual.zip, lingerie.zip, naked.zip...): riko-kitsumi/sets. The card (card.png) goes in riko-kitsumi, pictures in riko-kitsumi/images, loose expressions in riko-kitsumi/sprites.</label>
<input id="prefix" type="text" placeholder="riko-kitsumi/sets">
<div class="row"><input id="files" type="file" multiple> <button class="go" onclick="upload()">Upload</button></div>

<h2>3. Publish</h2>
<div class="row"><button class="go" onclick="rebuild()">Rebuild roster</button><button onclick="loadFiles()">Show stored files</button></div>
<div id="files_out"></div>

<h2>Cleanup</h2>
<div class="row"><button class="del" onclick="purge()">Remove old EX-Roster data</button></div>

<script>
var $=function(s){return document.getElementById(s)};
$('key').value=localStorage.getItem('zk')||'';
function say(t,bad){var m=$('msg');m.textContent=t;m.className=bad?'bad':'ok'}
async function api(path,opt){opt=opt||{};localStorage.setItem('zk',$('key').value);
  var h=Object.assign({},opt.headers||{},{'x-admin-key':$('key').value});
  var r=await fetch(path,Object.assign({},opt,{headers:h}));var j=await r.json().catch(function(){return{}});
  if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
async function check(){try{await api('/api/ping');say('Key accepted. Storage is reachable.')}catch(e){say('Failed: '+e.message,1)}}
async function saveMeta(){try{
  var tags=$('m_tags').value.split(',').map(function(x){return x.trim()}).filter(Boolean);
  var j=await api('/api/meta',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:$('m_id').value.trim(),name:$('m_name').value.trim(),file:$('m_file').value.trim(),tagline:$('m_tag').value.trim(),tags:tags,version:Number($('m_ver').value)||1})});
  say('Saved the record for '+j.id+'. Upload its files, then press Rebuild roster.');loadMetas()}catch(e){say('Failed: '+e.message,1)}}
async function loadMetas(){try{var j=await api('/api/metas');var o=$('metas');o.textContent='';
  j.items.forEach(function(m){var d=document.createElement('div');d.className='f';var b=document.createElement('b');b.textContent=m.id+' - '+m.name+' (v'+m.version+')';
    var u=document.createElement('button');u.textContent='Edit';u.onclick=function(){$('m_id').value=m.id;$('m_name').value=m.name;$('m_file').value=m.file;$('m_tag').value=m.tagline||'';$('m_tags').value=(m.tags||[]).join(', ');$('m_ver').value=m.version||1};
    var x=document.createElement('button');x.className='del';x.textContent='Delete';x.onclick=async function(){if(!confirm('Delete the record '+m.id+'?'))return;try{await api('/api/meta?id='+encodeURIComponent(m.id),{method:'DELETE'});d.remove()}catch(e){say('Failed: '+e.message,1)}};
    d.append(b,u,x);o.append(d)});if(!j.items.length)o.textContent='No records yet.'}catch(e){say('Failed: '+e.message,1)}}
async function upload(){var prefix=$('prefix').value.trim().replace(/^\\/+|\\/+$/g,'');var list=Array.prototype.slice.call($('files').files);
  if(!list.length)return say('Pick files first.',1);var done=0;
  for(var i=0;i<list.length;i++){var f=list[i];var path=(prefix?prefix+'/':'')+f.name;say('Uploading '+(i+1)+'/'+list.length+': '+path);
    try{await api('/api/put?path='+encodeURIComponent(path),{method:'PUT',body:f});done++}catch(e){return say('Stopped at '+path+': '+e.message+'\\nUploaded before that: '+done,1)}}
  say('Uploaded '+done+' file(s). When everything is up, press Rebuild roster.')}
async function rebuild(){try{say('Building...');var j=await api('/api/rebuild',{method:'POST'});
  say('Roster built: '+j.characters+' character(s), '+j.sprites+' loose sprite(s), '+j.sets+' outfit zip(s).'+(j.skipped.length?'\\nSkipped: '+j.skipped.join('; '):''),j.skipped.length>0)}catch(e){say('Failed: '+e.message,1)}}
async function loadFiles(){try{var j=await api('/api/list');var o=$('files_out');o.textContent='';
  j.files.forEach(function(f){var d=document.createElement('div');d.className='f';var b=document.createElement('b');b.textContent=f.path;var s=document.createElement('small');s.textContent=Math.round(f.size/1024)+' KB';
    var x=document.createElement('button');x.className='del';x.textContent='Delete';x.onclick=async function(){if(!confirm('Delete '+f.path+'?'))return;try{await api('/api/file?path='+encodeURIComponent(f.path),{method:'DELETE'});d.remove()}catch(e){say('Failed: '+e.message,1)}};
    d.append(b,s,x);o.append(d)});say(j.files.length+' stored file(s).');if(!j.files.length)o.textContent='Nothing stored yet.'}catch(e){say('Failed: '+e.message,1)}}
async function purge(){if(!confirm('Remove all old EX-Roster uploads? This cannot be undone.'))return;try{var j=await api('/api/purge-old',{method:'POST'});say('Removed '+j.removed+' old item(s).')}catch(e){say('Failed: '+e.message,1)}}
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
    if (!env.STORE) return fail(500, 'The STORE binding (KV namespace) is missing.');
    try {
      // ---------------- admin API
      if (path.startsWith('api/')) {
        if (!isAdmin(request, env)) return fail(403, 'Wrong or missing key.');
        const route = path.slice(4);
        const p = url.searchParams.get('path') || '';

        if (route === 'ping') return json({ ok: true });

        if (route === 'list' && request.method === 'GET') {
          const files = (await listAll(env, FILE)).map((k) => ({ path: k.name.slice(FILE.length), size: k.metadata?.size || 0, sha256: k.metadata?.sha256 || '' }));
          files.sort((a, b) => a.path.localeCompare(b.path));
          return json({ files });
        }

        if (route === 'put' && request.method === 'PUT') {
          if (!PATH_RE.test(p)) return fail(400, 'Bad path. Use letters, digits, spaces and - _ . ( ) only, with / between folders.');
          const buf = await request.arrayBuffer();
          if (!buf.byteLength) return fail(400, 'Empty file.');
          if (buf.byteLength > MAX_FILE) return fail(413, 'That file is over the 25 MiB limit.');
          const sha256 = hex(await crypto.subtle.digest('SHA-256', buf));
          await env.STORE.put(FILE + p, buf, { metadata: { size: buf.byteLength, sha256 } });
          return json({ ok: true, path: p, size: buf.byteLength, sha256 });
        }

        if (route === 'file' && request.method === 'DELETE') {
          if (!PATH_RE.test(p)) return fail(400, 'Bad path.');
          await env.STORE.delete(FILE + p);
          return json({ ok: true });
        }

        if (route === 'meta' && request.method === 'PUT') {
          let b; try { b = await request.json(); } catch { return fail(400, 'Bad JSON.'); }
          const id = str(b.id, 64);
          if (!ID_RE.test(id)) return fail(400, 'The id must be lowercase letters, digits, - or _.');
          const name = str(b.name, 80);
          if (name.length < 2) return fail(400, 'The name is too short.');
          const file = str(b.file, 100);
          if (!/\.png$/i.test(file)) return fail(400, 'The card file name must end in .png.');
          const version = Math.max(1, Math.floor(Number(b.version)) || 1);
          const rec = {
            id, name, file, tagline: str(b.tagline, 240), version,
            tags: Array.isArray(b.tags) ? b.tags.map((t) => str(t, 40)).filter(Boolean).slice(0, 8) : [],
          };
          if (typeof b.card === 'string' && PATH_RE.test(b.card)) rec.card = b.card;
          if (typeof b.thumb === 'string' && PATH_RE.test(b.thumb)) rec.thumb = b.thumb;
          if (typeof b.defaultSet === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(b.defaultSet)) rec.defaultSet = b.defaultSet;
          await env.STORE.put(META + id, JSON.stringify(rec));
          return json({ ok: true, id });
        }

        if (route === 'metas' && request.method === 'GET') {
          const items = [];
          for (const k of await listAll(env, META)) { const m = await env.STORE.get(k.name, 'json'); if (m) items.push(m); }
          items.sort((a, b) => a.name.localeCompare(b.name));
          return json({ items });
        }

        if (route === 'meta' && request.method === 'DELETE') {
          const id = url.searchParams.get('id') || '';
          if (!ID_RE.test(id)) return fail(400, 'Bad id.');
          await env.STORE.delete(META + id);
          return json({ ok: true });
        }

        if (route === 'rebuild' && request.method === 'POST') return json({ ok: true, ...(await rebuild(env)) });

        if (route === 'purge-old' && request.method === 'POST') {
          let removed = 0;
          for (const prefix of ['pub:', 'prv:']) for (const k of await listAll(env, prefix)) { await env.STORE.delete(k.name); removed++; }
          return json({ ok: true, removed });
        }
        return fail(404, 'Unknown admin route.');
      }

      // ---------------- admin page and status
      if (path === 'admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (path === '') return json({ ok: true, service: 'zenithtavern-storage', v: 3 });
      if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Read only.');

      // ---------------- public: the catalogue and the stored files
      if (path === 'roster.json') {
        const text = await env.STORE.get(MANIFEST);
        return new Response(text || JSON.stringify({ version: 1, characters: [] }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' } });
      }
      if (!PATH_RE.test(path)) return fail(404, 'Not found.');
      const buf = await env.STORE.get(FILE + path, { type: 'arrayBuffer', cacheTtl: 60 });
      if (!buf) return fail(404, 'Not found.');
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      return new Response(request.method === 'HEAD' ? null : buf, {
        headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' },
      });
    } catch (e) {
      return fail(500, 'Server error: ' + (e && e.message ? e.message : e));
    }
  },
};
