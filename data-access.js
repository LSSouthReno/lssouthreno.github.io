/* =====================================================================================
   DATA ACCESS — who sees names in the data files.
   The public data files (dashboard-data.json, eos-data.json, …) hold NO personal details:
   names, phone numbers and leaders' feedback are blanked by the backend before publishing
   (Code_privdata.gs). Signed-in staff, pastors and team leaders get the full files from the
   backend instead, checked against their phone sign-in pass. This wraps fetch() so every
   existing data load in the page gets the right version without changing it.
   lssr_priv = '1' is set by the sign-in (lssrApplyAccess) when the server says this person
   has staff / pastor / leader access; sign out clears it. Load this right after theme.js.

   SPEED (Oct 2026): a backend read takes 2–6 s, so the last full copy is kept on this device
   (Cache Storage, per sign-in) and handed over at once; a fresh copy is fetched in the
   background and, if it changed, the page is told ('lssr-priv-updated') so it can redraw.
   Sign out (lssrWipeDevice) deletes these copies with every other saved *.json.
   ===================================================================================== */
(function () {
  var FILES = /^\/(dashboard-data|eos-data|joy_bombs|absences|shepherding-data|pathway)\.json$/;
  var API = 'https://script.google.com/macros/s/AKfycby82X64_1Pty8PDklGroIx3tteSaLn-8XUsLpODyX77pZ7TquGgaVSrBv9sqQAMBoDm/exec';
  // The fast API (Cloudflare Worker, Fast Backend Plan P1) answers in ~0.2 s; Apps Script (API) is the fallback.
  var FAST = 'https://api.lssouthreno.com';
  var STORE = 'lssr-priv-v1', FRESH_MS = 2 * 60 * 1000, MAX_STALE_MS = 18 * 60 * 60 * 1000;
  var orig = window.fetch.bind(window), memo = {}, inflight = {};
  function pass() {
    try { return localStorage.getItem('lssr_priv') === '1' ? (localStorage.getItem('lssr_journey_token') || '') : ''; } catch (e) { return ''; }
  }
  // One saved copy per file per sign-in (the key ends in .json so the sign-out wipe removes it).
  function key(name, token) { return location.origin + '/__priv/' + token.slice(-12) + '/' + name; }
  function saved(name, token) {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(STORE).then(function (c) { return c.match(key(name, token)); })
      .then(function (r) { return r ? r.text().then(function (t) { return { body: t, at: Number(r.headers.get('x-at')) || 0 }; }) : null; })
      .catch(function () { return null; });
  }
  function save(name, token, body) {
    if (!window.caches) return;
    caches.open(STORE).then(function (c) {
      return c.put(key(name, token), new Response(body, { headers: { 'Content-Type': 'application/json', 'x-at': String(Date.now()) } }));
    }).catch(function () {});
  }
  // The backend read itself (one at a time per file).
  function fast(name, token) {
    return orig(FAST + '/priv/' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 200) return r.text().then(function (t) { JSON.parse(t); return t; });
        return r.json().then(function (j) { if (j && (j.signin || r.status === 403)) return { verdict: j }; throw new Error('fast ' + r.status); });
      });
  }
  function network(name, token) {
    if (inflight[name]) return inflight[name];
    var slow = function () { return orig(API + '?action=priv_file&name=' + encodeURIComponent(name) + '&token=' + encodeURIComponent(token) + '&_=' + Date.now())
      .then(function (r) { return r.json(); }); };
    var p = fast(name, token)
      .then(function (out) {
        if (typeof out === 'string') return JSON.parse(out);            // the Worker had it
        return out.verdict.signin ? slow() : out.verdict;              // "not signed in" → let Apps Script confirm; "not your access" stands
      }, slow)
      .then(function (j) {
        if (!j || j.ok === false) {
          if (j && j.signin) { try { localStorage.removeItem('lssr_priv'); } catch (e) {} }
          throw new Error((j && j.error) || 'no access');
        }
        delete j._private;
        var body = JSON.stringify(j);
        save(name, token, body);
        return body;
      });
    inflight[name] = p;
    p.then(function () { delete inflight[name]; }, function () { delete inflight[name]; });
    return p;
  }
  function full(name, token) {
    var hit = memo[name];
    if (hit && Date.now() - hit.at < 60000) return hit.p;   // pages ask for the same file several times
    var p = saved(name, token).then(function (s) {
      if (s && Date.now() - s.at < MAX_STALE_MS) {
        if (Date.now() - s.at > FRESH_MS) {                   // show the saved copy now, refresh behind it
          network(name, token).then(function (body) {
            memo[name] = { at: Date.now(), p: Promise.resolve(body) };
            if (body !== s.body) { try { window.dispatchEvent(new CustomEvent('lssr-priv-updated', { detail: { name: name } })); } catch (e) {} }
          }).catch(function () {});
        }
        return s.body;
      }
      return network(name, token);
    });
    memo[name] = { at: Date.now(), p: p };
    p.catch(function () { if (memo[name] && memo[name].p === p) delete memo[name]; });
    return p;
  }
  window.fetch = function (input, init) {
    try {
      var u = new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href);
      var m = u.origin === location.origin && FILES.exec(u.pathname), t = m && pass();
      if (t) {
        return full(m[1] + '.json', t)
          .then(function (body) { return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }); })
          .catch(function () { return orig(input, init); });   // can't reach / no access → the public file
      }
    } catch (e) {}
    return orig(input, init);
  };
  window.lssrPrivReset = function () { memo = {}; inflight = {}; };
  // Warm the saved copies as soon as a signed-in staff page opens (the page asks a moment later).
  window.lssrPrivWarm = function (names) {
    var t = pass(); if (!t) return;
    (names || ['dashboard-data.json', 'eos-data.json']).forEach(function (n) { full(n, t).catch(function () {}); });
  };
})();
