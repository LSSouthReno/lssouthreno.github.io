/* LSSR fast API — Cloudflare Worker (Fast Backend Plan, phase P1).
 *
 * Serves the private versions of the site's data files in a few tens of milliseconds instead of the
 * 2–50 s an Apps Script call takes. It computes nothing and holds no Planning Center keys:
 *   · Apps Script assembles each full file when it publishes the public one (lssrPublicCopy_) and POSTs it
 *     here with the shared INGEST_KEY; it is kept in KV.
 *   · A sign-in token is checked by asking Apps Script once (wk_pass → the same pass priv_file uses); the
 *     answer is remembered up to 10 min in this data center's cache, keyed by the token's SHA-256 only.
 * Routes
 *   GET  /priv/<file>      Authorization: Bearer <phone sign-in token> → the full file (staff · admin · pastor)
 *                          or the team-leader version, else 403. 404 {missing:true} if not ingested yet.
 *   GET  /sunday_names     Bearer token (any signed-in person, or the demo sign-in) → who serves on Sundays.
 *   POST /ingest           X-Ingest-Key → store items [{ key, value }] (full:<file> · leader:<file> · sunday_names · side:*).
 *   GET  /jr/me · /jr/rhythm  Bearer token → the Me page / rhythm chart for the token's owner (P2; see jr.js).
 *   GET  /sos/data?who= · /sos/roster, POST /sos   Bearer token (staff · admin) → Staff OS on D1 (P2 step 2; see sos.js).
 *   POST /sos/gas          X-Ingest-Key → Apps Script's forwarded Staff OS calls, the one-time copy and the backup export.
 *   GET  /jr/serve_needs?sundays=1-3  Bearer token (staff · admin · pastor · leader) → open spots on the owner's
 *                          serve teams this Sunday + who to ask (Your Week; see serve.js).
 *   GET  /jr/serve_open?sundays=1-4   Bearer token (ANY signed-in person) → open spots per team for the next Sundays + point
 *                          leaders to ask + this person's pending sign-up requests (Me → Your rhythm → Serving).
 *   POST /jr/serve_request Bearer token (any signed-in person; 'resolve' only team leaders) → ask to join a spot / close a request.
 *   GET  /health
 * Every reply: CORS only for the site's own origins, Cache-Control: no-store.
 */
import { jrBuild, jrRhythmBuild } from './jr.js';
import { sosRoute, sosGasRoute } from './sos.js';
import { serveNeedsBuild, serveOpenBuild, serveRequestsFor, serveRequestPost } from './serve.js';

const FILES = ['dashboard-data.json', 'eos-data.json', 'joy_bombs.json', 'absences.json', 'shepherding-data.json', 'pathway.json'];
const FULL_LEVELS = ['staff', 'admin', 'pastor'];
const WEEK_LEVELS = FULL_LEVELS.concat('leader');   // who sees Your Week
const DEMO_TOKEN = 'demo-member-sam-sample-0000000000';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/ingest' && req.method === 'POST') return await ingest(req, env, cors);
      if (url.pathname === '/sos/gas' && req.method === 'POST') {
        if (!env.INGEST_KEY || !timingSafeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return json({ ok: false, error: 'unauthorized' }, 401, cors);
        return await sosGasRoute(req, env, ctx, json, cors);
      }
      if ((url.pathname === '/sos' && req.method === 'POST') || ((url.pathname === '/sos/data' || url.pathname === '/sos/roster') && req.method === 'GET'))
        return await sosRoute(url, req, env, ctx, await passFor(bearer(req), env, ctx), json, cors);
      if (url.pathname === '/jr/serve_request' && req.method === 'POST') return await serveRequestRoute(req, env, ctx, cors);
      if (req.method !== 'GET') return json({ ok: false, error: 'method' }, 405, cors);
      if (url.pathname.startsWith('/priv/')) return await privFile(decodeURIComponent(url.pathname.slice(6)), req, env, ctx, cors);
      if (url.pathname === '/sunday_names') return await sundayNames(req, env, ctx, cors);
      if (url.pathname === '/jr/me' || url.pathname === '/jr/rhythm') return await jrRoute(url, req, env, ctx, cors);
      if (url.pathname === '/jr/serve_open') return await serveOpenRoute(url, req, env, ctx, cors);
      if (url.pathname === '/jr/serve_needs') return await serveNeedsRoute(url, req, env, ctx, cors);
      return json({ ok: false, error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ ok: false, error: 'server' }, 500, cors);
    }
  }
};

function corsHeaders(origin, env) {
  const h = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  if (String(env.ORIGINS || '').split(',').includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers) });
}
function bearer(req) { const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') || ''); return m ? m[1] : ''; }
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The sign-in pass { pid, name, levels[], teams[] } for a token, or null. Remembered in this data center's
// cache for 30 min; after 5 min the next request re-asks Apps Script in the background (so a sign-out or a
// removed role takes effect within minutes, and nobody waits on Apps Script after their first request).
// A token Apps Script says is not signed in is remembered 1 min.
async function askGasPass(token, env) {
  const r = await fetch(env.GAS_URL + '?action=wk_pass&k=' + encodeURIComponent(env.INGEST_KEY) + '&token=' + encodeURIComponent(token) + '&_=' + Date.now(), { redirect: 'follow' });
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!j || j.ok !== true) return undefined;                   // can't tell right now
  return j.pass && j.pass.pid ? { pid: String(j.pass.pid), name: j.pass.name || '', levels: j.pass.levels || [], teams: j.pass.teams || [] } : { pid: '' };
}
async function passFor(token, env, ctx) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const h = await sha256(token), key = new Request('https://pass.lssr-api.internal/' + h), cache = caches.default;
  // L1: this data center's cache (seconds); L2: KV for 12 h, so nobody waits on Apps Script after their first
  // request. Re-checked with Apps Script in the background every 5 min; sign-out / account deletion revoke it
  // at once through /ingest (revoke:<sha256>).
  const remember = async pass => {
    const body = JSON.stringify(Object.assign({ at: Date.now() }, pass));
    await cache.put(key, new Response(body, { headers: { 'Cache-Control': 'max-age=' + (pass.pid ? 300 : 60) } }));
    if (pass.pid) await env.LSSR_KV.put('pass:' + h, body, { expirationTtl: 43200 });
    else await env.LSSR_KV.delete('pass:' + h);
  };
  let o = null;
  const hit = await cache.match(key);
  if (hit) { try { o = await hit.json(); } catch (e) {} }
  if (!o) { const kv = await env.LSSR_KV.get('pass:' + h); if (kv) { try { o = JSON.parse(kv); ctx.waitUntil(cache.put(key, new Response(kv, { headers: { 'Cache-Control': 'max-age=300' } }))); } catch (e) {} } }
  if (o) {
    if (o.pid && Date.now() - (o.at || 0) > 5 * 60 * 1000) ctx.waitUntil(askGasPass(token, env).then(p => p ? remember(p) : null).catch(() => {}));
    return o.pid ? o : null;
  }
  const pass = await askGasPass(token, env);
  if (!pass) return null;
  ctx.waitUntil(remember(pass));
  return pass.pid ? pass : null;
}

async function privFile(name, req, env, ctx, cors) {
  if (!FILES.includes(name)) return json({ ok: false, error: 'unknown file' }, 404, cors);
  const pass = await passFor(bearer(req), env, ctx);
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  const levels = pass.levels || [];
  let kvKey = null;
  if (levels.some(l => FULL_LEVELS.includes(l))) kvKey = 'full:' + name;
  else if (levels.includes('leader')) kvKey = 'leader:' + name;
  if (!kvKey) return json({ ok: false, error: 'not part of your access' }, 403, cors);
  const body = await env.LSSR_KV.get(kvKey);
  if (body == null) return json({ ok: false, missing: true, error: kvKey.startsWith('leader:') ? 'not part of your access' : 'not ready' }, kvKey.startsWith('leader:') ? 403 : 404, cors);
  return new Response(body, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}

async function sundayNames(req, env, ctx, cors) {
  const tok = bearer(req);
  if (tok !== DEMO_TOKEN && !(await passFor(tok, env, ctx))) return json({ ok: false, signin: true }, 401, cors);
  const body = await env.LSSR_KV.get('sunday_names');
  if (body == null) return json({ ok: false, missing: true, error: 'names not available right now' }, 404, cors);
  return new Response(body, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors) });
}

async function ingest(req, env, cors) {
  if (!env.INGEST_KEY || !timingSafeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return json({ ok: false, error: 'unauthorized' }, 401, cors);
  const body = await req.json();
  const items = Array.isArray(body && body.items) ? body.items : [];
  const ok = /^(full:|leader:)(dashboard-data|eos-data|joy_bombs|absences|shepherding-data|pathway)\.json$|^sunday_names$|^side:(bap_plans|bap_sched|jg_map|sh_flags|sos_roster)$/;
  let n = 0;
  for (const it of items) {
    const rv = /^revoke:([0-9a-f]{64})$/.exec(String(it && it.key || ''));
    if (rv) {                                                   // a sign-out: forget that sign-in everywhere now
      await env.LSSR_KV.delete('pass:' + rv[1]);
      await caches.default.delete(new Request('https://pass.lssr-api.internal/' + rv[1]));
      n++; continue;
    }
    const fg = /^forget:(\d{1,12})$/.exec(String(it && it.key || ''));
    if (fg) { for (const k of ['me2:', 'rhythm3:', 'needs1:']) await env.LSSR_KV.delete(k + fg[1] + (k === 'needs1:' ? ':1' : '')); n++; continue; }   // account deleted
    if (!it || !ok.test(String(it.key)) || typeof it.value !== 'string' || !it.value) continue;
    try { JSON.parse(it.value); } catch (e) { continue; }       // only valid JSON is ever served
    await env.LSSR_KV.put(it.key, it.value);
    n++;
  }
  return json({ ok: true, stored: n }, 200, cors);
}

// Me page + rhythm chart for the sign-in's owner. The last answer is kept in KV (7 days) and returned at once;
// when it's older than 10 min (Me) / 3 h (rhythm) it is rebuilt in the background for next time. ?fresh=1 waits
// for a new build (after a profile edit). On any Planning Center trouble the page falls back to Apps Script.
async function jrRoute(url, req, env, ctx, cors) {
  const pass = await passFor(bearer(req), env, ctx);
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  const me = url.pathname === '/jr/me', action = me ? 'jr_me' : 'jr_rhythm', kvKey = (me ? 'me2:' : 'rhythm3:') + pass.pid;
  const maxAge = me ? 600000 : 10800000, hdr = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors);
  const build = async () => {
    const t0 = Date.now();
    const out = me ? await jrBuild(pass.pid, env) : await jrRhythmBuild(pass.pid, env);
    if (!out || !out.ok) return null;
    out.for = action; out.buildMs = Date.now() - t0;
    if (me) { out.preview = false; delete out.seasonWhy; }
    const body = JSON.stringify(out);
    await env.LSSR_KV.put(kvKey, JSON.stringify({ at: Date.now(), body }), { expirationTtl: 7 * 86400 });
    return body;
  };
  if (!url.searchParams.get('fresh')) {
    let hit = null; try { hit = JSON.parse((await env.LSSR_KV.get(kvKey)) || 'null'); } catch (e) {}
    if (hit && hit.body) {
      if (Date.now() - (hit.at || 0) > maxAge) ctx.waitUntil(build().catch(() => {}));
      return new Response(hit.body, { status: 200, headers: hdr });
    }
  }
  const body = await build();
  if (!body) return json({ ok: false, fallback: true, error: 'unavailable' }, 503, cors);
  return new Response(body, { status: 200, headers: hdr });
}

// Your Week's serve card. Staff, pastors and team leaders only (it carries team leaders' phone numbers and
// emails). The last answer per person is kept 1 day and returned at once; when it's over 2 min old it is
// rebuilt in the background, so a new sign-up shows on the next look. ?fresh=1 waits for a new build.
async function serveNeedsRoute(url, req, env, ctx, cors) {
  const pass = await passFor(bearer(req), env, ctx);
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  if (!(pass.levels || []).some(l => WEEK_LEVELS.includes(l))) return json({ ok: false, error: 'not part of your access' }, 403, cors);
  const n = Math.min(3, Math.max(1, parseInt(url.searchParams.get('sundays'), 10) || 1));
  const kvKey = 'needs1:' + pass.pid + ':' + n, hdr = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors);
  const build = async () => {
    const t0 = Date.now(), out = await serveNeedsBuild(pass.pid, n, env);
    if (!out || !out.ok) return null;
    out.buildMs = Date.now() - t0;
    const body = JSON.stringify(out);
    await env.LSSR_KV.put(kvKey, JSON.stringify({ at: Date.now(), body }), { expirationTtl: 86400 });
    return body;
  };
  let hit = null;
  if (!url.searchParams.get('fresh')) {
    try { hit = JSON.parse((await env.LSSR_KV.get(kvKey)) || 'null'); } catch (e) {}
    const age = hit && hit.body ? Date.now() - (hit.at || 0) : Infinity;
    if (age < 6 * 3600e3) {                                     // older than that may be last Sunday's: wait for a new one
      if (age > 120000) ctx.waitUntil(build().catch(() => {}));
      return new Response(hit.body, { status: 200, headers: hdr });
    }
  }
  const body = (await build().catch(() => null)) || (hit && hit.body);
  if (!body) return json({ ok: false, error: 'unavailable' }, 503, cors);
  return new Response(body, { status: 200, headers: hdr });
}

// Me → Your rhythm → Serving: open spots on the next four Sundays, for everyone who is signed in.
// Built per person (their own teams come first); the last answer is kept 1 day and returned at once, rebuilt in
// the background when it is over 2 min old. ?fresh=1 waits for a new build. Pending requests are never cached.
async function serveOpenRoute(url, req, env, ctx, cors) {
  const pass = await passFor(bearer(req), env, ctx);
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  const n = Math.min(4, Math.max(1, parseInt(url.searchParams.get('sundays'), 10) || 4));
  const kvKey = 'open1:' + pass.pid + ':' + n;
  const build = async () => {
    const out = await serveOpenBuild(pass.pid, n, env);
    if (!out || !out.ok) return null;
    await env.LSSR_KV.put(kvKey, JSON.stringify({ at: Date.now(), body: out }), { expirationTtl: 86400 });
    return out;
  };
  let base = null, hit = null;
  if (!url.searchParams.get('fresh')) {
    try { hit = JSON.parse((await env.LSSR_KV.get(kvKey)) || 'null'); } catch (e) {}
    const age = hit && hit.body ? Date.now() - (hit.at || 0) : Infinity;
    if (age < 6 * 3600e3) { base = hit.body; if (age > 120000) ctx.waitUntil(build().catch(() => {})); }
  }
  if (!base) base = (await build().catch(() => null)) || (hit && hit.body);
  if (!base) return json({ ok: false, error: 'unavailable' }, 503, cors);
  const reqs = await serveRequestsFor(pass.pid, env, true).catch(() => ({ mine: [], toReview: [] }));
  return json(Object.assign({}, base, { pending: reqs.mine, toReview: reqs.toReview }), 200, cors);
}
async function serveRequestRoute(req, env, ctx, cors) {
  const pass = await passFor(bearer(req), env, ctx);
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  let body = null; try { body = await req.json(); } catch (e) {}
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad request' }, 400, cors);
  const out = await serveRequestPost(pass, body, env).catch(() => ({ ok: false, error: 'server' }));
  return json(out, out.ok ? 200 : 400, cors);
}
