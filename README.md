# Church Metrics Dashboard

## Files
- `index.html` — public Netlify dashboard. It fetches `/dashboard-data.json`.
- `dashboard-data.json` — generated hourly by Google Apps Script.
- `Code.gs` — Apps Script sync job.

## Flow
Planning Center + Teams Google Sheet -> Google Sheet cache -> GitHub `dashboard-data.json` -> Netlify automatic deploy.

## Apps Script setup
1. Create a new Google Sheet for the dashboard cache.
2. Extensions > Apps Script.
3. Paste `Code.gs`.
4. Project Settings > Script Properties, add:
   - `PCO_APP_ID`
   - `PCO_SECRET`
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH` = `main`
   - `v` = `dashboard-data.json`
5. Run `syncDashboard` once and authorize.
6. Run `setupHourlyTrigger` once.

## GitHub / Netlify setup
1. Create a GitHub repo with `index.html` and an initial `dashboard-data.json`.
2. Connect the repo to Netlify.
3. Build command: blank.
4. Publish directory: `/`.
5. Netlify will auto-deploy whenever Apps Script commits a new `dashboard-data.json`.
