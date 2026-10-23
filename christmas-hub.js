/* ============================================================================================
   CHRISTMAS FESTIVAL HUB — planning page for the 5th annual South Creek Christmas Festival (Dec 5, 2026)
   Not in the menu. Opened only from the Christmas Festival calendar entry / Today row (cfHubLink) or by the
   address  …/?hub=christmas .  All data comes from the Apps Script backend (Code_christmas_hub.gs) with the
   caller's sign-in token; nothing here is read from a public data file, so budget figures stay private.
   ============================================================================================ */
(function () {
  var LOME = 'https://grow.withlome.com/a/f8f861c2-f813-4cf1-83ba-9bb6beba26e6';
  var TARGET = new Date(2026, 11, 5, 0, 0, 0);          // Saturday, December 5, 2026
  var S = { data: null, tab: 'over', loading: false, err: '', q: '', open: false, busy: false, tick: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return localStorage.getItem('lssr_journey_token') || ''; } catch (e) { return ''; } }
  function api(action, body, tries) {
    var p = Object.assign({ action: action, token: token() }, body || {}), base = typeof EOS_WEBAPP_URL !== 'undefined' ? EOS_WEBAPP_URL : '';
    if (typeof gasCall === 'function') return gasCall(base, p, { tries: tries || 3, timeout: 30000 });   // retries, and only trusts a reply that echoes this action
    return fetch(base + '?action=' + action + '&p=' + encodeURIComponent(JSON.stringify(p)), { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  /* ── links from the rest of the dashboard ───────────────────────────────────── */
  function isFestival(ev) { return !!ev && /christmas festival/i.test(String(ev.name || '')) && !/set.?up|tear/i.test(String(ev.name || '')) && String(ev.dateKey || '').indexOf('2026-12-05') === 0; }
  window.cfHubLink = function (ev, cls) {
    if (!isFestival(ev)) return '';
    return '<button type="button" class="' + (cls || 'cal6-dm-btn primary') + '" onclick="cfHubOpen()">🎄 Open planning hub</button>';
  };
  window.cfHubIsFestival = isFestival;

  /* ── page shell (built once) ───────────────────────────────────────────────── */
  var CSS = '' +
    '#cfHub{position:fixed;inset:0;top:var(--nav-h,58px);z-index:2600;background:#121614;display:none;flex-direction:column;color:var(--text,#f3efe6);font-family:Montserrat,-apple-system,sans-serif}' +
    '#cfHub.open{display:flex}' +
    '#cfHub .cf-top{display:flex;align-items:center;gap:12px;padding:10px 18px;background:#1a1a1a;border-bottom:1px solid #2e2e2e;flex:none}' +
    '#cfHub .cf-top button.cf-x{appearance:none;background:none;border:1px solid #3a3a3a;color:var(--text-muted,#a39e94);border-radius:8px;padding:6px 12px;font:600 12px Montserrat,sans-serif;cursor:pointer;white-space:nowrap;flex:none}' +
    '#cfHub .cf-ttl{font-weight:800;letter-spacing:-.4px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#cfHub .cf-sub{font-size:10px;letter-spacing:.14em;color:#8f8a80;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#cfHub .cf-body{flex:1;overflow:auto;padding:0 0 90px;overscroll-behavior:contain}' +
    '#cfHub .cf-hero{position:relative;overflow:hidden;padding:34px 28px 26px}' +
    '#cfHub .cf-hero:before{content:"";position:absolute;inset:0;background-image:radial-gradient(2px 2px at 20px 30px,#fff8,transparent),radial-gradient(1.5px 1.5px at 90px 80px,#fff6,transparent),radial-gradient(2px 2px at 160px 20px,#fff7,transparent),radial-gradient(1.5px 1.5px at 240px 110px,#fff5,transparent);background-size:280px 140px;opacity:.55;pointer-events:none;animation:cfSnow 40s linear infinite}' +
    '@keyframes cfSnow{to{background-position:0 560px}}' +
    '#cfHub .cf-hero h1{margin:0;font-size:clamp(24px,4.4vw,38px);letter-spacing:-.8px;font-weight:800;position:relative}' +
    '#cfHub .cf-hero p{margin:6px 0 0;font-size:13px;position:relative;max-width:640px;line-height:1.5}' +
    '#cfHub .cf-cd{display:flex;gap:10px;margin:20px 0 4px;position:relative;flex-wrap:wrap}' +
    '#cfHub .cf-cd div{min-width:78px;text-align:center;padding:12px 10px 9px;border-radius:14px}' +
    '#cfHub .cf-cd b{display:block;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-1px}' +
    '#cfHub .cf-cd span{font-size:9px;letter-spacing:.16em;text-transform:uppercase}' +
    '#cfHub .cf-lome{display:flex;align-items:center;gap:14px;margin-top:18px;padding:14px 16px;border-radius:14px;position:relative;flex-wrap:wrap}' +
    '#cfHub .cf-lome .t{flex:1;min-width:200px;font-size:13px;line-height:1.4}#cfHub .cf-lome .t b{display:block;font-size:15px}' +
    '#cfHub a.cf-btn,#cfHub button.cf-btn{display:inline-block;appearance:none;border:0;cursor:pointer;text-decoration:none;font:800 13px Montserrat,sans-serif;letter-spacing:.02em;padding:11px 18px;border-radius:10px;background:#fff;color:#7a1822}' +
    '#cfHub .cf-btn.gold{background:var(--gold,#d4af37);color:#1a1405}#cfHub .cf-btn.sm{padding:6px 11px;font-size:11px;border-radius:8px}#cfHub .cf-btn.ghost{background:transparent;border:1px solid #444;color:var(--text,#f3efe6)}' +
    '#cfHub .cf-tabs{display:flex;gap:4px;padding:10px 20px 0;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid #262626;position:sticky;top:0;background:#121614;z-index:3}#cfHub .cf-tabs::-webkit-scrollbar{display:none}' +
    '#cfHub .cf-tabs button{appearance:none;background:none;border:0;border-bottom:3px solid transparent;color:#8f8a80;font:700 12px Montserrat,sans-serif;letter-spacing:.05em;padding:10px 14px;cursor:pointer;white-space:nowrap;flex:none}#cfHub .cf-tabs .s{display:none}' +
    '#cfHub .cf-tabs button.on{color:var(--gold,#d4af37);border-bottom-color:var(--gold,#d4af37)}' +
    '#cfHub .cf-wrap{padding:20px;max-width:1180px;margin:0 auto}' +
    '#cfHub .cf-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:22px}' +
    '#cfHub .cf-card{background:#1b1f1d;border:1px solid #2a302d;border-radius:14px;padding:14px 16px}' +
    '#cfHub .cf-card .k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8f8a80}#cfHub .cf-card .v{font-size:26px;font-weight:800;margin:4px 0 2px;letter-spacing:-.6px}' +
    '#cfHub .cf-card .n{font-size:11px;color:#a39e94}' +
    '#cfHub .cf-bar{height:6px;border-radius:99px;background:#2a2f2c;overflow:hidden;margin-top:8px}#cfHub .cf-bar i{display:block;height:100%;background:linear-gradient(90deg,#2e9c5b,#7fd99d);border-radius:99px}' +
    '#cfHub h2{font-size:15px;margin:24px 0 10px;letter-spacing:-.2px}#cfHub h2 small{font-weight:600;color:#8f8a80;font-size:11px;margin-left:8px}' +
    '#cfHub .cf-row{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-bottom:1px solid #232825;font-size:13px}' +
    '#cfHub .cf-row .d{width:62px;flex:none;font-weight:700;color:var(--gold,#d4af37);font-size:12px}#cfHub .cf-row .m{flex:1;min-width:0}#cfHub .cf-row .m small{display:block;color:#8f8a80;font-size:11px;margin-top:2px;line-height:1.4}' +
    '#cfHub .cf-row.done .m>b{text-decoration:line-through;color:#6f6a62}' +
    '#cfHub .cf-chip{display:inline-block;font:700 10px Montserrat,sans-serif;letter-spacing:.06em;padding:3px 8px;border-radius:99px;background:#2a2f2c;color:#cfc8ba;white-space:nowrap}' +
    '#cfHub .cf-chip.g{background:rgba(46,156,91,.18);color:#7fd99d}#cfHub .cf-chip.a{background:rgba(212,175,55,.16);color:#e6c65a}#cfHub .cf-chip.r{background:rgba(220,70,70,.16);color:#f08a8a}' +
    '#cfHub .cf-late{color:#f08a8a}' +
    '#cfHub .cf-teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}' +
    '#cfHub .cf-team{background:#1b1f1d;border:1px solid #2a302d;border-radius:14px;padding:14px 16px}' +
    '#cfHub .cf-team h3{margin:0 0 3px;font-size:15px;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;justify-content:space-between}#cfHub .cf-team h3>span{flex:1 1 auto;min-width:0}#cfHub .cf-team h3 .cf-sel{flex:0 1 auto}' +
    '#cfHub .cf-team .ld{font-size:12px;color:#cfc8ba}#cfHub .cf-team .ld b{color:var(--gold,#d4af37)}#cfHub .cf-team .nt{font-size:11px;color:#8f8a80;margin-top:2px}' +
    '#cfHub .cf-vols{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 10px}' +
    '#cfHub .cf-v{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:99px;background:#252b28;font-size:12px;max-width:100%}#cfHub .cf-v b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#cfHub .cf-v i{flex:none}' +
    '#cfHub .cf-v i{width:8px;height:8px;border-radius:50%;background:#e6c65a}#cfHub .cf-v.confirmed i{background:#3fbf78}#cfHub .cf-v.declined i{background:#e06060}' +
    '#cfHub .cf-v.mine{outline:1px solid var(--gold,#d4af37)}#cfHub .cf-v.leader b{color:var(--gold,#d4af37)}' +
    '#cfHub .cf-v button{appearance:none;border:0;background:#32392f;color:#cfc8ba;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;flex:none}' +
    '#cfHub .cf-v button:hover{background:#4a5a45}' +
    '#cfHub .cf-add{display:flex;gap:6px;margin-top:6px}#cfHub .cf-add input,#cfHub .cf-search{flex:1;min-width:0;background:#101311;border:1px solid #333a36;border-radius:8px;color:inherit;padding:8px 10px;font:500 12px Montserrat,sans-serif}' +
    '#cfHub .cf-lomebox{margin:10px 0;padding:10px 12px;border-radius:10px;background:rgba(192,57,43,.16);border:1px solid rgba(192,57,43,.45);display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px}' +
    '#cfHub .cf-note{font-size:11px;color:#8f8a80;margin:8px 0}#cfHub .cf-empty{padding:30px;text-align:center;color:#8f8a80;font-size:13px}' +
    '#cfHub .cf-tblw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px}#cfHub .cf-tbl{width:100%;border-collapse:collapse;font-size:12px}#cfHub .cf-tbl th{text-align:left;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8f8a80;padding:8px;border-bottom:1px solid #2a302d}#cfHub .cf-tbl td{padding:8px;border-bottom:1px solid #202522;vertical-align:top}' +
    '#cfHub .cf-toast{position:fixed;left:16px;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));margin:0 auto;width:max-content;max-width:min(440px,calc(100vw - 32px));box-sizing:border-box;background:#e6c65a;color:#1a1405;font:600 13px/1.4 Montserrat,sans-serif;padding:10px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center;display:none;z-index:9}' +
    '#cfHub .cf-in,#cfHub .cf-sel{background:#101311;border:1px solid #333a36;border-radius:7px;color:inherit;font:500 12px Montserrat,sans-serif;padding:5px 7px;min-width:0;max-width:100%}#cfHub .cf-in{width:100%;margin-top:3px;box-sizing:border-box}#cfHub .cf-in.dt{width:74px;margin:0;text-align:center}#cfHub .cf-in:focus,#cfHub .cf-sel:focus{outline:none;border-color:#e6c65a;background:#161b18}#cfHub .cf-sel{cursor:pointer;font-weight:700}#cfHub .cf-ck{width:18px;height:18px;accent-color:#2e9c5b;cursor:pointer;flex:none;margin:2px 10px 0 0}' +
    '#cfHub .cf-bad{border-color:#f08a8a!important}#cfHub .cf-ok{border-color:#3fbf78!important}#cfHub .cf-sv{font:700 11px Montserrat,sans-serif;padding:5px 10px;border-radius:99px;background:#252b28;color:#8f8a80;white-space:nowrap}#cfHub .cf-sv.s{color:#e6c65a}#cfHub .cf-sv.ok{color:#7fd99d}#cfHub .cf-sv.bad{background:rgba(220,70,70,.2);color:#f08a8a}#cfHub button.cf-sv{appearance:none;border:0;cursor:pointer}' +
    /* task cards (Timeline, Up next, Day of, creative, donations): title on top, one compact meta line, then full-width fields */
    '#cfHub .cf-task{padding:12px 4px 14px;border-bottom:1px solid #232825}' +
    '#cfHub .cf-th{display:flex;gap:10px;align-items:flex-start}#cfHub .cf-th>b{flex:1;min-width:0;font-size:14px;line-height:1.35;overflow-wrap:anywhere}#cfHub .cf-th .cf-ck{margin:1px 0 0}#cfHub .cf-th .o{flex:none;width:20px;text-align:center;color:#8f8a80}' +
    '#cfHub .cf-task.done .cf-th>b{text-decoration:line-through;color:#6f6a62}' +
    '#cfHub .cf-tm{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:8px 0 0 30px;font-size:12px;color:#8f8a80}#cfHub .cf-tm .dl{font-weight:700;color:var(--gold,#d4af37)}#cfHub .cf-tm .dl.cf-late{color:#f08a8a}' +
    '#cfHub .cf-tf{display:grid;gap:6px;margin:8px 0 0 30px}#cfHub .cf-tx{margin:6px 0 0 30px;font-size:12px;color:#a39e94;line-height:1.45;overflow-wrap:anywhere}' +
    '#cfHub .cf-f{display:flex;align-items:flex-start;gap:8px;margin:0}#cfHub .cf-f>span{flex:none;width:42px;padding-top:9px;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8f8a80}' +
    '#cfHub textarea.cf-in{resize:none;overflow:hidden;line-height:1.4;margin:0;min-height:31px;display:block}' +
    '#cfHub .cf-in.dt{width:10.5ch;padding-left:6px;padding-right:6px;text-align:center;font-variant-numeric:tabular-nums}#cfHub textarea.cf-in{field-sizing:content}' +
    '#cfHub .cf-sel.pill{border-radius:99px;padding:4px 8px;font-size:11px;letter-spacing:.02em}#cfHub .cf-sel.g{background:rgba(46,156,91,.18);color:#7fd99d;border-color:rgba(46,156,91,.45)}#cfHub .cf-sel.a{background:rgba(212,175,55,.14);color:#e6c65a;border-color:rgba(212,175,55,.45)}#cfHub .cf-sel.r{background:rgba(220,70,70,.12);color:#f08a8a;border-color:rgba(220,70,70,.4)}' +
    '@media(min-width:760px){#cfHub .cf-tf{grid-template-columns:1fr 1fr}}' +
    '@media(max-width:700px){#cfHub .cf-hero{padding:24px 16px 20px}#cfHub .cf-wrap{padding:14px}#cfHub .cf-cd div{min-width:64px}#cfHub .cf-cd b{font-size:24px}' +
    '#cfHub .cf-top{padding:8px 10px;gap:8px}#cfHub .cf-top .lbl{display:none}#cfHub .cf-top button.cf-x{padding:7px 10px;font-size:14px}#cfHub .cf-ttl{font-size:15px}#cfHub .cf-sub{letter-spacing:.08em}#cfHub .cf-sv{padding:5px 8px}' +
    '#cfHub .cf-tabs{padding:6px 4px 0;gap:0}#cfHub .cf-tabs button{flex:1 0 auto;padding:10px 5px;letter-spacing:0}#cfHub .cf-tabs .l{display:none}#cfHub .cf-tabs .s{display:inline}' +
    '#cfHub .cf-teams{grid-template-columns:1fr}#cfHub .cf-team{padding:14px}#cfHub .cf-v button{width:28px;height:28px;font-size:12px}#cfHub .cf-v{padding:3px 4px 3px 10px}' +
    /* 16px stops iPhone Safari zooming the page whenever a field gets focus */
    '#cfHub .cf-in,#cfHub .cf-sel,#cfHub .cf-add input,#cfHub .cf-search{font-size:16px}#cfHub .cf-sel.pill{font-size:14px}#cfHub .cf-ck{width:22px;height:22px}#cfHub .cf-tm,#cfHub .cf-tf,#cfHub .cf-tx{margin-left:32px}#cfHub .cf-f>span{padding-top:10px}}';

  function build() {
    if (document.getElementById('cfHub')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var d = document.createElement('div'); d.id = 'cfHub'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="cf-top"><button class="cf-x" onclick="cfHubClose()" aria-label="Close">&larr;<span class="lbl"> Close</span></button><div style="flex:1;min-width:0"><div class="cf-ttl">Christmas Festival Hub</div><div class="cf-sub">South Creek · Sat, Dec 5, 2026 · 5th annual</div></div><button type="button" class="cf-sv" id="cfSave" style="display:none" onclick="cfHubRetry()"></button><button class="cf-x" onclick="cfHubLoad(true)" title="Reload" aria-label="Refresh">&#8635;<span class="lbl"> Refresh</span></button></div><div class="cf-body" id="cfBody"></div><div class="cf-toast" id="cfToast"></div>';
    document.body.appendChild(d);
  }
  function toast(m, bad) { var t = document.getElementById('cfToast'); if (!t) return; t.textContent = m; t.style.background = bad ? '#f08a8a' : '#e6c65a'; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, bad ? 5000 : 2600); }

  /* ── is this person on the festival team? (drives the green Festival filter on the Calendar) ── */
  var TEAM = { ok: false, tok: '' };
  window.cfIsTeam = function () { return TEAM.ok && TEAM.tok === token(); };
  window.cfTeamInit = function () {
    var t = token(); if (!t || TEAM.tok === t || TEAM.busy) return;
    TEAM.busy = true;
    api('cf_me').then(function (j) {
      TEAM.tok = t; TEAM.ok = !!(j && j.ok && j.editor);
      if (TEAM.ok && typeof cal6Render === 'function') { try { cal6Render(); } catch (e) {} }
    }).catch(function () {}).then(function () { TEAM.busy = false; });
  };
  window.cfIsFestivalItem = function (ev) { return !!ev && /festival/i.test(String(ev.name || '')); };

  window.cfHubOpen = function () {
    build(); try { if (typeof cal6HideDetail === 'function') cal6HideDetail(); } catch (e) {}
    var d = document.getElementById('cfHub'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; S.open = true;
    try { if (history.replaceState && !/hub=christmas/.test(location.search)) { var u = new URL(location.href); u.searchParams.set('hub', 'christmas'); history.replaceState(null, '', u.toString()); } } catch (e) {}
    render(); cfHubLoad();
    clearInterval(S.tick); S.tick = setInterval(tickCd, 1000);
  };
  window.cfHubClose = function () {
    var d = document.getElementById('cfHub'); if (!d) return;
    if ((SV.fail.length || SV.pend) && !confirm('Some changes haven’t reached the sheet yet. Close anyway?')) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; S.open = false; clearInterval(S.tick);
    try { var u = new URL(location.href); if (u.searchParams.get('hub')) { u.searchParams.delete('hub'); history.replaceState(null, '', u.toString()); } } catch (e) {}
  };
  window.cfHubLoad = function (force) {
    if (S.loading) return;
    if (!token()) { S.data = null; S.err = ''; render(); return; }
    S.loading = true; S.err = ''; render();
    api('cf_data').then(function (j) {
      if (j && j.ok) S.data = j; else { S.data = null; S.err = (j && j.error) || 'Could not load the hub.'; }
    }).catch(function () { S.err = 'Could not reach the server. Check your connection and refresh.'; })
      .then(function () { S.loading = false; render(); });
  };

  /* ── helpers ─────────────────────────────────────────────────────────────── */
  function cdParts() { var ms = Math.max(0, TARGET - new Date()); return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 }; }
  function tickCd() { var c = cdParts(), el = document.getElementById('cfCd'); if (el) el.innerHTML = cdHtml(c); }
  function cdHtml(c) { var bx = '<div style="background:rgba(0,0,0,.38);border:1px solid rgba(212,175,55,.4)"><b style="color:#e6c65a">', sp = '</b><span style="color:#b9b2a4">'; return bx + c.d + sp + 'days</span></div>' + bx + c.h + sp + 'hours</span></div>' + bx + c.m + sp + 'min</span></div>' + bx + c.s + sp + 'sec</span></div>'; }
  function parseDate(s) { var m = String(s || '').match(/(\d+)\/(\d+)\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null; }
  function fmtShort(s) { var d = parseDate(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : (s || ''); }
  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
  function money(s) { var n = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
  function fmtMoney(n) { return n == null ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  function statusChip(s) {
    var t = String(s || ''); if (!t) return '';
    var c = tone(t);
    return '<span class="cf-chip ' + c + '">' + esc(t) + '</span>';
  }
  function bar(p) { return '<div class="cf-bar"><i data-keep-colors style="display:block;height:6px;width:' + Math.min(100, p) + '%;background:linear-gradient(90deg,#2e9c5b,#7fd99d)"></i></div>'; }

  /* ── spreadsheet-style editing (festival team only; saves straight to the live 2026 sheet) ───────────────── */
  var REG = [];
  function canEdit() { return !!(S.data && S.data.me && S.data.me.editor); }
  function uniq(list, f, base) { var o = (base || []).slice(); (list || []).forEach(function (r) { var v = String(r[f] || '').trim(); if (v && o.indexOf(v) < 0) o.push(v); }); return o; }
  function reg(kind, rec, field) { REG.push({ kind: kind, rec: rec, field: field }); return REG.length - 1; }
  // The sheet's own dropdown list for this column (sent by the backend from the cell's validation rule); the fallback is only used
  // until a backend with `opts` answers, and copies the sheet's exact wording so a pick can never be rejected.
  function sheetOpts(kind, field, list, fallback) {
    var o = S.data && S.data.opts && S.data.opts[kind] && S.data.opts[kind][field];
    return o && o.length ? o.slice() : uniq(list, field, fallback);
  }
  function tone(v) { var t = String(v || ''); return /^not/i.test(t) ? (/request/i.test(t) ? 'r' : '') : /confirm|complete|^yes|^done/i.test(t) ? 'g' : /request|pending|progress|asked/i.test(t) ? 'a' : ''; }
  function ctlSel(kind, rec, field, opts, pill) {
    var cur = String(rec[field] || ''), o = opts.slice(); if (cur && o.indexOf(cur) < 0) o.unshift(cur); if (o.indexOf('') < 0 && !cur) o.unshift('');
    return '<select class="cf-sel' + (pill ? ' pill ' + tone(cur) : '') + '" aria-label="Status" onchange="cfEd(' + reg(kind, rec, field) + ',this)">' + o.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x || '—') + '</option>'; }).join('') + '</select>';
  }
  function ctlChk(kind, rec, field) { return '<input type="checkbox" class="cf-ck" title="Mark done" aria-label="Done" ' + (rec[field] ? 'checked ' : '') + 'onchange="cfEd(' + reg(kind, rec, field) + ',this)">'; }
  function ctlTxt(kind, rec, field, ph, cls) { return '<input class="cf-in ' + (cls || '') + '" value="' + esc(rec[field] || '') + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || field) + '" onchange="cfEd(' + reg(kind, rec, field) + ',this)" onkeydown="if(event.key===\'Enter\')this.blur()">'; }
  // A field that grows with its text (owner, notes); Enter saves, Shift+Enter adds a line.
  function ctlArea(kind, rec, field, ph) { return '<textarea class="cf-in" rows="1" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || field) + '" oninput="cfGrow(this)" onchange="cfEd(' + reg(kind, rec, field) + ',this)" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();this.blur()}">' + esc(rec[field] || '') + '</textarea>'; }
  function fld(label, ctl) { return '<label class="cf-f"><span>' + label + '</span>' + ctl + '</label>'; }
  window.cfGrow = function (t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
  function growAll(root) { var l = root.querySelectorAll('textarea.cf-in'); for (var i = 0; i < l.length; i++) cfGrow(l[i]); }

  /* save indicator: "Saving…" while anything is in flight, "Not saved · Retry" while a change is waiting to reach the server,
     a short "Not saved" when the sheet refused a value (the field is put back, so nothing is left unsaved), else "Saved ✓" */
  var SV = { pend: 0, fail: [], t: null };
  function saveMsg(t, cls, hideAfter) {
    var e = document.getElementById('cfSave'); if (!e) return; e.style.display = ''; e.className = 'cf-sv ' + (cls || ''); e.textContent = t;
    e.disabled = cls !== 'bad' || !SV.fail.length; clearTimeout(saveMsg._t);
    if (hideAfter) saveMsg._t = setTimeout(function () { if (!SV.pend && !SV.fail.length) e.style.display = 'none'; }, hideAfter);
  }
  function svPaint(last) {
    if (SV.pend) return saveMsg('Saving…', 's');
    if (SV.fail.length) return saveMsg('⚠ Not saved · Retry', 'bad');
    if (last === 'refused') return saveMsg('⚠ Not saved', 'bad', 5000);
    saveMsg('Saved ✓ ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'ok', 4000);
  }
  function keyOf(j) { return j.kind + ':' + j.row + ':' + j.field; }
  function send(job, el) {
    SV.fail = SV.fail.filter(function (x) { return x !== job && keyOf(x) !== keyOf(job); });
    SV.pend++; svPaint();
    api('cf_edit', { kind: job.kind, field: job.field, row: job.rec.row, expect: job.expect, value: job.val, rid: job.rid }).then(function (j) {
      SV.pend--;
      if (j && j.ok) {
        job.rec[job.field] = job.chk ? !!job.val : (j.value != null ? j.value : job.val);
        if (el && el.isConnected) el.classList.add('cf-ok');
        svPaint();
        if (job.chk || job.sel || job.retried) render();
        return;
      }
      // the sheet (or a permission rule) refused it: put the sheet's value back and say why, briefly
      job.rec[job.field] = job.old;
      if (j && j.options && j.options.length && S.data) { S.data.opts = S.data.opts || {}; (S.data.opts[job.kind] = S.data.opts[job.kind] || {})[job.field] = j.options; }
      svPaint('refused'); toast(shortErr(j), true); render();
    }).catch(function () {
      // never reached the server (after 3 tries): keep what was typed and retry it
      SV.pend--; job.rec[job.field] = job.chk ? !!job.val : job.val; job.retried = true; SV.fail.push(job);
      svPaint(); toast('No connection. Your change is kept and will be retried.', true);
      clearTimeout(SV.t); SV.t = setTimeout(window.cfHubRetry, 15000);
    });
  }
  function shortErr(j) {
    var m = String((j && j.error) || 'Could not save.');
    if (j && j.signin) return 'Please sign in again to save.';
    if (/violates the data validation/i.test(m)) return 'The sheet didn’t accept that value. Pick one from the list.';
    return m.length > 140 ? m.slice(0, 137) + '…' : m;
  }
  window.cfHubRetry = function () { clearTimeout(SV.t); var l = SV.fail.slice(); l.forEach(function (j) { send(j); }); };
  window.addEventListener('online', function () { if (SV.fail.length) window.cfHubRetry(); });
  window.cfEd = function (i, el) {
    var r = REG[i]; if (!r) return;
    var isChk = el.type === 'checkbox', val = isChk ? el.checked : el.value, old = r.rec[r.field];
    if (!isChk && String(val) === String(old == null ? '' : old)) return;
    el.classList.remove('cf-bad', 'cf-ok');
    if (el.tagName === 'SELECT') { el.className = el.className.replace(/\b(g|a|r)\b/g, '').trim(); if (/\bpill\b/.test(el.className)) el.classList.add(tone(val) || 'x'); }
    send({ kind: r.kind, field: r.field, rec: r.rec, expect: r.rec.item || r.rec.name || r.rec.business || '', val: val, old: old, chk: isChk, sel: el.tagName === 'SELECT', rid: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }, el);
  };
  function progOpts(kind, base) { return sheetOpts(kind, 'progress', S.data[kind], base); }

  /* ── render ──────────────────────────────────────────────────────────────── */
  function heroHtml() {
    var c = cdParts(), desc = 'Hosted by Living Stones South Reno for our South Creek neighbors: a free, fun Christmas event with treats, s’mores, crafts, Santa and the tree lighting.';
    return '<div class="cf-hero" data-keep-colors style="color:#f6f1e7;background:radial-gradient(900px 300px at 85% -20%,rgba(212,175,55,.28),transparent 60%),radial-gradient(700px 300px at 0% 120%,rgba(190,45,55,.38),transparent 60%),linear-gradient(135deg,#17301f,#1d1316)"><h1 style="color:#fff">🎄 South Creek Christmas Festival</h1><p style="color:#d9d2c3">' + esc(desc) + '</p>' +
      '<div class="cf-cd" id="cfCd">' + cdHtml(c) + '</div>' +
      '<div class="cf-lome" style="background:linear-gradient(135deg,#c0392b,#8e1f2a);box-shadow:0 8px 28px rgba(160,30,40,.35);color:#fff"><div class="t"><b>🍰 Bringing a dessert?</b>Sign up on Lome so we know what to expect on the tables.</div><a class="cf-btn" style="background:#fff;color:#7a1822" href="' + LOME + '" target="_blank" rel="noopener">Sign up to bring a dessert ↗</a></div></div>';
  }
  var TABS = [['over', 'Overview', 'Overview'], ['time', 'Timeline', 'Timeline'], ['teams', 'Teams & volunteers', 'Teams'], ['day', 'Day of event', 'Day of'], ['money', 'Budget', 'Budget'], ['partners', 'Partners & logistics', 'Partners']];

  function render() {
    var el = document.getElementById('cfBody'); if (!el) return;
    var keep = el.scrollTop, focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.keep : '';
    REG = []; var h = heroHtml();
    if (!token()) { el.innerHTML = h + '<div class="cf-wrap"><div class="cf-empty">Sign in to the dashboard to see the planning details, teams and volunteers.</div></div>'; return; }
    if (S.err) { el.innerHTML = h + '<div class="cf-wrap"><div class="cf-empty">' + esc(S.err) + '<br><br><button class="cf-btn gold sm" data-keep-colors style="background:#d4af37;color:#1a1405" onclick="cfHubLoad(true)">Try again</button></div></div>'; return; }
    if (!S.data) { el.innerHTML = h + '<div class="cf-wrap"><div class="cf-empty">Loading the planning hub…</div></div>'; return; }
    var d = S.data, tabs = TABS.filter(function (t) { return t[0] !== 'money' || d.budget; });
    var body = ({ over: vOver, time: vTime, teams: vTeams, day: vDay, money: vMoney, partners: vPartners }[S.tab] || vOver)(d);
    el.innerHTML = h + '<div class="cf-tabs">' + tabs.map(function (t) { return '<button class="' + (S.tab === t[0] ? 'on' : '') + '" onclick="cfHubTab(\'' + t[0] + '\')"><span class="l">' + esc(t[1]) + '</span><span class="s">' + esc(t[2]) + '</span></button>'; }).join('') + '</div><div class="cf-wrap">' + body + '</div>';
    el.scrollTop = keep; growAll(el);
    var on = el.querySelector('.cf-tabs button.on'), tb = on && on.parentNode; if (tb && (on.offsetLeft < tb.scrollLeft || on.offsetLeft + on.offsetWidth > tb.scrollLeft + tb.clientWidth)) tb.scrollLeft = on.offsetLeft - 16;
    if (focused) { var f = el.querySelector('[data-keep="' + focused + '"]'); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {} } }
  }
  window.cfHubTab = function (t) { S.tab = t; render(); var b = document.getElementById('cfBody'); if (b) { var tb = b.querySelector('.cf-tabs'); if (tb) b.scrollTop = Math.min(b.scrollTop, tb.offsetTop); } };

  function vOver(d) {
    var A = d.actions, done = A.filter(function (a) { return a.done; }).length, today = new Date(); today.setHours(0, 0, 0, 0);
    var late = A.filter(function (a) { var x = parseDate(a.due); return !a.done && x && x < today; });
    var teams = d.teams, ok = teams.filter(function (t) { return /confirmed/i.test(t.status); }).length;
    var vols = 0, conf = 0; teams.forEach(function (t) { vols += t.volunteers.length; t.volunteers.forEach(function (v) { if (v.status === 'confirmed') conf++; }); });
    var dayDone = d.dayOf.filter(function (a) { return a.done; }).length;
    var cards = [
      ['Planning tasks', done + ' / ' + A.length, pct(done, A.length) + '% done' + (late.length ? ' · <span class="cf-late">' + late.length + ' past due</span>' : '')],
      ['Team leaders', ok + ' / ' + teams.length, 'confirmed to lead', pct(ok, teams.length)],
      ['Volunteers', String(vols), conf + ' confirmed for 2026', pct(conf, vols)],
      ['Day-of checklist', dayDone + ' / ' + d.dayOf.length, 'set-up items ready', pct(dayDone, d.dayOf.length)]
    ];
    if (d.budget && d.budget.summary) {
      var b = d.budget.summary, spent = money(b.actual), cap = money(b.cap) || money(b.budget);
      cards.push(['Spent so far', fmtMoney(spent), cap ? 'of ' + fmtMoney(cap) + ' budget' : 'staff only', cap && spent != null ? pct(spent, cap) : 0]);
    }
    var next = A.filter(function (a) { return !a.done; }).sort(function (x, y) { return (parseDate(x.due) || 9e15) - (parseDate(y.due) || 9e15); }).slice(0, 8);
    return '<div class="cf-cards">' + cards.map(function (c) { return '<div class="cf-card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="n">' + c[2] + '</div>' + (c[3] != null ? bar(c[3]) : '') + '</div>'; }).join('') + '</div>' +
      '<h2>Up next<small>open tasks, soonest deadline first</small></h2>' + (next.length ? next.map(taskRow).join('') : '<div class="cf-empty">Everything is done 🎉</div>') +
      '<h2>Teams needing attention<small>leader not yet confirmed</small></h2>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + teams.filter(function (t) { return !/confirmed/i.test(t.status); }).map(function (t) { return '<button class="cf-btn ghost sm" onclick="cfHubTab(\'teams\')">' + esc(t.name) + ' · ' + esc(t.status || 'no status') + '</button>'; }).join('') + '</div>';
  }
  // One card per task: title on top (struck through when done), a compact line with date · team · status, then owner and notes full width.
  function lateDue(a) { var x = parseDate(a.due); return !a.done && x && x < new Date(new Date().setHours(0, 0, 0, 0)); }
  function taskCard(kind, a, o) {
    o = o || {};
    if (canEdit()) {
      return '<div class="cf-task' + (a.done ? ' done' : '') + '"><div class="cf-th">' + (o.noChk ? '' : ctlChk(kind, a, 'done')) + '<b>' + esc(a.item) + '</b></div>' +
        '<div class="cf-tm">' + (o.due ? ctlTxt(kind, a, 'due', 'Due', 'dt' + (lateDue(a) ? ' cf-bad' : '')) : '') + ctlSel(kind, a, 'progress', progOpts(kind, o.prog || ['Not Started', 'In Progress', 'Completed']), true) + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</div>' +
        ((o.fields || []).length ? '<div class="cf-tf">' + o.fields.map(function (f) { return fld(f[1], ctlArea(kind, a, f[0], f[2])); }).join('') + '</div>' : '') + '</div>';
    }
    var st = a.done ? 'Done' : a.progress || (o.noChk ? '' : 'Not started'), txt = (o.fields || []).map(function (f) { return a[f[0]]; }).filter(Boolean);
    return '<div class="cf-task' + (a.done ? ' done' : '') + '"><div class="cf-th">' + (o.noChk ? '' : '<span class="o">' + (a.done ? '✓' : '○') + '</span>') + '<b>' + esc(a.item) + '</b></div>' +
      '<div class="cf-tm">' + (o.due && a.due ? '<span class="dl' + (lateDue(a) ? ' cf-late' : '') + '">' + esc(fmtShort(a.due)) + '</span>' : '') + (st ? '<span class="cf-chip ' + (a.done ? 'g' : tone(st)) + '">' + esc(st) + '</span>' : '') + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</div>' +
      (txt.length ? '<div class="cf-tx">' + txt.map(esc).join(' · ') + '</div>' : '') + '</div>';
  }
  function taskRow(a) { return taskCard('actions', a, { due: 1, sub: a.cat, fields: [['who', 'Who', 'Who’s on it'], ['details', 'Notes', 'Notes']] }); }
  function vTime(d) {
    var A = d.actions.slice().sort(function (x, y) { return (parseDate(x.due) || 9e15) - (parseDate(y.due) || 9e15); });
    var groups = {};
    A.forEach(function (a) { var x = parseDate(a.due), k = x ? x.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'No deadline yet'; (groups[k] = groups[k] || []).push(a); });
    return Object.keys(groups).map(function (k) { return '<h2>' + esc(k) + '<small>' + groups[k].filter(function (a) { return a.done; }).length + ' of ' + groups[k].length + ' done</small></h2>' + groups[k].map(taskRow).join(''); }).join('') ||
      '<div class="cf-empty">No planning tasks yet.</div>';
  }

  function vTeams(d) {
    var q = S.q.toLowerCase(), me = d.me;
    var note = 'You’re signed in as <b>' + esc(me.name) + '</b>. ' + (me.admin ? 'As an admin you can edit every team. ' : 'You can join a team and confirm or remove yourself; team leaders can edit their own team. ');
    var list = d.teams.filter(function (t) { return !q || t.name.toLowerCase().indexOf(q) >= 0 || t.volunteers.some(function (v) { return v.name.toLowerCase().indexOf(q) >= 0; }); });
    return '<div class="cf-note">' + note + 'Volunteers shown as “pending” come from last year’s teams and are waiting to be asked or to confirm for 2026.</div>' +
      '<input class="cf-search" data-keep="tq" placeholder="Search a team or a volunteer…" value="' + esc(S.q) + '" oninput="cfHubSearch(this.value)" style="width:100%;max-width:420px;margin-bottom:14px">' +
      '<div class="cf-teams">' + (list.map(function (t) { return teamCard(t, d.teams.indexOf(t)); }).join('') || '<div class="cf-empty">No match.</div>') + '</div>';
  }
  window.cfHubSearch = function (v) { S.q = v; render(); };
  function teamCard(t, ti) {
    var me = S.data.me, mine = t.volunteers.filter(function (v) { return v.mine; })[0], dessert = /baking|sweet|dessert/i.test(t.name);
    var vols = t.volunteers.slice().sort(function (a, b) { return (b.role === 'leader') - (a.role === 'leader') || a.name.localeCompare(b.name); });
    var chips = vols.map(function (v) {
      var can = t.canEdit || v.mine, id = esc(v.id), tm = ti;
      return '<span class="cf-v ' + esc(v.status) + (v.mine ? ' mine' : '') + (v.role === 'leader' ? ' leader' : '') + '" title="' + esc(v.status) + ' · ' + esc(v.source) + '"><i></i><b>' + esc(v.name) + (v.mine ? ' (you)' : '') + '</b>' +
        (can ? (v.status !== 'confirmed' ? '<button title="Confirm for 2026" aria-label="Confirm ' + esc(v.name) + ' for 2026" onclick="cfHubVol(' + tm + ',\'status\',\'' + id + '\',\'confirmed\')">✓</button>' : '') + '<button title="Remove" aria-label="Remove ' + esc(v.name) + '" onclick="cfHubVol(' + tm + ',\'remove\',\'' + id + '\')">✕</button>' : '') + '</span>';
    }).join('');
    var tn = ti;
    return '<div class="cf-team"><h3><span>' + esc(t.name) + '</span>' + (t.canTrack ? ctlSel('teams', t, 'status', sheetOpts('teams', 'status', S.data.teams, ['Confirmed will lead', 'Requested, pending response', 'Not requested']), true) : statusChip(t.status)) + '</h3>' +
      '<div class="ld">Leader: <b>' + esc(t.leader || 'To be named') + '</b></div>' + (t.canTrack ? '<div style="margin-top:6px">' + ctlArea('teams', t, 'notes', 'Notes') + '</div>' : (t.notes ? '<div class="nt">' + esc(t.notes) + '</div>' : '')) +
      (dessert ? '<div class="cf-lomebox" data-keep-colors style="background:#7d2a2a;border:1px solid #c0392b;color:#fff"><span>🍰 Desserts are signed up on Lome.</span><a class="cf-btn sm" style="background:#fff;color:#7a1822" href="' + LOME + '" target="_blank" rel="noopener">Sign up to bring a dessert ↗</a></div>' : '') +
      '<div class="cf-vols">' + (chips || '<span class="cf-note">No volunteers listed yet.</span>') + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + (mine ? (mine.status !== 'confirmed' ? '<button class="cf-btn gold sm" data-keep-colors style="background:#d4af37;color:#1a1405" onclick="cfHubVol(' + tn + ',\'status\',\'' + esc(mine.id) + '\',\'confirmed\')">Confirm me for 2026</button>' : '') + '<button class="cf-btn ghost sm" onclick="cfHubVol(' + tn + ',\'remove\',\'' + esc(mine.id) + '\')">Take me off</button>' : '<button class="cf-btn gold sm" data-keep-colors style="background:#d4af37;color:#1a1405" onclick="cfHubVol(' + tn + ',\'join\')">Add me to this team</button>') + '</div>' +
      (t.canEdit ? '<div class="cf-add"><input data-keep="add-' + esc(t.name) + '" id="cfAdd-' + ti + '" placeholder="Add a volunteer by name" enterkeyhint="done" onkeydown="if(event.key===\'Enter\')cfHubAdd(' + tn + ')"><button class="cf-btn gold sm" data-keep-colors style="background:#d4af37;color:#1a1405" onclick="cfHubAdd(' + tn + ')">Add</button></div>' : '') + '</div>';
  }
  window.cfHubAdd = function (ti) {
    var i = document.getElementById('cfAdd-' + ti); var nm = i ? i.value.trim() : ''; if (!nm) return;
    cfHubVol(ti, 'add', '', '', nm);
  };
  window.cfHubVol = function (ti, op, id, status, name) {
    var t = S.data && S.data.teams[ti], team = t ? t.name : ''; if (!team) return;
    if (S.busy) { toast('One moment, still saving…'); return; }
    if (op === 'remove') {
      var v = t.volunteers.filter(function (x) { return x.id === id; })[0];
      if (v && !v.mine && !confirm('Remove ' + v.name + ' from ' + team + '?')) return;
    }
    S.busy = true; SV.pend++; svPaint();
    api('cf_vol', { team: team, op: op, id: id || '', status: status || '', name: name || '' }).then(function (j) {
      if (j && j.ok) { toast(op === 'remove' ? 'Removed' : op === 'add' ? 'Added ' + name : op === 'join' ? 'You’re on the team' : 'Confirmed for 2026'); return api('cf_data').then(function (d) { if (d && d.ok) S.data = d; SV.pend--; svPaint(); }, function () { SV.pend--; svPaint(); }); }
      SV.pend--; svPaint('refused'); toast(shortErr(j), true);
    }).catch(function () { SV.pend--; svPaint('refused'); toast('Could not reach the server. Nothing was changed; try again.', true); }).then(function () { S.busy = false; render(); });
  };

  function vDay(d) {
    var by = {}; d.dayOf.forEach(function (a) { (by[a.team || 'Other'] = by[a.team || 'Other'] || []).push(a); });
    return Object.keys(by).sort().map(function (k) {
      return '<h2>' + esc(k) + '<small>' + by[k].filter(function (a) { return a.done; }).length + ' of ' + by[k].length + ' ready</small></h2>' +
        by[k].map(function (a) { return taskCard('dayOf', a, { fields: [['details', 'Notes', 'Notes']] }); }).join('');
    }).join('') || '<div class="cf-empty">No day-of checklist yet.</div>';
  }

  function vMoney(d) {
    var b = d.budget; if (!b) return '<div class="cf-empty">Budget details are for staff only.</div>';
    var s = b.summary || {}, bySum = {};
    b.items.forEach(function (i) { var e = money(i.est); if (e) bySum[i.cat || 'Other'] = (bySum[i.cat || 'Other'] || 0) + e; });
    return '<div class="cf-note">Staff only. These figures are never part of the public data files.</div>' +
      '<div class="cf-cards"><div class="cf-card"><div class="k">Projected (inventory)</div><div class="v">' + esc(s.projected || '—') + '</div></div><div class="cf-card"><div class="k">Actual so far</div><div class="v">' + esc(s.actual || '—') + '</div></div>' +
      (s.budget ? '<div class="cf-card"><div class="k">2026 purchase budget</div><div class="v">' + esc(s.budget) + '</div><div class="n">' + esc(s.remaining || '') + ' remaining</div></div>' : '') +
      (s.planTotal ? '<div class="cf-card"><div class="k">Estimated costs plan</div><div class="v">' + esc(s.planTotal) + '</div></div>' : '') + '</div>' +
      '<h2>Estimates by category</h2><div style="display:flex;gap:8px;flex-wrap:wrap">' + Object.keys(bySum).map(function (k) { return '<span class="cf-chip a">' + esc(k) + ' · ' + fmtMoney(bySum[k]) + '</span>'; }).join('') + '</div>' +
      '<h2>Items<small>' + b.items.length + '</small></h2><div class="cf-tblw"><table class="cf-tbl"><tr><th>Item</th><th>Category</th><th>Estimate</th><th>Actual / note</th><th>Status</th><th>Who</th></tr>' +
      b.items.map(function (i) { return '<tr><td>' + (i.done ? '✓ ' : '') + esc(i.item) + '</td><td>' + esc(i.cat) + '</td><td>' + esc(i.est) + '</td><td>' + esc(i.actual || i.details) + '</td><td>' + esc(i.progress) + '</td><td>' + esc(i.who) + '</td></tr>'; }).join('') + '</table></div>' +
      (b.purchases.length ? '<h2>Purchased so far</h2><div class="cf-tblw"><table class="cf-tbl"><tr><th>Date</th><th>Item</th><th>Where</th><th>Cost</th><th>Who</th></tr>' + b.purchases.map(function (p) { return '<tr><td>' + esc(p.date) + '</td><td>' + esc(p.item) + '</td><td>' + esc(p.where) + '</td><td>' + esc(p.cost) + '</td><td>' + esc(p.who) + '</td></tr>'; }).join('') + '</table></div>' : '') +
      (b.plan.length ? '<h2>Estimated expense plan</h2><div class="cf-tblw"><table class="cf-tbl">' + b.plan.map(function (p) { return '<tr><td>' + esc(p.item) + '</td><td>' + esc(p.est) + '</td></tr>'; }).join('') + '</table></div>' : '');
  }

  function vPartners(d) {
    var par = d.parking || { lots: [], shuttles: [] }, yes = d.businesses.filter(function (b) { return /^yes/i.test(b.participating); }).length;
    return '<h2>South Creek businesses<small>' + yes + ' of ' + d.businesses.length + ' participating</small></h2>' +
      (d.businesses.length ? '<div class="cf-tblw"><table class="cf-tbl"><tr><th>Business</th><th>Participating</th><th>Notes</th></tr>' + d.businesses.map(function (b) { if (canEdit()) return '<tr><td>' + esc(b.business) + '</td><td>' + ctlSel('businesses', b, 'participating', sheetOpts('businesses', 'participating', [], ['Yes', 'No', 'Pending']), true) + '</td><td>' + ctlTxt('businesses', b, 'notes', 'Notes') + '</td></tr>'; return '<tr><td>' + esc(b.business) + '</td><td>' + esc(b.participating) + '</td><td>' + esc(b.notes) + '</td></tr>'; }).join('') + '</table></div>' : '<div class="cf-empty">None listed.</div>') +
      '<h2>Donation requests</h2>' + (d.donations.map(function (x) { return taskCard('donations', x, { noChk: 1, prog: ['Not Started', 'Asked', 'Confirmed'], fields: [['notes', 'Notes', 'Notes']] }); }).join('') || '<div class="cf-empty">None.</div>') +
      '<h2>Parking &amp; shuttles</h2>' + par.lots.map(function (l) { return '<div class="cf-row"><div class="m"><b>' + esc(l[0]) + '</b><small>' + esc(l[1]) + '</small></div></div>'; }).join('') +
      (par.shuttles.length ? '<div class="cf-tblw"><table class="cf-tbl"><tr><th>Driver</th><th>Vehicle</th><th>Route</th><th>Times</th></tr>' + par.shuttles.map(function (s) { return '<tr><td>' + esc(s.driver) + '</td><td>' + esc(s.vehicle) + '</td><td>' + esc(s.from) + ' → ' + esc(s.to) + '</td><td>' + esc(s.times) + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<h2>Creative &amp; communication<small>' + d.creative.filter(function (c) { return c.done; }).length + ' of ' + d.creative.length + ' done</small></h2>' +
      (d.creative.map(function (c) { return taskCard('creative', c, { due: 1, sub: c.size, fields: [['who', 'Who', 'Who’s on it']] }); }).join('') || '<div class="cf-empty">None.</div>') +
      '<h2>Leaders by division</h2><div class="cf-tblw"><table class="cf-tbl"><tr><th>Division</th><th>Team</th><th>Director</th><th>Captain</th></tr>' + d.leaders.map(function (l) { return '<tr><td>' + esc(l.division) + '</td><td>' + esc(l.team) + '</td><td>' + esc(l.director) + '</td><td>' + esc(l.captain) + '</td></tr>'; }).join('') + '</table></div>';
  }

  /* opened by address: …/?hub=christmas (after the dashboard has finished starting) */
  function auto() { try { if (new URL(location.href).searchParams.get('hub') === 'christmas') setTimeout(window.cfHubOpen, 400); } catch (e) {} }
  if (document.readyState === 'complete') auto(); else window.addEventListener('load', auto);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) cfHubClose(); });
})();
