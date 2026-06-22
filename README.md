# Otherworld 2026 — "Stay Moist"

A mobile-first, installable festival companion for the unofficial Otherworld 2026 community schedule. Two schedules (community activities + live DJ lineup), an interactive map, themes, favorites with backup, and full offline support. Live at **[otherworld2026.vercel.app](https://otherworld2026.vercel.app)**.

Not affiliated with Kindle Arts Society or Otherworld.

---

## What it does

- **Two schedules in one app** — community activities and the live DJ-set lineup, switchable from the header or via `/activities` and `/music` URLs.
- **Three views** — By Day (live hourly timeline), By Camp / By Stage, and a pinch-zoom **interactive festival map** with tappable camp pins.
- **Now & next** — a live "now" line, current-hour highlight, and jump-to-now, so you always see what's happening around you.
- **Favorites that survive the festival** — typo-tolerant keys, a "can't-miss" red tier, undo, self-heal on upstream renames, and base64 backup/restore codes so you never lose your plan.
- **Search & filters** — by text, type (camp/stage/art/MV), happening-now, up-next, time of day, duration, tags/genres, and neighbourhood.
- **10 themes** — shareable via slug URLs like `/ripple` and `/mother-tree`.
- **Installable PWA** — Add to Home Screen for a full-screen, offline-capable app.

---

## Credit where it's due

This is a fork of **[Isaiiaas/OtherworldWWW](https://github.com/Isaiiaas/OtherworldWWW)** — the original community schedule that does the actual heavy lifting: it talks to camp owners, ingests their edits from a shared Google Sheet, runs the dashboard where they self-edit, and reconciles everything into a clean `events.json` every hour. Without Isaiiaas's project, this fork wouldn't have any data to display.

Huge thanks to Isaiiaas for building (and keeping running) the canonical site — please support that project first.

---

## What this fork is

A static, mobile-first take on the same data, deployed on Vercel. The data pipeline still lives entirely upstream:

- **Upstream owns the data.** Camp owners edit via Isaiiaas's [Google Sheet](https://docs.google.com/spreadsheets/d/1o9Ue218Yx8mMa9OGyPfd66NoofYI3O1ewkN8NB-qnVc) or dashboard, just like before.
- **This fork mirrors it.** A GitHub Action pulls fresh `events.json` (and a handful of related data files) from upstream every hour, commits it to this repo, and Vercel auto-deploys the static site.
- **No PHP, no server, no database.** Just static files — `index.html` + `styles.css` + `themes.css` + `app.js` + `sw.js` + the data files.

If upstream goes down, this mirror's data gets stale but nothing breaks. If this mirror goes down, the canonical site is unaffected.

### Music lineup (DJ sets)

The "By Stage" music dataset is a fork-specific addition with its own source. Its source of truth is the **live Dancing Decibels event feed** (`https://eventdata.dancingdecibels.com/EID-...json`), which updates continuously. A second GitHub Action (`.github/workflows/sync-music-data.yml`) fetches that feed every ~15 minutes, runs `scripts/build-music.js` to normalise its `artistPerformanceList` into the same event shape `events.json` uses, and commits the result to `music.json` — Vercel then auto-deploys.

The legacy `music.csv` is no longer the source of truth (it was a one-off manual export); the live feed is. `build-music.js` still accepts either a CSV or the JSON feed, so the CSV path remains for ad-hoc local rebuilds. The committed `music.json` doubles as the offline/failure fallback: if the feed is unreachable or returns too few performances, the sync aborts and the last-good `music.json` stays in place.

---

## Philosophy / what's different

- **Mobile-first, then desktop.** Designed for the festival-attendee on Vancouver Island standing in a field with one bar of cell signal — not for a planner sitting at a desk. Header collapses on scroll, modals are bottom-anchored sheets on phones, tap targets are thumb-sized.
- **Installable as a PWA.** Add to Home Screen on iOS / Android gets you a full-screen icon-launched experience, with the schedule available offline after the first load.
- **No build step.** Open `index.html` in a browser locally and it works. Edit the CSS, refresh — that's the dev loop.
- **Defensive, opinionated UI.** Favorites are stored in `localStorage` with a normalised key (camp + day + title with accents/emoji/punctuation stripped) so a camp owner fixing a typo in their event title doesn't silently unstar it for everyone. There's a backup/restore flow for the same reason.

---

## Notable changes vs. upstream

- **A second dataset.** The live DJ-set lineup (`music.json`) is a fork-only feature with its own data source and sync pipeline — switchable in-app and via `/music` / `/activities` URLs.
- **An interactive festival map.** Pan/zoom/pinch, type-colored pins, filter-aware dimming, and tap-a-pin-for-the-camp's-events modals — backed by a fork-built pin dataset and an agent-assisted placement + QA tooling pipeline (`scripts/parse-map.js`, `crop-map.js`, `merge-*.js`).
- **10 named themes** (`themes.css`) shareable via slug URLs (`/ripple`, `/mother-tree`, …), with theme-specific ambient backgrounds.
- **Now/next live logic** — a live "now" line, current-hour highlight, "earlier today" collapse, jump-to-now, and a dev-mode time override for previewing the schedule mid-festival.
- Native `<dialog>` modals with iOS-friendly bottom-sheet behaviour on small screens
- Settings sheet with toggleable description density, favorites backup/restore, theme picker, and dev-mode time simulation
- Favorites: typo-tolerant normalised keys, "can't-miss" red tier, undo toast, self-heal on upstream renames, corrupt-data recovery, and base64 backup/restore codes
- PWA install support (service worker, offline schedule, manifest, themed status bar, dedicated icons at 16/32/180/192/512)
- Split codebase: `index.html` + `styles.css` + `themes.css` + `app.js` instead of one monolithic file
- iOS Safari modal stability fixes (viewport unit fallbacks, map prewarm to avoid the keyboard-jump glitch)
- A few accessibility passes (aria-pressed states, focus management, dialog-native escape handling)
- Rebranded as **"Stay Moist"** (manifest, OG/social banners, themed install icon)
- All the PHP / dashboard / reconciler pieces are stripped from the deploy — they're not removed from the repo (so upstream merges stay clean) but `.vercelignore` keeps them out of production

---

## Repo layout

```
index.html              # Page shell + all UI sections/modals
styles.css              # Core styles (mobile-first, dark)
themes.css              # 10 named theme token sets
app.js                  # All client-side logic (~4.5k lines)
sw.js                   # Service worker (offline shell + data caching)
site.webmanifest        # PWA manifest ("Stay Moist")
events.json             # Activities schedule (mirrored hourly from upstream)
music.json              # DJ-set lineup (rebuilt ~every 15 min from the live Dancing Decibels feed)
music.csv               # Legacy manual export; no longer the source of truth (not deployed)
data.js                 # Legacy artifact, also mirrored
map.webp                # Festival map image (fork-maintained, ~1.6 MB WebP)
map-data.js             # Pin overlays for the map view
map-locations.json      # Pin source data
map-labels.json         # Label clusters
camp-aliases.json       # Camp-name typo fixes

scripts/                # Fork build/dev tooling (not deployed): build-music.js (CI), map pipeline
                        # (parse-map / crop-map / merge-*), icon + OG generators, Playwright harnesses
.github/workflows/      # GitHub Actions: mirror activities from upstream + sync music from the live feed
vercel.json             # Theme/dataset slug rewrites + Cache-Control headers
.vercelignore           # Keeps PHP / admin / scripts / tooling out of the deploy

admin/, *.php           # Inherited from upstream, NOT deployed.
                        # Left in place so upstream merges stay tidy.
```

---

## Running locally

```bash
# Any static server works. Two zero-install options:
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`. No build, no deps.

---

## License

This project is licensed under the **[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)**.

In plain terms: you're free to use, copy, modify, and share this code for **any noncommercial purpose** — personal use, learning, other community/nonprofit festival tools — as long as you keep the attribution. **You may not use it (or a fork of it) for commercial purposes**, including selling it, running it as a paid product, or monetising a deployment, without explicit permission.

Two caveats:

- This license covers the **fork's own code** (the UI, map system, music pipeline, tooling). The schedule **data** flows from upstream and from camp owners — it isn't ours to license.
- Upstream ([Isaiiaas/OtherworldWWW](https://github.com/Isaiiaas/OtherworldWWW)) hasn't published a license, so the inherited upstream files remain under upstream's (currently unstated) terms.

---

> This website is not affiliated with Kindle Arts Society or Otherworld. It is a community-maintained tool. All schedule data flows from camp owners through the upstream pipeline maintained by Isaiiaas.
