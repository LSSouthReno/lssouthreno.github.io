// LS Dashboard service worker — makes the site installable, fast, and usable on weak Wi-Fi.
// · Pages and scripts: the NETWORK comes first, so a new build shows on the very next open (a saved
//   copy used to be shown first, which kept old looks and old sign-in screens on returning devices).
//   The saved copy is only used offline or if the network takes longer than PAGE_HEAD_START.
// · Images, fonts: STALE-WHILE-REVALIDATE — shown instantly from this device, refreshed in the background.
// · Data files (*.json): the network gets a short head start; if it's slow the saved copy is shown
//   right away and the fresh one is saved for next time.
// · Apps Script (script.google.com) and everything else is never touched.
const CACHE = 'lssr-app-v13';
const SHELL = ['./', './index.html', './manifest.webmanifest', './team-checklists.js', './conferences.js', './engagement.js', './christmas-hub.js', './theme.js', './data-access.js',
  './assets/ls-logo-white.png', './assets/ls-lockup-white.png', './assets/app/icon-192.png', './assets/belong-topo.svg',
  './journey/', './journey/manifest.webmanifest'];   // the member app (Me) opens instantly / offline too
const DATA_ORIGINS = [self.location.origin, 'https://lssouthreno.com'];          // the beta reads the live data files
const STATIC_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const DATA_HEAD_START = 900;   // ms the network gets before the saved copy is used
const PAGE_HEAD_START = 4000;  // pages/scripts: ms before falling back to the saved copy (weak Wi-Fi)
const APP_HEAD_START = 600;    // the member app's own page: show the saved copy almost at once (it refreshes itself from its saved data)

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => {
    const old = keys.filter(k => k !== CACHE);
    return Promise.all(old.map(k => caches.delete(k)))
      .then(() => self.clients.claim())
      // Replacing an older helper: open pages may be its saved old copy, so load them fresh once.
      .then(() => old.length && self.clients.matchAll({ type: 'window' })
        .then(list => list.forEach(c => c.navigate && c.navigate(c.url).catch(() => {}))));
  }));
});

function save(key, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/build.txt') || url.pathname.endsWith('/sw.js')) return;   // update check always live
  const isData = /\.json$/.test(url.pathname) && !/manifest/.test(url.pathname) && DATA_ORIGINS.indexOf(url.origin) >= 0;
  const isStatic = STATIC_HOSTS.indexOf(url.hostname) >= 0;
  // Integrity-pinned libraries (Chart.js…) go straight to the network: a saved no-cors copy can't pass
  // the integrity check, and the browser's own HTTP cache already keeps them fast.
  if (req.integrity || (isStatic && req.destination === 'script')) return;
  if (url.origin !== self.location.origin && !isData && !isStatic) return;

  // One cache entry per path (pages add ?v=<time> to data fetches; don't store each one).
  // Section paths (/sunday …) are the dashboard page; real folders are their own page.
  const nav = req.mode === 'navigate', folder = (/^\/(journey|fit|links)(\/|$)/.exec(url.pathname) || [])[1];
  const key = isStatic ? req.url : url.origin + (nav ? (folder ? '/' + folder + '/' : '/') : url.pathname);

  if (isData) {
    e.respondWith(caches.match(key).then(hit => {
      // Ask without the page's ?v=<time> and let the server answer "not changed" (304) when it hasn't:
      // the data files change hourly, so most opens no longer download ~2 MB again.
      const net = fetch(url.origin + url.pathname, { cache: 'no-cache' }).catch(() => fetch(req)).then(res => save(key, res));
      if (!hit) return net;
      const timer = new Promise(r => setTimeout(() => r(hit), DATA_HEAD_START));
      e.waitUntil(net.catch(() => {}));
      return Promise.race([net.catch(() => hit), timer]);
    }));
    return;
  }
  // 404 bounce pages (/church, /give …) must stay live: they're tiny and route by address.
  if (nav && !folder && url.pathname !== '/' && url.pathname !== '/index.html') return;
  const code = nav || /\.(html|js|css|webmanifest)$/.test(url.pathname);
  if (code && !isStatic) {
    e.respondWith(caches.match(key).then(hit => {
      const net = (nav ? fetch(req) : fetch(req, { cache: 'no-cache' })).then(res => save(key, res));
      const offline = () => hit || (nav ? caches.match(self.location.origin + (folder === 'journey' ? '/journey/' : '/')) : Response.error());
      if (!hit) return net.catch(offline);
      e.waitUntil(net.catch(() => {}));
      const timer = new Promise(r => setTimeout(() => r(hit), nav && folder === 'journey' ? APP_HEAD_START : PAGE_HEAD_START));
      return Promise.race([net.catch(offline), timer]);
    }));
    return;
  }
  e.respondWith(caches.match(key).then(hit => {
    const net = fetch(req).then(res => save(key, res));
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => nav ? caches.match(self.location.origin + (folder === 'journey' ? '/journey/' : '/')) : Response.error());
  }));
});
