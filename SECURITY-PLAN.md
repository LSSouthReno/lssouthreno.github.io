# Church Dashboard: Security Audit and Plan

Audited 2026-10-19. Plain English on purpose.

## The short version

The dashboard's "sign in" is a lock on the front door of a house with no walls. The screens ask for a PIN, but the data behind them sits in files that anyone on the internet can open by typing the address. The code is public too (it is in a public GitHub repo), so the "secret" parts of the lock are visible to anyone who looks.

Real protection means the data is **never sent to someone who has not signed in**. That needs a change to how the site is hosted. It is a moderate project, not a rewrite (see the plan below).

## What is exposed today (worst first)

Tested as an anonymous visitor with no sign-in. Everything below came back with no login.

1. **Pastoral care list (`shepherding-data.json`).** About 390 named people, each with health status, who is shepherded by which elder, baptized or not, membership, giving info and family-process step. The most sensitive file on the site. The pastor email-code login only protects the *screen*; the file itself is open.
2. **Staff and group data (`eos-data.json`).** Every small-group roster (about 2,000 memberships with names and leader/member role), the elder shepherding lists (about 380 names), staff profiles, the full calendar, rocks and the leadership scorecard.
3. **Main dashboard data (`dashboard-data.json`).** Names of about 310 volunteers with serving rates, lists of people not in a group, group leader names, staff time off, and **monthly giving totals and donor counts** (the "members only" giving screen is only hidden on screen; the numbers are in this file).
4. **Joy-bomb list (`joy_bombs.json`).** About 47 named volunteers **with their phone numbers**.
5. **Staff Personal Workspace server (Google Apps Script).** It answers anyone who asks. Anonymous visitors can read the staff workspace (tasks, plans, staff names/roles). The "staff key" that is supposed to protect the Stories list (people's testimonies) is printed in the public page code, so anyone can use it. Meeting minutes can also be read by anyone.
6. **Absences, EOS issues list** (`absences.json`, `ids_log.json`): named staff time off and internal issues.
7. **The sign-in codes themselves.** The staff PIN is "the last 4 digits of your phone." Only 10,000 possibilities, and the "fingerprint" (hash) of the staff code, the members giving passcode, the groups passcode, and the teams/leaders admin codes are all visible in the public page code. Anyone can work out a weak code on their own computer in seconds, with no lockout.
8. **The code and history are public.** The GitHub repo is public. Every past version of every data file (about 11,700 saves, years of names and phone numbers) can be downloaded by anyone. The Apps Script code (`Code_*.gs`) is public too, which shows an attacker exactly how each check works.
9. **Browser copies.** The site saves a copy of the data in the visitor's browser for offline use. On a shared or lost device, that copy can outlive the sign-in.

**Good news.** Nobody committed a password, API key, or access token into the code or its history (I searched all of it). The Planning Center and GitHub keys live in Google's private script settings, which is the right place. The pastor Care login is also correctly checked on the server (wrong code is refused, 6-digit email code required).

**Search engines.** Because everything is public, Google can index the data files. A `robots.txt` now asks it not to (see below). That is only a request, not a lock.

## What I fixed now (safe, nothing breaks for staff)

- Removed the groups passcode that was written in plain words inside the page code.
- Added `robots.txt` asking search engines to skip data files, tools and the journey/fit pages.
- Marked the onboarding generator, journey and fit pages "do not index."
- Stopped the browser from leaking the page address to other sites (referrer policy).
- Added to the ignore list so keys, spreadsheets, and exports cannot be committed by accident.

I did **not** strip names out of the data files. The signed-in screens read those exact files, and the automatic sync rewrites them every few minutes, so removing names would break the dashboard for staff (and my edit would be undone on the next sync). That is the real fix and it belongs in the plan below.

## Do these now (Brad, about 20 minutes)

1. **Change the groups passcode** ("groups2026"). It was visible in public code. Pick a new one; I can then update the stored fingerprint.
2. **Change the staff PINs approach.** Last-4-of-phone is too guessable. Short term: nothing breaks if we leave it, but treat the staff, members-giving, teams-admin and leaders-admin codes as **already known** and change them when the new sign-in (Step 2 below) is in.
3. **Rotate the Stories "staff key"** after Step 2, since it is public today.
4. Do not put real phone numbers, emails, or giving figures into anything in this repo by hand.

## The simplest path to real protection

**Goal:** the website files are not readable unless someone has signed in with a church Google account.

**Step 1: Put the whole site behind a login (about 1 day, free).** Move hosting from GitHub Pages (which cannot lock anything) to **Cloudflare Pages with Cloudflare Access** (free for up to 50 people). Staff sign in with their `@lschurches.com` Google account (or an emailed one-time code). Every page and every data file is then blocked for anonymous visitors, including the JSON files. The site address stays the same. The existing screens keep working because the data files are still the same files, just behind a door.
- Then make the GitHub repo **private** (this also hides the history). GitHub Pages cannot serve a private repo on the free plan, which is why Step 1 comes first.
- The public welcome page (the "You belong to Jesus" front page) should stay open: put it on its own address (e.g. `lssouthreno.com` public, `staff.lssouthreno.com` locked). Moving the front page into a small separate public site takes about half a day.

**Step 2: Make Apps Script check who is asking (about 1 to 2 days).** The staff workspace, stories and meeting-minutes endpoints should only answer if the request comes from a signed-in church Google account (or carries a short-lived token the server issued), not a key printed in the page. Remove the "key in the page" pattern.

**Step 3: Retire the home-made PIN screens (about 1 day).** Once the whole site is behind Google sign-in, the staff PIN, members passcode and group/teams/leaders passcodes become a second layer only. Keep one for giving; give each pastor/staff role a named account list in Cloudflare Access instead of a shared code.

**Step 4: Scrub the past (about half a day).** After the repo is private, rewrite or recreate it without the old data history so old phone numbers and names are not lying around in old versions. Also stop publishing the `Code_*.gs` files (move them to a private repo).

**Step 5: Trim the data (optional, ongoing).** Split `dashboard-data.json` into a small public summary (just the numbers on the welcome page) and a locked detail file. With Step 1 done this is a nice-to-have.

| Step | Effort | Cost |
|---|---|---|
| 1 Login in front of the site | about 1 day | free (Cloudflare) |
| 2 Server checks who is asking | 1 to 2 days | free |
| 3 Retire PIN screens | about 1 day | free |
| 4 Clean old history | about half a day | free |
| 5 Split the data (optional) | 1 day | free |

## What I need from Brad

- **OK to move hosting to Cloudflare** (free account, you or I create it), or tell me if you prefer another host (Netlify with a password, or Google-only).
- **Which people get in?** Staff only, or staff plus elders and team leaders? An email list is enough.
- **Public front page:** keep `lssouthreno.com` as the open welcome page and put the staff dashboard on a second address like `staff.lssouthreno.com`?
- **Giving numbers:** who may see them (pastors only, or all staff)?
- **New passcode** for the groups screen, today.

## Quarterly security checklist (15 minutes, 1st of Jan/Apr/Jul/Oct)

1. Open the site in a private window **without signing in**. Try `/dashboard-data.json`, `/eos-data.json`, `/shepherding-data.json`, `/joy_bombs.json`. Each should say "access denied," not show names.
2. Check the repo is **private** and the list of people with access is current (remove anyone who left).
3. Review who is on the sign-in list. Remove departed staff and volunteers the same day they leave (not just quarterly).
4. Change shared passcodes (members giving, groups). Never write a passcode in code or in chat.
5. Rotate the Planning Center, GitHub and any other keys saved in Apps Script settings. Confirm none are in the code (search the repo for "token", "secret", "key").
6. In Apps Script, check each web app deployment: "Who has access" should be your church account or an allow-list, not "Anyone," once Step 2 is done. Remove deployments you no longer use.
7. Look at GitHub Settings > Security for any alerts and turn on secret scanning.
8. Confirm no spreadsheets, exports, or phone/email lists have been added to the project folder.
9. Test sign-out on a shared computer: sign out, then reload. Nothing private should still show.
10. Write the date and any changes at the bottom of this file.

## Log

- 2026-10-19: First audit. Quick fixes applied (passcode removed from code, search-engine blocks, referrer policy, ignore list). Real fix (login in front of the site) is waiting on Brad's decisions above.
