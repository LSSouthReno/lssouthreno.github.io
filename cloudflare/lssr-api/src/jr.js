/* Me app on the fast API (Fast Backend Plan P2, step 1): jr_me and jr_rhythm, ported from Code_journey.gs.
 * Same output as the Apps Script versions, built with Planning Center calls made in parallel.
 * Side data that lives in Google Sheets comes from KV, pushed by Apps Script (lssrWorkerPushSide_):
 *   side:bap_plans  { pid: { date, service } }      planned baptisms (BaptismPlan tab)
 *   side:bap_sched  { date, label, byService[] }     the staff Baptisms sheet
 *   side:jg_map     { pid: jointGiverPid }           joint givers (both give)
 *   side:sh_flags   { pid: { m, b, s, g, f, step } } slim shepherding flags for leader rosters (no health, no notes)
 * The person is ALWAYS the sign-in token's owner (pass.pid); nothing is ever read from the page.
 */
const PCO = 'https://api.planningcenteronline.com';
const TZ = 'America/Los_Angeles';
const JR = {
  WF: { requested: '564704', ready: '528797', family: '528798', cgLeader: '535815' },
  CG_TYPE: '441907',
  LEADER_GROUPS: ['elders', 'deacons', 'point leaders', 'serve team leaders', 'cg leaders'],
  LEADER_ROLE: /\b(team lead(er)?|point lead(er)?|captain|coordinator|director)\b/i,
  NOT_LEADER_ROLE: /\b(guide|teacher|helper|assistant)\b/i,
  LINKS: {
    groups: 'https://lssr.churchcenter.com/groups',
    serve: 'https://lssr.churchcenter.com/groups/serve-teams?enrollment=open_signup%2Crequest_to_join&filter=enrollment',
    giving: 'https://lssr.churchcenter.com/giving',
    baptism: 'https://lssr.churchcenter.com/people/forms/764941',
    membership: 'https://livingstoneschurches.com/lssr-membership',
    churchCenter: 'https://lssr.churchcenter.com/me'
  }
};
const SH_FIELD = { assignedElder: '789184', baptized: '790028', baptismDate: '789176', salvationDate: '789177', firstVisit: '789178', membershipStart: '789180' };

// ── helpers ──────────────────────────────────────────────────────────────────
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(d) { return dayFmt.format(d); }
function jrDay(v) {
  const s = String(v || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  const d = new Date(s); return isNaN(d) ? '' : dayKey(d);
}
function jrAge(bd) { if (!bd) return null; const b = new Date(bd + 'T12:00:00'); if (isNaN(b)) return null; return Math.floor((Date.now() - b.getTime()) / (365.25 * 864e5)); }
function nameKey(n) { return String(n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); }
function nameParts(name) { const t = String(name || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean); return { first: t[0] || '', last: t.length > 1 ? t[t.length - 1] : '' }; }
const rel = (x, k) => String((((x && x.relationships) || {})[k] || {}).data ? (x.relationships[k].data.id || '') : '');

// Planning Center allows ~100 requests per 20 s for our app (shared with the Apps Script syncs): at most
// 6 requests in flight per build, and a 429 waits as long as Planning Center's Retry-After says.
export function pcoClient(env) {
  const auth = 'Basic ' + btoa(env.PCO_APP_ID + ':' + env.PCO_SECRET);
  let active = 0; const queue = [];
  const slot = () => new Promise(res => { if (active < 6) { active++; res(); } else queue.push(res); });
  const done = () => { const next = queue.shift(); if (next) next(); else active--; };
  async function get(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : PCO + pathOrUrl;
    for (let i = 0; i < 4; i++) {
      await slot();
      let r; try { r = await fetch(url, { headers: { Authorization: auth } }); } catch (e) { r = null; }
      let body = null, wait = 0;
      if (r && r.ok) { try { body = await r.json(); } catch (e) { body = null; } done(); return body; }
      if (r && r.status === 429) wait = Math.min(20, Number(r.headers.get('Retry-After')) || 2) * 1000;
      done();
      if (r && r.status !== 429 && r.status < 500) return null;
      await new Promise(res => setTimeout(res, wait || 400 * Math.pow(2, i)));
    }
    return null;
  }
  async function all(path, maxPages) {
    let url = path, out = { data: [], included: [] }, n = 0;
    while (url && n++ < (maxPages || 10)) {
      const r = await get(url); if (!r) break;
      out.data = out.data.concat(r.data || []); out.included = out.included.concat(r.included || []);
      url = r.links && r.links.next;
    }
    return out;
  }
  return { get, all };
}
async function kvJson(env, key) { try { const s = await env.LSSR_KV.get(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
// A small per-data-center cache for things that change slowly (team names, who leads which team).
async function cached(key, ttl, make) {
  const req = new Request('https://cache.lssr-api.internal/' + encodeURIComponent(key)), c = caches.default;
  const hit = await c.match(req); if (hit) { try { return await hit.json(); } catch (e) {} }
  const v = await make();
  if (v != null) await c.put(req, new Response(JSON.stringify(v), { headers: { 'Cache-Control': 'max-age=' + ttl } }));
  return v;
}
function firstSundays(n) {
  const today = dayKey(new Date()), y = +today.slice(0, 4), m = +today.slice(5, 7) - 1, out = [];
  for (let k = 0; out.length < n && k < n + 2; k++) {
    const d1 = new Date(Date.UTC(y, m + k, 1)), first = new Date(Date.UTC(y, m + k, 1 + (7 - d1.getUTCDay()) % 7));
    const key = first.toISOString().slice(0, 10);
    if (key >= today) out.push(key);
  }
  return out;
}


// ── Outside group: a non-Living-Stones group a pastor recorded for this person (two PCO custom fields the dashboard creates) ──
async function outsideDefs(pco) {
  return await cached('outsidedefs:v1', 3600, async () => {
    const r = await pco.get('/people/v2/field_definitions?per_page=100'); if (!r || !r.data) return null;
    const o = {}; r.data.forEach(d => { const n = String((d.attributes || {}).name || '').trim().toLowerCase();
      if (n === 'outside group name') o.name = String(d.id); if (n === 'outside group description') o.desc = String(d.id); });
    return o;
  }) || {};
}
async function outsideGroupFor(pid, pco, fd) {
  const od = await outsideDefs(pco);
  if (!fd) { const r = await pco.get('/people/v2/people/' + pid + '/field_data?per_page=100'); fd = {};
    ((r && r.data) || []).forEach(i => { fd[rel(i, 'field_definition')] = (i.attributes || {}).value; }); }
  const name = od.name ? String(fd[od.name] || '').trim() : '';
  return name ? { name, desc: od.desc ? String(fd[od.desc] || '').trim() : '' } : null;
}

// ── jr_me ────────────────────────────────────────────────────────────────────
export async function jrBuild(pid, env) {
  const pco = pcoClient(env), now = Date.now(), yearAgo = new Date(now - 365 * 864e5).toISOString().substring(0, 10);
  const [P, gm, gl, tm, sch, fut, wc, jgMap, bapPlans] = await Promise.all([
    pco.get('/people/v2/people/' + pid + '?include=field_data,households'),
    pco.get('/groups/v2/people/' + pid + '/memberships?per_page=100'),
    pco.get('/groups/v2/people/' + pid + '/groups?per_page=100'),
    pco.get('/services/v2/people/' + pid + '/person_team_position_assignments?include=team_position&per_page=100'),
    pco.get('/services/v2/people/' + pid + '/schedules?filter=past&per_page=100&order=-sort_date'),
    pco.get('/services/v2/people/' + pid + '/schedules?filter=future&per_page=10&order=sort_date'),
    pco.get('/people/v2/people/' + pid + '/workflow_cards?per_page=50'),
    kvJson(env, 'side:jg_map'), kvJson(env, 'side:bap_plans')
  ]);
  if (!P || !P.data) return { ok: false, error: 'We couldn’t load your profile.', fallback: true };
  const a = P.data.attributes || {}, fd = {}, hhIds = [];
  (P.included || []).forEach(i => {
    if (i.type === 'FieldDatum') fd[rel(i, 'field_definition')] = (i.attributes || {}).value;
    if (i.type === 'Household') hhIds.push(i.id);
  });
  const me = { pid, first: a.nickname || a.given_name || a.first_name || '', last: a.last_name || '', name: a.name || '', avatar: a.avatar || '',
    child: !!a.child, gender: a.gender || '', membership: a.membership || '', since: a.created_at || '' };

  // Giving (pattern only — never amounts), household and kids in parallel
  const unit = jgMap && jgMap[String(pid)] ? [String(pid), String(jgMap[String(pid)])] : [String(pid)];
  const [H, givingParts] = await Promise.all([
    hhIds.length ? pco.get('/people/v2/households/' + hhIds[0] + '?include=people') : null,
    Promise.all(unit.map(gid => Promise.all([
      pco.all('/giving/v2/people/' + gid + '/donations?per_page=100&where[received_at][gte]=' + yearAgo, 10),
      pco.get('/giving/v2/people/' + gid + '/recurring_donations?per_page=25')
    ])))
  ]);
  let spouse = null; const kids = [];
  ((H && H.included) || []).forEach(x => {
    if (x.type !== 'Person' || String(x.id) === String(pid)) return;
    const xa = x.attributes || {};
    if (xa.child) kids.push({ pid: x.id, first: xa.first_name || '', age: jrAge(xa.birthdate) });
    else if (!spouse) spouse = { pid: x.id, first: xa.first_name || '', membership: xa.membership || '' };
  });
  let gifts = 0, last = null, recurring = false; const months = {};
  givingParts.forEach(([don, rd]) => {
    (don.data || []).forEach(d => { const at = (d.attributes || {}).received_at; if (!at) return; gifts++; months[at.substring(0, 7)] = 1; if (!last || at > last) last = at; });
    ((rd && rd.data) || []).forEach(x => { if (/active/i.test(String((x.attributes || {}).status || ''))) recurring = true; });
  });
  const giving = { months: Object.keys(months).length, recurring, lastDays: last ? Math.floor((now - Date.parse(last)) / 864e5) : null, any: gifts > 0 };

  // Groups with role + joined date
  const roles = {}; ((gm && gm.data) || []).forEach(m => { roles[rel(m, 'group')] = m.attributes || {}; });
  const groups = ((gl && gl.data) || []).map(g => {
    const r = roles[g.id] || {}, gt = rel(g, 'group_type');
    return { id: String(g.id), name: (g.attributes || {}).name || 'Group', leader: String(r.role || '') === 'leader', joined: r.joined_at || '', cg: gt === JR.CG_TYPE };
  });

  // Serving
  const teams = {}, posName = {}, posTeam = {}, leadRoles = [], upcoming = []; let served = 0;
  ((tm && tm.included) || []).forEach(i => { if (i.type !== 'TeamPosition') return; posName[i.id] = (i.attributes || {}).name || ''; posTeam[i.id] = rel(i, 'team'); });
  ((tm && tm.data) || []).forEach(x => {
    const tp = rel(x, 'team_position'), pn = posName[tp] || '';
    if (JR.LEADER_ROLE.test(pn) && !JR.NOT_LEADER_ROLE.test(pn)) leadRoles.push(pn);
    const k = posTeam[tp] || tp; teams[k] = teams[k] || { position: pn, since: (x.attributes || {}).created_at || '' };
  });
  ((sch && sch.data) || []).forEach(s => {
    const sa = s.attributes || {};
    if (String(sa.sort_date || '') >= yearAgo && String(sa.status || '') === 'C') served++;
    if (sa.team_name) Object.keys(teams).forEach(k => { if (!teams[k].name && teams[k].position && sa.team_position_name === teams[k].position) teams[k].name = sa.team_name; });
  });
  ((fut && fut.data) || []).forEach(s => {
    const sa = s.attributes || {};
    if (String(sa.status || '') === 'D') return;
    upcoming.push({ date: String(sa.sort_date || '').substring(0, 10), what: 'You’re serving: ' + (sa.team_name || 'a team') + (sa.team_position_name ? ' · ' + sa.team_position_name : '') });
    if (sa.team_name) Object.keys(teams).forEach(k => { if (!teams[k].name && teams[k].position === sa.team_position_name) teams[k].name = sa.team_name; });
  });
  const teamNames = await Promise.all(Object.keys(teams).map(k => teamName(k, pco)));
  const teamList = Object.keys(teams).map((k, i) => ({ name: teamNames[i] || teams[k].name || teams[k].position || 'A serve team', since: teams[k].since }))
    .filter((t, i, arr) => arr.findIndex(x => x.name === t.name) === i);

  // Kids check-ins this year (in parallel)
  await Promise.all(kids.map(async k => {
    const ci = await pco.get('/check-ins/v2/people/' + k.pid + '/check_ins?order=-created_at&per_page=100'), days = {};
    ((ci && ci.data) || []).forEach(x => { const d = String((x.attributes || {}).created_at || '').substring(0, 10); if (d && d >= yearAgo) days[d] = 1; });
    k.checkIns = Object.keys(days).length;
  }));

  // Workflows (baptism, new family member, leader pipeline)
  const wfs = {};
  ((wc && wc.data) || []).forEach(cd => {
    const wid = rel(cd, 'workflow'), st = String((cd.attributes || {}).stage || '');
    const key = Object.keys(JR.WF).filter(k => JR.WF[k] === wid)[0]; if (!key) return;
    if (st === 'completed') wfs[key] = wfs[key] || 'done';
    else if (st !== 'removed') wfs[key] = 'active';
  });
  let baptismPlan = null;
  const pl = bapPlans && bapPlans[String(pid)]; if (pl && pl.date) baptismPlan = { date: pl.date, service: pl.service };
  if (!baptismPlan && wfs.ready === 'active') {
    const bs = await kvJson(env, 'side:bap_sched');
    const mine = nameParts(me.first + ' ' + me.last), legal = nameParts((a.first_name || '') + ' ' + me.last);
    ((bs && bs.byService) || []).forEach(g => g.people.forEach(x => {
      const n = nameParts(x.name);
      if (!baptismPlan && n.last && n.last === mine.last && (n.first === mine.first || n.first === legal.first)) baptismPlan = { date: bs.date, service: g.service };
    }));
  }

  const baptized = String(fd[SH_FIELD.baptized] || '').toLowerCase() === 'true' || !!fd[SH_FIELD.baptismDate] || wfs.ready === 'done';
  const elderFull = String(fd[SH_FIELD.assignedElder] || ''), pastor = elderFull ? { name: elderFull } : null;
  const member = /^(member|deacon|pastor)$/i.test(String(me.membership).trim());
  const outsideGroup = await outsideGroupFor(pid, pco, fd);
  const inCG = groups.some(g => g.cg), inGroup = inCG || !!outsideGroup;   // a pastor-recorded outside group counts as the Group step
  const why = [];
  const cgLead = groups.filter(g => g.cg && g.leader), leaderGroups = groups.filter(g => JR.LEADER_GROUPS.indexOf(nameKey(g.name)) >= 0);
  cgLead.forEach(g => why.push('Leads ' + g.name)); leaderGroups.forEach(g => why.push('In the ' + g.name + ' group')); leadRoles.forEach(r => why.push('Serve role: ' + r));
  const leads = why.length > 0, serving = teamList.length > 0;
  let season = 'exploring', seasonWhy = [];
  if (baptized) seasonWhy.push('Baptized'); if (member) seasonWhy.push('Family Member (' + me.membership + ')');
  if (inCG) seasonWhy.push('In a community group'); else if (outsideGroup) seasonWhy.push('In a group: ' + outsideGroup.name); if (serving) seasonWhy.push('Serving: ' + teamList.map(t => t.name).join(', '));
  if (baptized || member) season = 'belonging';
  if ((baptized || member) && (inGroup || serving)) season = 'growing';
  if (leads) { season = 'leading'; seasonWhy = seasonWhy.concat(why); }

  let ms = [];
  const add = (label, d) => { const k = jrDay(d); if (k) ms.push({ label, date: k }); };
  add('First connected with Living Stones', fd[SH_FIELD.firstVisit] || me.since);
  add('Said yes to Jesus', fd[SH_FIELD.salvationDate]);
  add('Baptized', fd[SH_FIELD.baptismDate]);
  add('Became a Family Member', fd[SH_FIELD.membershipStart]);
  groups.filter(g => g.cg).forEach(g => add((g.leader ? 'Started leading ' : 'Joined ') + g.name, g.joined));
  teamList.forEach(t => add('Joined ' + (/team$/i.test(t.name) ? 'the ' + t.name : 'the ' + t.name + ' team'), t.since));
  ms.sort((x, y) => x.date < y.date ? -1 : 1);
  if (ms.length > 9) ms = ms.slice(0, 1).concat(ms.slice(-8));

  if (baptismPlan) upcoming.push({ date: baptismPlan.date, what: 'Your baptism · ' + baptismPlan.service + ' service' });
  const nextBap = firstSundays(1)[0];
  if (nextBap && baptized) upcoming.push({ date: nextBap, what: 'Baptism Sunday — know someone who’s ready? Invite them' });
  upcoming.sort((x, y) => x.date < y.date ? -1 : 1);

  const ctx = { me, spouse, kids, groups, inCG, inGroup, teams: teamList, serving, served, giving, wfs, baptized, member, leads, pastor };
  return { ok: true, person: { first: me.first, name: me.name, avatar: me.avatar, since: me.since, membership: me.membership },
    spouse: spouse ? { first: spouse.first } : null, kids: kids.map(k => ({ first: k.first, age: k.age, checkIns: k.checkIns || 0 })),
    season, groups: groups.filter(g => g.cg).map(g => ({ name: g.name, leader: g.leader, joined: g.joined })),
    otherGroups: groups.filter(g => !g.cg).length, outsideGroup,
    serving: { teams: teamList, servedThisYear: served }, giving,
    baptized, member, baptism: { requested: wfs.requested === 'active', ready: wfs.ready === 'active', plan: baptismPlan },
    milestones: ms, upcoming: upcoming.slice(0, 5), pastor, steps: jrSteps(ctx), links: JR.LINKS, asOf: new Date().toISOString(),
    leading: await jrLeading(pid, groups, Object.keys(teams), env, pco),
    seasonWhy };
}
function teamName(teamId, pco) {
  if (!teamId) return Promise.resolve('');
  return cached('team:' + teamId, 21600, async () => { const t = await pco.get('/services/v2/teams/' + teamId); return (t && t.data && t.data.attributes && t.data.attributes.name) || null; }).then(n => n || '');
}

// ── leaders' rosters ─────────────────────────────────────────────────────────
async function jrLeading(pid, groups, teamIds, env, pco) {
  return cached('lead3:' + pid, 21600, async () => {
    const out = { groups: [], teams: [] };
    try {
      const sh = (await kvJson(env, 'side:sh_flags')) || {};
      const cgLed = groups.filter(g => g.cg && g.leader);
      const ledTeams = await teamsLed(pid, pco);
      const [gRes, tRes] = await Promise.all([
        Promise.all(cgLed.map(async g => {
          const ms = await pco.get('/groups/v2/groups/' + g.id + '/memberships?include=person&per_page=100'), ppl = {}, rows = [];
          ((ms && ms.included) || []).forEach(x => { if (x.type === 'Person') ppl[String(x.id)] = x.attributes || {}; });
          ((ms && ms.data) || []).forEach(m => {
            const mid = rel(m, 'person'); if (!mid || mid === String(pid)) return;
            const pa = ppl[mid] || {};
            rows.push({ pid: mid, name: ((pa.first_name || '') + ' ' + (pa.last_name || '')).trim(), avatar: pa.avatar_url || '', leader: String((m.attributes || {}).role || '') === 'leader' });
          });
          return { id: g.id, name: g.name, members: await rosterFlags(rows, 'group', sh, pco) };
        })),
        Promise.all(ledTeams.map(async t => {
          const tp = await pco.get('/services/v2/teams/' + t.id + '/people?per_page=100'), rows = [];
          ((tp && tp.data) || []).forEach(p => {
            const pa = p.attributes || {}; if (String(p.id) === String(pid)) return;
            rows.push({ pid: String(p.id), name: ((pa.first_name || '') + ' ' + (pa.last_name || '')).trim() || pa.full_name || '', avatar: pa.photo_thumbnail_url || pa.photo_url || '', leader: false });
          });
          return { id: t.id, name: t.name, members: await rosterFlags(rows, 'team', sh, pco) };
        }))
      ]);
      out.groups = gRes; out.teams = tRes;
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  });
}
async function teamsLed(pid, pco) {
  const tl = await pco.get('/services/v2/people/' + pid + '/team_leaders?include=team&per_page=100');
  if (tl && tl.data && tl.data.length) {
    const names = {}, found = [];
    (tl.included || []).forEach(x => { if (x.type === 'Team') names[x.id] = (x.attributes || {}).name || ''; });
    for (const x of tl.data) { const tid = rel(x, 'team'); if (tid && !found.some(f => f.id === tid)) found.push({ id: tid, name: names[tid] || (await teamName(tid, pco)) || 'Serve team' }); }
    return found;
  }
  const map = await cached('team_leaders', 21600, async () => {
    const m = {}, teams = await pco.get('/services/v2/teams?per_page=100');
    await Promise.all(((teams && teams.data) || []).map(async t => {
      const ld = await pco.get('/services/v2/teams/' + t.id + '/team_leaders?per_page=50');
      ((ld && ld.data) || []).forEach(l => { const lp = rel(l, 'person'); if (lp) (m[lp] = m[lp] || []).push({ id: String(t.id), name: (t.attributes || {}).name || '' }); });
    }));
    return m;
  });
  return (map && map[String(pid)]) || [];
}
async function rosterFlags(rows, kind, sh, pco) {
  const ids = rows.map(r => r.pid), memb = {}, bap = {};
  const readFd = list => (list || []).forEach(x => {
    if (x.type !== 'FieldDatum') return;
    const def = rel(x, 'field_definition'), who = rel(x, 'customizable'), v = String((x.attributes || {}).value || '');
    if (!who) return;
    if (def === SH_FIELD.baptized && /^true$/i.test(v)) bap[who] = true;
    if (def === SH_FIELD.baptismDate && v) bap[who] = true;
  });
  const chunks = []; for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
  await Promise.all(chunks.map(async chunk => {
    const pr = await pco.get('/people/v2/people?where[id]=' + chunk.join(',') + '&include=field_data&per_page=100');
    if (pr && pr.data && pr.data.length) { pr.data.forEach(p => { memb[String(p.id)] = (p.attributes || {}).membership || ''; }); readFd(pr.included); return; }
    await Promise.all(chunk.map(async id => { const one = await pco.get('/people/v2/people/' + id + '?include=field_data'); if (one && one.data) { memb[id] = ((one.data.attributes || {}).membership) || ''; readFd(one.included); } }));
  }));
  const extra = await Promise.all(rows.map(async r => {
    const s = sh[r.pid] || null;
    if (s) return {};
    if (kind === 'group') { const ta = await pco.get('/services/v2/people/' + r.pid + '/person_team_position_assignments?per_page=1'); return { serving: !!(ta && ta.data && ta.data.length) }; }
    const gl = await pco.get('/groups/v2/people/' + r.pid + '/groups?per_page=50');
    return { inGroup: ((gl && gl.data) || []).some(g => rel(g, 'group_type') === JR.CG_TYPE) };
  }));
  return rows.map((r, i) => {
    const s = sh[r.pid] || null, m = memb[r.pid] || (s ? s.m : '') || '';
    const fam = /^(member|deacon|pastor)$/i.test(String(m).trim());
    let serving = null, inGroup = null;
    const baptized = !!bap[r.pid] || !!(s && s.b), inProcess = !!(s && s.f);
    if (s) { serving = !!s.s; inGroup = !!s.g; }
    if (kind === 'group' && serving === null && 'serving' in extra[i]) serving = extra[i].serving;
    if (kind === 'team' && inGroup === null && 'inGroup' in extra[i]) inGroup = extra[i].inGroup;
    let step = '';
    const shStep = s && s.step ? String(s.step) : '';
    if (inProcess) step = 'In the Family Member process — cheer them on to finish';
    else if (!fam) step = 'Invite them to become a Family Member';
    else if (kind === 'group' && serving === false) step = 'Invite them to serve on a team';
    else if (kind === 'team' && inGroup === false) step = 'Invite them to a community group';
    else if (baptized === false) step = 'Ask whether they’ve thought about baptism';
    else if (shStep && !/giv|generos|tith|re-?establish|contact|reach out|check in|care|pray|health|wander|lost|crisis|concern/i.test(shStep)) step = shStep;
    else step = r.leader ? 'Leading alongside you — thank them' : 'Connected and serving — ask who they could invite';
    return { pid: r.pid, name: r.name, avatar: r.avatar, leader: r.leader, familyMember: fam, inProcess, serving, inGroup, baptized, step };
  }).sort((a, b) => (b.leader ? 1 : 0) - (a.leader ? 1 : 0) || a.name.localeCompare(b.name));
}

// ── next steps (same words as Code_journey.gs jrSteps_) ───────────────────────
function jrSteps(c) {
  const S = [], L = JR.LINKS, adult = !c.me.child;
  const spouseHere = c.spouse && /^(member|deacon|pastor|attender|regular attender)$/i.test(String(c.spouse.membership || '').trim());
  if (c.wfs.requested === 'active' || c.wfs.ready === 'active') {
    S.push({ id: 'baptism-on-way', kind: 'celebrate', title: 'You’re on the road to baptism',
      why: (c.pastor ? c.pastor.name.split(' ')[0] + ' is walking with you' : 'A pastor is walking with you') + ' — we can’t wait to celebrate with you.', btn: null });
  } else if (!c.baptized && adult) {
    S.push({ id: 'baptism', title: 'Have you thought about being baptized?',
      why: 'Baptism is a joyful public step of following Jesus. Let us know you’re interested and a pastor will reach out to talk it through — no pressure.', btn: 'I’m interested', url: L.baptism });
  }
  if (adult && !c.member && c.wfs.family !== 'active') {
    S.push({ id: 'membership', title: 'Become a Family Member',
      why: 'If Living Stones feels like home, membership is how we say “we’re in this together” — you’ll meet a pastor and hear our story.', btn: 'Learn more', url: L.membership });
  }
  if (adult && !c.inCG) {
    if (spouseHere) S.push({ id: 'group-couples', title: 'Join a group with ' + c.spouse.first,
      why: 'Groups are where friendships at Living Stones really form. A couples or co-ed group lets you both grow alongside other people in your season.', btn: 'See groups', url: L.groups });
    else S.push({ id: 'group', title: 'Find a group',
      why: 'Groups are where friendships at Living Stones really form — a few people who know your name, pray for you, and open the Bible together.', btn: 'See groups', url: L.groups });
  }
  if (adult && !c.serving) {
    if (c.kids.length) S.push({ id: 'serve-kids', title: 'Try serving in Stepping Stones',
      why: 'Your kids are part of Stepping Stones — many parents serve once a month alongside a friend, and it’s a great way to know their world.', btn: 'Try a Sunday', url: L.serve });
    else S.push({ id: 'serve', title: 'Find a place to serve',
      why: 'Serving is one of the best ways to belong — you meet people, use your gifts, and help someone else take their next step.', btn: 'Find a team', url: L.serve });
  }
  if (adult && c.inGroup && c.serving && !c.leads) {
    S.push({ id: 'lead', title: 'Have you thought about leading?',
      why: 'You’re already connected and serving — you might be exactly the person to help others take their next step. Talk it over with your pastor.', btn: 'Tell my pastor', action: 'note:I’d like to talk about leading a group or team.' });
  }
  if (adult && !c.giving.any) {
    S.push({ id: 'give', title: 'Generosity is part of the journey',
      why: 'Giving is an act of worship and trust. Wherever you are, you can start small — and we’re grateful for every step.', btn: 'Give online', url: L.giving });
  } else if (adult && c.giving.any && !c.giving.recurring && c.giving.months < 6) {
    S.push({ id: 'give-recurring', title: 'Make generosity a rhythm',
      why: 'A recurring gift is an easy way to make giving part of your week — you can change or pause it anytime.', btn: 'Set up recurring giving', url: L.giving });
  }
  if (!S.length || (S.length === 1 && S[0].kind === 'celebrate')) {
    S.push({ id: 'invite', title: 'Share Jesus with someone',
      why: 'You’re connected, serving and giving — thank you. Now think of one person who needs Jesus this season. Invite a friend to Sunday, share your story, or share the gospel.', btn: 'Share' });
  }
  return S.slice(0, 3);
}

// ── jr_rhythm ────────────────────────────────────────────────────────────────
const WEEKS = 26;
export async function jrRhythmBuild(pid, env) {
  const pco = pcoClient(env), now = new Date(), today = dayKey(now), from = dayKey(new Date(now.getTime() - WEEKS * 7 * 864e5));
  const [gl, gm, sch, fut, tm, outsideGroup] = await Promise.all([
    pco.get('/groups/v2/people/' + pid + '/groups?per_page=100'),
    pco.get('/groups/v2/people/' + pid + '/memberships?per_page=100'),
    pco.get('/services/v2/people/' + pid + '/schedules?filter=past&per_page=100&order=-sort_date'),
    pco.get('/services/v2/people/' + pid + '/schedules?filter=future&per_page=5&order=sort_date'),
    pco.get('/services/v2/people/' + pid + '/person_team_position_assignments?per_page=1'),
    outsideGroupFor(pid, pco, null)
  ]);
  if (!gl && !sch) return { ok: false, error: 'Planning Center didn’t answer', fallback: true };
  const cgs = ((gl && gl.data) || []).filter(g => rel(g, 'group_type') === JR.CG_TYPE).slice(0, 3)
    .map(g => ({ id: String(g.id), name: (g.attributes || {}).name || 'Your group', url: (g.attributes || {}).public_church_center_web_url || '' }));
  const lead = {}; ((gm && gm.data) || []).forEach(m => { if (String((m.attributes || {}).role || '') === 'leader') lead[rel(m, 'group')] = 1; });
  const attended = {}, met = {}, meetings = []; let tracked = false;
  await Promise.all(cgs.map(async g => {
    let evs = [], url = '/groups/v2/groups/' + g.id + '/events?filter=past&order=-starts_at&per_page=50';
    let r = await pco.get(url);
    if (!r) { url = '/groups/v2/groups/' + g.id + '/events?per_page=100'; r = await pco.get(url); }
    let guard = 0;
    while (r && guard++ < 6) {
      let stop = false;
      (r.data || []).forEach(ev => {
        const at = ev.attributes || {}, d = at.starts_at ? dayKey(new Date(at.starts_at)) : '';
        if (!d || at.canceled) return;
        if (d < from) { stop = true; return; }
        if (d <= today) evs.push({ id: String(ev.id), d });
      });
      const nx = r.links && r.links.next;
      if (!nx || (stop && /order=-starts_at/.test(url))) break;
      r = await pco.get(nx);
    }
    evs.sort((x, y) => x.d < y.d ? 1 : -1); evs = evs.slice(0, 40);
    const atts = await Promise.all(evs.map(async ev => (await pco.get('/groups/v2/events/' + ev.id + '/attendances?per_page=100&include=person')) || (await pco.get('/groups/v2/events/' + ev.id + '/attendances?per_page=100'))));
    evs.forEach((ev, i) => {
      met[ev.d] = 1;
      const rows = (atts[i] && atts[i].data) || [], ppl = {}; let n = 0, me = false; const names = [];
      ((atts[i] && atts[i].included) || []).forEach(x => { if (x.type === 'Person') ppl[String(x.id)] = x.attributes || {}; });
      rows.forEach(x => {
        if ((x.attributes || {}).attended !== true) return;
        tracked = true; n++;
        const xid = rel(x, 'person');
        if (xid === String(pid)) { attended[ev.d] = 1; me = true; }
        if (lead[g.id]) { const pa = ppl[xid] || {}; names.push(String(((pa.first_name || '') + ' ' + (pa.last_name || '')).trim() || 'A guest')); }
      });
      const m = { d: ev.d, g: g.name, n, me, took: rows.length > 0, leader: !!lead[g.id], gid: g.id, url: 'https://lssr.churchcenter.com/my/groups/' + g.id + '/events/' + ev.id };   // Church Center's own leader page for this meeting (+ '/attendance' to take it); works for unlisted groups too
      if (lead[g.id]) m.names = names.sort();
      meetings.push(m);
    });
  }));
  const gDates = Object.keys(attended).sort();
  const sDates = {}, servedList = []; let lastServed = '', next = '';
  ((sch && sch.data) || []).forEach(s => {
    const sa = s.attributes || {}, d = sa.sort_date ? dayKey(new Date(sa.sort_date)) : '';
    if (!d || String(sa.status || '') === 'D' || d > today) return;
    if (!lastServed || d > lastServed) lastServed = d;
    if (d >= from) { sDates[d] = 1; servedList.push({ d, team: sa.team_name || '', pos: sa.team_position_name || '' }); }
  });
  ((fut && fut.data) || []).forEach(s => { const sa = s.attributes || {}, d = sa.sort_date ? dayKey(new Date(sa.sort_date)) : ''; if (d && String(sa.status || '') !== 'D' && (!next || d < next)) next = d; });
  const onTeam = !!((tm && tm.data) || []).length || !!lastServed || !!next;
  return { ok: true, from, today, weeks: WEEKS, asOf: now.toISOString(),
    group: { inGroup: cgs.length > 0 || !!outsideGroup, outside: outsideGroup, names: cgs.map(g => g.name), tracked, dates: gDates, last: gDates.length ? gDates[gDates.length - 1] : '', meetings: Object.keys(met).length,
      list: meetings.sort((x, y) => x.d < y.d ? -1 : 1), leads: Object.keys(lead).length > 0 },
    serve: { onTeam, dates: Object.keys(sDates).sort(), last: lastServed, next, list: servedList.sort((x, y) => x.d < y.d ? -1 : 1) } };
}
