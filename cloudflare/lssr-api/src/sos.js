/* Staff OS on D1 (Fast Backend Plan P2 step 2).
 *
 * The to-dos (StaffTasks) and plans (StaffPlans: rocks, boulders, annual plan, Core Strategies, conference notes…)
 * live in the D1 database SOS_DB instead of Google Sheets. This file is a faithful port of the storage half of
 * Code_staff_os.gs: same actions, same row shapes, same replies (plus `for: <action>`, like Apps Script's echo).
 * The roster (names, roles, PIN flags) stays in Sheets; Apps Script pushes it here as KV side:sos_roster.
 *
 * Callers
 *   · the page, with its phone sign-in pass (staff / admin only):  GET /sos/data?who= · GET /sos/roster · POST /sos
 *   · Apps Script (X-Ingest-Key), which forwards every sos_* call it still receives here (old pages, fallbacks),
 *     runs the one-time copy from the sheets (sos_migrate) and keeps a backup copy in the sheets (sos_export).
 * Every write may carry `rid`: the first reply is kept 2 days and a retry gets that reply instead of a second write.
 */

const TASK_COLS = ['id', 'owner', 'title', 'notes', 'status', 'due', 'priority', 'assignedBy', 'createdAt', 'updatedAt', 'planId'];
const PLAN_COLS = ['id', 'owner', 'type', 'title', 'detail', 'period', 'status', 'progress', 'metric', 'target', 'current', 'parentId', 'createdAt', 'updatedAt'];
// Columns the sheet keeps as plain text (sosTaskTextFormat_ / sosPlanTextFormat_).
const TEXT_COLS = { tasks: ['due'], plans: ['title', 'detail', 'period', 'metric', 'target', 'current'] };
const WRITES = ['sos_task_add', 'sos_task_update', 'sos_task_delete', 'sos_plan_add', 'sos_plan_update', 'sos_plan_delete', 'sos_import_plans'];
const STAFF = ['staff', 'admin'];

const s = v => String(v || '');                      // the sheet code's String(body.x || '')
function sosId() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
// A value as the sheet would hand it back: empty → '', objects → JSON text, text columns → text.
function cell(v, textCol) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return textCol ? String(v) : (v ? 'TRUE' : 'FALSE');
  if (textCol && typeof v === 'number') return String(v);
  return v;
}
function ph(n) { return Array(n).fill('?').join(','); }

async function roster(env) {
  const r = await env.LSSR_KV.get('side:sos_roster');
  if (!r) return null;
  try { const a = JSON.parse(r); return Array.isArray(a) ? a : null; } catch (e) { return null; }
}

async function rowsFor(env, table, who) {
  const r = await env.SOS_DB.prepare('SELECT * FROM ' + table + ' WHERE owner = ? ORDER BY rowid').bind(who).all();
  return r.results || [];
}

// sos_data: the person's tasks, the ones others assigned them, their plans, and the roster.
async function sosData(env, who, rost) {
  const [tasks, plans] = await Promise.all([rowsFor(env, 'tasks', who), rowsFor(env, 'plans', who)]);
  const assigned = tasks.filter(t => t.assignedBy && String(t.assignedBy) !== who);
  return { ok: true, who, tasks, assigned, plans, roster: rost };
}

async function insertRow(env, table, cols, vals) {
  return env.SOS_DB.prepare('INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + ph(cols.length) + ')').bind(...vals).run();
}

async function taskAdd(env, b) {
  const owner = s(b.owner).trim(), assignedBy = s(b.assignedBy).trim();
  if (!owner) return { ok: false, error: 'Missing owner.' };
  const now = Date.now(), id = sosId();
  await insertRow(env, 'tasks', TASK_COLS, [id, owner, s(b.title).trim(), s(b.notes), 'open', s(b.due), String(b.priority || 'normal'), assignedBy, now, now, s(b.planId)]);
  return { ok: true, id, createdAt: now };
}
async function planAdd(env, b) {
  const owner = s(b.owner).trim();
  if (!owner) return { ok: false, error: 'Missing owner.' };
  const now = Date.now(), id = sosId();
  await insertRow(env, 'plans', PLAN_COLS, [id, owner, String(b.type || 'goal'), s(b.title).trim(), s(b.detail), s(b.period),
    String(b.status || 'active'), Number(b.progress || 0), s(b.metric), s(b.target), s(b.current), s(b.parentId), now, now]);
  return { ok: true, id };
}
async function rowUpdate(env, table, b) {
  const cols = table === 'tasks' ? TASK_COLS : PLAN_COLS, text = TEXT_COLS[table];
  const set = [], vals = [];
  cols.forEach(c => {
    if (c === 'id' || c === 'createdAt' || c === 'updatedAt' || !Object.prototype.hasOwnProperty.call(b, c)) return;
    set.push(c + ' = ?'); vals.push(cell(b[c], text.includes(c)));
  });
  set.push('updatedAt = ?'); vals.push(Date.now());
  const r = await env.SOS_DB.prepare('UPDATE ' + table + ' SET ' + set.join(', ') + ' WHERE id = ?').bind(...vals, String(b.id)).run();
  return r.meta && r.meta.changes ? { ok: true } : { ok: false, error: 'Not found.' };
}
async function rowDelete(env, table, id) {
  const r = await env.SOS_DB.prepare('DELETE FROM ' + table + ' WHERE id = ?').bind(String(id)).run();
  return r.meta && r.meta.changes ? { ok: true } : { ok: false, error: 'Not found.' };
}

// Same as sosImportPlans_: replace this person's earlier import with the same tag; steps keep their done status
// by title and goals keep their progress. All in one batch (one transaction).
async function importPlans(env, b) {
  if (b.confirm !== 'lssr') return { ok: false, error: 'confirm required' };
  const owner = s(b.owner).trim(), tag = s(b.tag).trim();
  if (!owner || !tag) return { ok: false, error: 'owner and tag required' };
  const marker = '[import:' + tag + ']';
  const oldGoals = ((await env.SOS_DB.prepare("SELECT * FROM plans WHERE owner = ? AND type IN ('goal','objective') AND instr(CAST(detail AS TEXT), ?) > 0 ORDER BY rowid").bind(owner, marker).all()).results) || [];
  const oldIds = new Set(oldGoals.map(g => String(g.id)));
  let oldSteps = [];
  if (oldIds.size) oldSteps = ((await env.SOS_DB.prepare("SELECT * FROM plans WHERE type = 'step' AND parentId IN (" + ph(oldIds.size) + ')').bind(...oldIds).all()).results) || [];
  const doneByTitle = {}, progByTitle = {};
  oldSteps.forEach(st => { if (st.status === 'done') doneByTitle[String(st.title)] = true; });
  oldGoals.forEach(g => { progByTitle[String(g.title)] = Number(g.progress || 0); });
  const kill = oldGoals.concat(oldSteps).map(r => String(r.id));
  const stmts = kill.map(id => env.SOS_DB.prepare('DELETE FROM plans WHERE id = ?').bind(id));
  const now = Date.now(); let created = 0;
  const ins = env.SOS_DB.prepare('INSERT INTO plans (' + PLAN_COLS.join(',') + ') VALUES (' + ph(PLAN_COLS.length) + ')');
  (b.goals || []).forEach(g => {
    const gid = sosId(), title = s(g.title).trim();
    const detail = s(g.detail) + (g.detail ? ' ' : '') + marker;
    stmts.push(ins.bind(gid, owner, String(g.type || 'goal'), title, detail, s(g.period), 'active', progByTitle[title] || 0, s(g.metric), s(g.target), '', '', now, now));
    created++;
    (g.steps || []).forEach((t, k) => {
      t = s(t).trim(); if (!t) return;
      stmts.push(ins.bind(sosId() + k, owner, 'step', t, '', '', doneByTitle[t] ? 'done' : 'active', 0, '', '', '', gid, now + k + 1, now + k + 1));
      created++;
    });
  });
  if (stmts.length) await env.SOS_DB.batch(stmts);
  return { ok: true, owner, removed: kill.length, created };
}

async function runWrite(env, b) {
  const a = b.action;
  if (a === 'sos_task_add') return taskAdd(env, b);
  if (a === 'sos_task_update') return rowUpdate(env, 'tasks', b);
  if (a === 'sos_task_delete') return rowDelete(env, 'tasks', b.id);
  if (a === 'sos_plan_add') return planAdd(env, b);
  if (a === 'sos_plan_update') return rowUpdate(env, 'plans', b);
  if (a === 'sos_plan_delete') return rowDelete(env, 'plans', b.id);
  if (a === 'sos_import_plans') return importPlans(env, b);
  return { ok: false, error: 'Unknown staff-os action' };
}

// A write with a request id runs once: the id is claimed first; a repeat waits for (or reads) the first reply.
async function write(env, ctx, b) {
  const rid = b.rid ? 'sos:' + String(b.rid).slice(0, 80) : '';
  if (!rid) return Object.assign(await runWrite(env, b), { for: b.action });
  const db = env.SOS_DB;
  const claim = await db.prepare("INSERT OR IGNORE INTO rids (rid, reply, at) VALUES (?, '', ?)").bind(rid, Date.now()).run();
  if (!(claim.meta && claim.meta.changes)) {
    for (let i = 0; i < 20; i++) {                         // the first try is still running: wait up to ~5 s for its reply
      const row = await db.prepare('SELECT reply FROM rids WHERE rid = ?').bind(rid).first();
      if (!row) break;                                     // it failed and released the id → run it now
      if (row.reply) return JSON.parse(row.reply);
      await new Promise(r => setTimeout(r, 250));
    }
    const again = await db.prepare("INSERT OR IGNORE INTO rids (rid, reply, at) VALUES (?, '', ?)").bind(rid, Date.now()).run();
    if (!(again.meta && again.meta.changes)) return { ok: false, error: 'Busy saving — please try again.', for: b.action };
  }
  let out;
  try { out = Object.assign(await runWrite(env, b), { for: b.action }); }
  catch (e) { await db.prepare('DELETE FROM rids WHERE rid = ?').bind(rid).run(); throw e; }
  if (out.ok === false) await db.prepare('DELETE FROM rids WHERE rid = ?').bind(rid).run();
  else await db.prepare('UPDATE rids SET reply = ? WHERE rid = ?').bind(JSON.stringify(out), rid).run();
  if (Math.random() < 0.02) ctx.waitUntil(db.prepare('DELETE FROM rids WHERE at < ?').bind(Date.now() - 2 * 86400000).run().catch(() => {}));
  return out;
}

const nk = v => String(v || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// sos_login with the phone sign-in pass (the PIN path stays on Apps Script, which holds the PINs).
async function login(env, pass, b, rost) {
  if (!(pass.levels || []).some(l => STAFF.includes(l))) return { ok: false, nomatch: true, error: 'Staff only.' };
  const row = rost.find(r => nk(r.name) === nk(pass.name));
  if (!row) return { ok: false, nomatch: true, error: 'You’re not on the staff roster yet.' };
  const m = { name: row.name, role: row.role, isAdmin: (pass.levels || []).includes('admin') || !!row.isAdmin };
  const base = { ok: true, matches: [m], who: m.name, role: m.role, isAdmin: m.isAdmin };
  if (b.lite) return Object.assign(base, { lite: true, roster: rost });
  const d = await sosData(env, m.name, rost);
  return Object.assign(base, { tasks: d.tasks, assigned: d.assigned, plans: d.plans, roster: rost });
}

/** Page routes: /sos/data, /sos/roster (GET) and /sos (POST). `passFor` checks the Bearer sign-in. */
export async function sosRoute(url, req, env, ctx, pass, json, cors) {
  if (!pass) return json({ ok: false, signin: true }, 401, cors);
  const rost = await roster(env);
  if (!rost) return json({ ok: false, fallback: true, error: 'roster not ready' }, 503, cors);
  if (req.method === 'POST') {
    let b = null; try { b = await req.json(); } catch (e) {}
    if (!b || typeof b !== 'object') return json({ ok: false, error: 'Bad request body' }, 400, cors);
    if (b.action === 'sos_login') return json(Object.assign(await login(env, pass, b, rost), { for: 'sos_login' }), 200, cors);
    if (!(pass.levels || []).some(l => STAFF.includes(l))) return json({ ok: false, error: 'Staff only.', for: b.action }, 403, cors);
    if (!WRITES.includes(b.action)) return json({ ok: false, error: 'Unknown staff-os action', for: b.action }, 400, cors);
    return json(await write(env, ctx, b), 200, cors);
  }
  if (!(pass.levels || []).some(l => STAFF.includes(l))) return json({ ok: false, error: 'Staff only.' }, 403, cors);
  if (url.pathname === '/sos/roster') return json({ ok: true, roster: rost, for: 'sos_roster' }, 200, cors);
  const who = url.searchParams.get('who') || '';
  return json(Object.assign(await sosData(env, who, rost), { for: 'sos_data' }), 200, cors);
}

/** Apps Script → here (X-Ingest-Key already checked): forwarded sos_* calls, the one-time copy, the backup export. */
export async function sosGasRoute(req, env, ctx, json, cors) {
  const b = await req.json();
  const a = b && b.action;
  if (a === 'sos_data') return json(Object.assign(await sosData(env, String(b.who || ''), b.roster || (await roster(env)) || []), { for: a }), 200, cors);
  if (WRITES.includes(a)) return json(await write(env, ctx, b), 200, cors);
  if (a === 'sos_export') {
    const [t, p] = await Promise.all(['tasks', 'plans'].map(tb => env.SOS_DB.prepare('SELECT * FROM ' + tb + ' ORDER BY rowid').all()));
    return json({ ok: true, tasks: t.results || [], plans: p.results || [], for: a }, 200, cors);
  }
  if (a === 'sos_count') {
    const t = await env.SOS_DB.prepare('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM plans) AS plans').first();
    return json({ ok: true, tasks: t.tasks, plans: t.plans, for: a }, 200, cors);
  }
  if (a === 'sos_migrate') return json(Object.assign(await migrate(env, b), { for: a }), 200, cors);
  return json({ ok: false, error: 'Unknown staff-os action', for: a }, 400, cors);
}

// One-time copy of every sheet row (in sheet order). Refuses to overwrite rows already here unless replace:true.
async function migrate(env, b) {
  const db = env.SOS_DB;
  const have = await db.prepare('SELECT (SELECT count(*) FROM tasks) + (SELECT count(*) FROM plans) AS n').first();
  if (have.n && !b.replace) return { ok: false, error: 'D1 already has ' + have.n + ' rows (pass replace:true to overwrite).' };
  const stmts = [db.prepare('DELETE FROM tasks'), db.prepare('DELETE FROM plans')];
  const seen = { tasks: new Set(), plans: new Set() }, dupes = [];
  [['tasks', TASK_COLS, b.tasks], ['plans', PLAN_COLS, b.plans]].forEach(([tb, cols, rows]) => {
    const ins = db.prepare('INSERT INTO ' + tb + ' (' + cols.join(',') + ') VALUES (' + ph(cols.length) + ')');
    (rows || []).forEach(r => {
      const id = String(r.id == null ? '' : r.id);
      if (!id) return;
      if (seen[tb].has(id)) { dupes.push(tb + ':' + id); return; }   // the sheet only ever updated/deleted the first one
      seen[tb].add(id);
      stmts.push(ins.bind(...cols.map(c => c === 'id' ? id : (r[c] == null ? '' : (typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])))));
    });
  });
  await db.batch(stmts);
  const n = await db.prepare('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM plans) AS plans').first();
  return { ok: true, tasks: n.tasks, plans: n.plans, dupes };
}
