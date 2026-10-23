/* Your Week → Serve · "Still needed this Sunday" (jr_serve_needs; was never built on Apps Script).
 * For the sign-in's owner: each of their Planning Center Services teams on the next Sunday's plan(s), the
 * plan's needed positions on that team per service time, and who to ask (a team leader's name, phone, email).
 * Reply: { ok, for:'jr_serve_needs', sundays:[{ date, planFound, mine:[{ id, name, full, total, open[], byTime[],
 *          signupUrl, leader }], otherTeams }], asOf }
 * Only staff / admin / pastor / leader sign-ins get it (index.js checks the pass); the person is always pass.pid.
 * The plan side (needed positions, plan times) is the same for everyone, so it is cached per data center
 * for 2 min; team leaders and their contact details for 6 h.
 */
import { pcoClient } from './jr.js';

const TZ = 'America/Los_Angeles';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const rel = (x, k) => String((((x && x.relationships) || {})[k] || {}).data ? (x.relationships[k].data.id || '') : '');
const teamKey = n => String(n || '').toLowerCase().replace(/\bteams?\b/g, '').replace(/[^a-z]/g, '');
const nameKey = n => String(n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const NOT_ON_TEAM = /^(hiatus|inactive|on break|retired)$/i;   // parked on a team, not serving on it

async function cached(key, ttl, make) {
  const req = new Request('https://cache.lssr-api.internal/' + encodeURIComponent(key)), c = caches.default;
  const hit = await c.match(req); if (hit) { try { return await hit.json(); } catch (e) {} }
  const v = await make();
  if (v != null) await c.put(req, new Response(JSON.stringify(v), { headers: { 'Cache-Control': 'max-age=' + ttl } }));
  return v;
}
function shortTime(iso) { return iso ? timeFmt.format(new Date(iso)).replace(':00', '') : ''; }

// The next n Sundays (yyyy-mm-dd, Reno time), today included while today's plan is still upcoming.
function nextSundays(n, futureDays) {
  const today = dayFmt.format(new Date()), out = [];
  let d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7);
  if (d.toISOString().slice(0, 10) === today && !futureDays.has(today)) d.setUTCDate(d.getUTCDate() + 7);
  while (out.length < n) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}

// Every service type's upcoming plans → { types:{id:name}, plans:[{ id, type, date }] }.
function upcomingPlans(pco) {
  return cached('svc_plans1', 120, async () => {
    const st = await pco.get('/services/v2/service_types?per_page=100');
    if (!st || !st.data) return null;
    const types = {}, plans = [];
    await Promise.all(st.data.map(async t => {
      types[t.id] = (t.attributes || {}).name || '';
      const p = await pco.get('/services/v2/service_types/' + t.id + '/plans?filter=future&per_page=6&order=sort_date');
      ((p && p.data) || []).forEach(x => { const sd = (x.attributes || {}).sort_date; if (sd) plans.push({ id: String(x.id), type: String(t.id), date: dayFmt.format(new Date(sd)) }); });
    }));
    return { types, plans };
  });
}
// One plan's open spots: [{ team, position, qty, time, at }] (time '' = every service).
function planNeeds(pco, typeId, planId) {
  return cached('svc_needs1:' + planId, 120, async () => {
    const base = '/services/v2/service_types/' + typeId + '/plans/' + planId;
    const [np, pt] = await Promise.all([pco.get(base + '/needed_positions?per_page=100'), pco.get(base + '/plan_times?per_page=100')]);
    if (!np) return null;
    const times = {};
    ((pt && pt.data) || []).forEach(t => { const a = t.attributes || {}; times[t.id] = { name: String(a.name || '').trim() || shortTime(a.starts_at), at: a.starts_at || '' }; });
    return (np.data || []).map(x => {
      const a = x.attributes || {}, tid = a.scheduled_to === 'time' ? rel(x, 'time') : '', t = times[tid] || null;
      return { team: rel(x, 'team'), position: String(a.team_position_name || 'Open spot'), qty: Math.max(1, Number(a.quantity) || 1), time: t ? t.name : '', at: t ? t.at : '' };
    });
  });
}
// Every team → { name, type, leaders:[pid] }.
function allTeams(pco) {
  return cached('svc_teams1', 21600, async () => {
    const out = {}; let url = '/services/v2/teams?per_page=100&include=team_leaders', n = 0;
    while (url && n++ < 5) {
      const r = await pco.get(url); if (!r) return n > 1 ? out : null;
      const tl = {}; (r.included || []).forEach(i => { if (i.type === 'TeamLeader') tl[i.id] = rel(i, 'person') || rel(i, 'people'); });
      (r.data || []).forEach(t => {
        const a = t.attributes || {}; if (a.archived_at || a.deleted_at) return;
        const lead = (((t.relationships || {}).team_leaders || {}).data || []).map(d => tl[d.id]).filter(Boolean);
        out[t.id] = { name: a.name || 'Serve team', type: rel(t, 'service_type'), leaders: lead };
      });
      url = r.links && r.links.next;
    }
    return out;
  });
}
// A leader's name + best phone (mobile first) + email.
function leaderContact(pco, pid) {
  return cached('svc_lead1:' + pid, 21600, async () => {
    const r = await pco.get('/people/v2/people/' + pid + '?include=emails,phone_numbers');
    if (!r || !r.data) return null;
    const a = r.data.attributes || {}, ph = [], em = [];
    (r.included || []).forEach(i => { const ia = i.attributes || {}; if (i.type === 'PhoneNumber' && ia.number) ph.push(ia); if (i.type === 'Email' && ia.address) em.push(ia); });
    const rank = x => (/mobile|cell/i.test(x.location || '') ? 0 : 2) + (x.primary ? 0 : 1);
    ph.sort((x, y) => rank(x) - rank(y)); em.sort((x, y) => (x.primary ? 0 : 1) - (y.primary ? 0 : 1));
    return { name: ((a.nickname || a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.name || '', phone: ph.length ? String(ph[0].number) : '', email: em.length ? String(em[0].address) : '' };
  });
}
// Point leaders by team (from the Point Leader Update Form, in the dashboard file): normalised team → name.
async function pointLeaders(env) {
  return cached('svc_point1', 3600, async () => {
    const out = {};
    try {
      const d = JSON.parse((await env.LSSR_KV.get('full:dashboard-data.json')) || '{}');
      (d.teamsLeaderForms || []).forEach(f => {               // "Worship & Tech" leads both teams
        if (f && f.n && f.l) [f.n].concat(String(f.n).split(/\s*&\s*|\s+and\s+/i)).forEach(n => { out[teamKey(n)] = out[teamKey(n)] || String(f.l); });
      });
    } catch (e) {}
    return out;
  });
}

export async function serveNeedsBuild(pid, sundays, env) {
  const pco = pcoClient(env);
  const [up, teams, tpa, points] = await Promise.all([
    upcomingPlans(pco), allTeams(pco),
    pco.get('/services/v2/people/' + pid + '/person_team_position_assignments?include=team_position&per_page=100'),
    pointLeaders(env)
  ]);
  if (!up || !teams || !tpa) return { ok: false, error: 'Planning Center didn’t answer' };

  // The person's teams (a team where every position they hold is "Hiatus" doesn't count).
  const posOf = {}; (tpa.included || []).forEach(i => { if (i.type === 'TeamPosition') posOf[i.id] = { name: (i.attributes || {}).name || '', team: rel(i, 'team') }; });
  const myTeams = {};
  (tpa.data || []).forEach(x => { const p = posOf[rel(x, 'team_position')]; if (p && p.team && teams[p.team]) myTeams[p.team] = myTeams[p.team] || !NOT_ON_TEAM.test(p.name.trim()); });
  const mine = Object.keys(myTeams).filter(t => myTeams[t]);

  // Who to ask on each of my teams: the point leader if they're a Services team leader, else the first other leader.
  // (Point leader matched on full name, or first initial + last name for "Jeff" vs "Jeffrey".)
  const sameName = (a, b) => { a = nameKey(a); b = nameKey(b); return !!a && !!b && (a === b || (a[0] === b[0] && a.split(' ').pop() === b.split(' ').pop())); };
  const leaders = {};
  await Promise.all(mine.map(async tid => {
    const ls = (teams[tid].leaders || []).filter(l => l !== String(pid)); if (!ls.length) return;
    const point = points[teamKey(teams[tid].name)] || '';
    const cs = (await Promise.all(ls.slice(0, 10).map(l => leaderContact(pco, l)))).filter(Boolean);
    leaders[tid] = cs.find(c => sameName(c.name, point)) || cs[0] || null;
  }));

  const futureDays = new Set(up.plans.map(p => p.date));
  const days = await Promise.all(nextSundays(sundays, futureDays).map(async date => {
    const plans = up.plans.filter(p => p.date === date);
    if (!plans.length) return { date, planFound: false, mine: [], otherTeams: 0 };
    const needs = [].concat(...(await Promise.all(plans.map(p => planNeeds(pco, p.type, p.id)))).map(x => x || []));
    const onPlanTypes = new Set(plans.map(p => p.type)), manyTypes = onPlanTypes.size > 1;
    const rows = mine.filter(tid => onPlanTypes.has(teams[tid].type)).map(tid => {
      const t = teams[tid], open = needs.filter(n => n.team === tid), byT = {};
      open.forEach(n => {
        const label = n.time || (manyTypes ? up.types[t.type] || '' : '');
        const g = byT[label] = byT[label] || { time: label, at: n.at, total: 0, open: [] };
        const same = g.open.find(o => o.position === n.position);
        if (same) same.qty += n.qty; else g.open.push({ position: n.position, qty: n.qty });
        g.total += n.qty;
      });
      const byTime = Object.values(byT).sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || String(a.at).localeCompare(String(b.at))).map(g => ({ time: g.time, total: g.total, open: g.open }));
      const all = {}; open.forEach(n => { all[n.position] = (all[n.position] || 0) + n.qty; });
      const total = open.reduce((s, n) => s + n.qty, 0), L = leaders[tid];
      return { id: tid, name: t.name, full: total === 0, total, open: Object.keys(all).map(p => ({ position: p, qty: all[p] })), byTime,
        signupUrl: '', leader: L ? { name: L.name, phone: L.phone, email: L.email } : null };
    });
    return { date, planFound: true, mine: rows, otherTeams: mine.length - rows.length };
  }));
  return { ok: true, for: 'jr_serve_needs', sundays: days, asOf: new Date().toISOString() };
}

/* ── Me page → Your rhythm → Serving: open spots for the next four Sundays, for EVERY signed-in person ──
 * serveOpenBuild: { ok, for:'jr_serve_open', sundays:[{ date, planFound, teams:[{ id, name, mine, total,
 *   spots:[{ position, qty, time }], leader:{ name, phone, email }|null }] }], myTeams:[id], asOf }
 * Same Planning Center data as serveNeedsBuild (plans, needed positions, team leaders); the point leader
 * is the one to ask on every team (not only the person's own). Teams are sorted by the page: mine first.
 * Sign-up requests (Planning Center scheduling is done by a team's scheduler, so a member can only ask):
 * kept in KV as sreq:<id>; the requester sees "Pending", the team's Planning Center leaders see them listed.
 */
async function pointLeaderFor(pco, team, points, teamsAll) {
  const sameName = (a, b) => { a = nameKey(a); b = nameKey(b); return !!a && !!b && (a === b || (a[0] === b[0] && a.split(' ').pop() === b.split(' ').pop())); };
  const ls = (team.leaders || []).slice(0, 10);
  if (!ls.length) return null;
  const point = points[teamKey(team.name)] || '';
  const cs = (await Promise.all(ls.map(l => leaderContact(pco, l).then(c => c && Object.assign({ pid: l }, c))))).filter(Boolean);
  return cs.find(c => sameName(c.name, point)) || cs[0] || null;
}
export async function serveOpenBuild(pid, sundays, env) {
  const pco = pcoClient(env);
  const [up, teams, tpa, points] = await Promise.all([
    upcomingPlans(pco), allTeams(pco),
    pco.get('/services/v2/people/' + pid + '/person_team_position_assignments?include=team_position&per_page=100'),
    pointLeaders(env)
  ]);
  if (!up || !teams) return { ok: false, error: 'Planning Center didn’t answer' };
  const posOf = {}; ((tpa && tpa.included) || []).forEach(i => { if (i.type === 'TeamPosition') posOf[i.id] = { name: (i.attributes || {}).name || '', team: rel(i, 'team') }; });
  const myOn = {};
  ((tpa && tpa.data) || []).forEach(x => { const p = posOf[rel(x, 'team_position')]; if (p && p.team && teams[p.team]) myOn[p.team] = myOn[p.team] || !NOT_ON_TEAM.test(p.name.trim()); });
  const myTeams = Object.keys(myOn).filter(t => myOn[t]);
  const futureDays = new Set(up.plans.map(p => p.date));
  const dates = nextSundays(sundays, futureDays);
  const perDay = await Promise.all(dates.map(async date => {
    const plans = up.plans.filter(p => p.date === date);
    if (!plans.length) return { date, planFound: false, needs: [] };
    const needs = [].concat(...(await Promise.all(plans.map(p => planNeeds(pco, p.type, p.id)))).map(x => x || []));
    return { date, planFound: true, needs: needs.filter(n => teams[n.team]) };
  }));
  // Leaders are looked up once per team that needs people (cached 6 h), plus the person's own teams.
  const want = new Set(myTeams); perDay.forEach(d => d.needs.forEach(n => want.add(n.team)));
  const lead = {}; await Promise.all([...want].map(async tid => { const c = await pointLeaderFor(pco, teams[tid], points).catch(() => null); lead[tid] = c; }));
  const out = perDay.map(d => {
    if (!d.planFound) return { date: d.date, planFound: false, teams: [] };
    const byTeam = {};
    d.needs.forEach(n => {
      const t = byTeam[n.team] = byTeam[n.team] || { id: n.team, name: teams[n.team].name, mine: myTeams.includes(n.team), total: 0, spots: [] };
      const s = t.spots.find(x => x.position === n.position && x.time === n.time);
      if (s) s.qty += n.qty; else t.spots.push({ position: n.position, qty: n.qty, time: n.time });
      t.total += n.qty;
    });
    const list = Object.values(byTeam).map(t => { const L = lead[t.id]; t.leader = L ? { name: L.name, phone: L.phone, email: L.email, isMe: L.pid === String(pid) } : null; return t; });
    list.sort((a, b) => (b.mine - a.mine) || (b.total - a.total) || a.name.localeCompare(b.name));
    return { date: d.date, planFound: true, teams: list };
  });
  return { ok: true, for: 'jr_serve_open', sundays: out, myTeams: myTeams.map(t => ({ id: t, name: teams[t].name })), asOf: new Date().toISOString() };
}

// ── Sign-up requests ──
const sid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cleanTxt = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
async function kvList(env, key) { try { return JSON.parse((await env.LSSR_KV.get(key)) || '[]'); } catch (e) { return []; } }
// All requests the person made that are still open, and (for a Planning Center team leader) those for their teams.
export async function serveRequestsFor(pid, env, wantLeader) {
  const mine = (await kvList(env, 'sreq_me:' + pid)).filter(r => r.status === 'pending');
  let toReview = [];
  if (wantLeader) {
    const pco = pcoClient(env), teams = await allTeams(pco).catch(() => null);
    if (teams) {
      const led = Object.keys(teams).filter(t => (teams[t].leaders || []).includes(String(pid)));
      toReview = [].concat(...await Promise.all(led.map(t => kvList(env, 'sreq_team:' + t)))).filter(r => r.status === 'pending' && r.date >= dayFmt.format(new Date()));
      toReview.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return { mine, toReview };
}
// body: { action:'request', team, teamName, date, position, time, qty } | { action:'resolve', id, status:'done'|'declined' }
export async function serveRequestPost(pass, body, env) {
  const pid = String(pass.pid);
  if (body.action === 'resolve') {
    const id = cleanTxt(body.id, 40), team = cleanTxt(body.team, 20), status = body.status === 'declined' ? 'declined' : 'done';
    const pco = pcoClient(env), teams = await allTeams(pco).catch(() => null);
    if (!teams || !teams[team] || !(teams[team].leaders || []).includes(pid)) return { ok: false, error: 'only a team leader can do that' };
    const list = await kvList(env, 'sreq_team:' + team), r = list.find(x => x.id === id);
    if (!r) return { ok: false, error: 'not found' };
    r.status = status; r.resolvedBy = pass.name || ''; r.resolvedAt = Date.now();
    await env.LSSR_KV.put('sreq_team:' + team, JSON.stringify(list), { expirationTtl: 60 * 86400 });
    const mine = await kvList(env, 'sreq_me:' + r.pid), m = mine.find(x => x.id === id);
    if (m) { m.status = status; await env.LSSR_KV.put('sreq_me:' + r.pid, JSON.stringify(mine), { expirationTtl: 60 * 86400 }); }
    return { ok: true };
  }
  const team = cleanTxt(body.team, 20), date = cleanTxt(body.date, 10), position = cleanTxt(body.position, 80);
  if (!/^\d+$/.test(team) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !position) return { ok: false, error: 'missing details' };
  const mineAll = await kvList(env, 'sreq_me:' + pid);
  if (mineAll.some(r => r.status === 'pending' && r.team === team && r.date === date && r.position === position)) return { ok: true, already: true };
  if (mineAll.filter(r => r.status === 'pending').length >= 12) return { ok: false, error: 'You have a lot of open requests already — give your leaders a few days.' };
  const r = { id: sid(), pid, name: cleanTxt(pass.name, 80), team, teamName: cleanTxt(body.teamName, 80), date, position, time: cleanTxt(body.time, 30), at: Date.now(), status: 'pending' };
  const tl = await kvList(env, 'sreq_team:' + team); tl.push(r);
  await env.LSSR_KV.put('sreq_team:' + team, JSON.stringify(tl.slice(-100)), { expirationTtl: 60 * 86400 });
  mineAll.push(r);
  await env.LSSR_KV.put('sreq_me:' + pid, JSON.stringify(mineAll.slice(-40)), { expirationTtl: 60 * 86400 });
  return { ok: true, request: r };
}
