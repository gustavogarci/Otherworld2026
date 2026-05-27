# iOS PWA: Filters / Settings bottom-sheet layout

**Status:** Safari tab — fixed via `html:not(.is-standalone-app)` rules (2026-05-27). PWA — still open.  
**Last updated:** 2026-05-27  
**Related:** native `<dialog>` migration (`dialog#filters-modal`, `dialog#settings-modal`), `html.is-standalone-app` in `app.js`.

---

## Summary

Filters and Settings use bottom-anchored `<dialog>` sheets on mobile (`@media (max-width: 640px)` in `styles.css`). Layout looks correct in **iOS Safari** (address bar visible). In **iOS PWA** (Add to Home Screen, standalone), the same UI misbehaves: sheet drifts, content overlaps the footer, or the chip list collapses / only header+footer show.

Attempts to fix safe-area spacing (May 2026) made PWA worse; those changes were **reverted**. This doc captures reproduction, what was tried, and simpler directions for the next pass.

---

## What works vs what breaks

| Context | Filters / Settings layout |
|--------|---------------------------|
| iOS Safari (browser tab) | OK with `html:not(.is-standalone-app)` padding + `min(100lvh,100svh)` max-height in `styles.css` |
| iOS PWA (standalone) | Broken in cases below |
| Desktop | OK (centered / different rules) |

---

## Reproduction

### A. Sheet drifts down while scrolling (PWA, **with** background results)

1. Install PWA (Add to Home Screen).
2. Open app with a normal event list visible (e.g. many events, not filtered empty).
3. Open **Filters**.
4. Scroll the chip list downward inside the sheet.

**Observed:** The whole sheet (or its contents) appears to move **down** toward the bottom of the screen; eventually only a sliver of content + footer remain visible (see user screenshots `IMG_3001` — neighbourhoods/tags at bottom, huge empty area above).

**Expected:** Only `.sheet-body` scrolls; header and `.close-row` stay fixed within the sheet.

### B. Footer overlap / tight layout (PWA, **no** background results)

1. PWA: tap header **Favorites** so the schedule shows no events (`Done · no matches` when opening Filters).
2. Open **Filters**.

**Observed:** Tags run very close to or under the Done row; Neighbourhoods may be clipped; top padding under “Filters” title can feel large while bottom feels cramped (see `IMG_3003`).

**Note:** Same flow in Safari tab does **not** reproduce the same breakage.

### C. Original safe-area reports (still relevant)

- **Safari tab:** Title row (“Filters”, ✕) can sit under the status bar (top cut off).
- **PWA:** Extra dark band below Done/Close (double safe-area: `close-row` padding + `.home-indicator-scrim`).

---

## Architecture (current code)

### HTML (`index.html`)

```html
<dialog class="modal filters-modal" id="filters-modal">
  <div class="modal-head">…</div>
  <div class="sheet-body">…sections + chips…</div>
  <div class="close-row">Clear all · Done</div>
</dialog>
```

Settings modal mirrors this structure.

### CSS (`styles.css`, mobile)

- `dialog#filters-modal[open]`, `dialog#settings-modal[open]`:
  - `display: flex; flex-direction: column; overflow: hidden`
  - `margin: auto 8px 6px 8px` (bottom-anchored via `margin-top: auto` + UA dialog `inset: 0`)
  - `max-height: calc(100lvh - max(24px, env(safe-area-inset-top)) - 8px)`
  - `padding: 16px 18px 0`
- `.sheet-body`: `flex: 1 1 auto; overflow-y: auto`
- `.close-row`: `flex-shrink: 0`, `padding-bottom` uses `env(safe-area-inset-bottom)`

### JS (`app.js`)

- `bindStandaloneAppClass()` → `html.is-standalone-app` when `navigator.standalone` or `display-mode: standalone`.
- `openDialog()` / `showModal()`; `html.modal-open` locks document scroll.
- Filters: `renderFiltersModalOnly()` while open (schedule not re-rendered); `renderModalResultCounts()` sets `Done · N events` / `Done · no matches` from `totalVisibleEventCount()` (respects `state.favoritesOnly` + all filters).

### PWA-only helpers

- `.status-bar-scrim` / `.home-indicator-scrim` — fixed bands using `env(safe-area-inset-*)` on **body** (works).
- `body:has(dialog#filters-modal[open]) .home-indicator-scrim { background: var(--night-3) }` — fills gap below layout viewport where `::backdrop` does not extend in standalone.

### Meta

- `viewport-fit=cover`, `apple-mobile-web-app-status-bar-style: black-translucent` in `index.html`.

---

## Known iOS quirks (likely root causes)

1. **`env(safe-area-inset-*)` inside top-layer `<dialog>`** often resolves to **0** even with `viewport-fit=cover`. Insets measured on `document.body` work; same `env()` on the dialog does not.
2. **`100lvh`** is the large viewport (URL bar hidden). In Safari tab, sheet can be taller than visible area → top clips. Less relevant in PWA (no URL bar).
3. **Flex + `overflow-y: auto` on `.sheet-body`** without a definite flex container height: middle child may not shrink; content paints under `.close-row` or sheet height collapses/expands oddly when scrolling (especially PWA).
4. **`::backdrop` / layout viewport** in standalone does not cover the home-indicator band; scrim element is required (see comments in `styles.css` ~L235).

---

## What was tried and reverted (May 2026)

Do **not** re-apply blindly; several made PWA worse.

| Approach | Result |
|----------|--------|
| Safari-only: `padding-top`, `min(100lvh,100svh)`, `max(47px, env(safe-area-inset-top))` | Helped Safari top; scoped with `html:not(.is-standalone-app)` |
| PWA: `margin-bottom` on sheet, symmetric `close-row` padding, transparent/tinted scrim | Partial bottom spacing wins; inconsistent |
| JS `--ow-safe-top` / `--ow-safe-bottom` probes on `<body>` | Still wrong in PWA when combined with other rules |
| `flex: 1 1 0` + `min-height: 0` on `.sheet-body` | **Collapsed chip area** (header + footer only) |
| `flex: 1 1 auto` + `min-height: 0` | Overlap persisted with no matches |
| CSS Grid `grid-template-rows: auto minmax(0,1fr) auto` | Sheet shrank to ~1/3 screen; scroll still drifted |
| Reset `sheetBody.scrollTop` on open | No fix for drift |

**Reverted to:** flex column sheet + original padding/margin + no `--ow-safe-*` JS (post–dialog migration baseline). **Re-applied (Safari only):** `html:not(.is-standalone-app)` top padding + `min(100lvh, 100svh)` max-height — do not scope these to PWA.

---

## Simpler directions for next fix

### 1. Top of sheet (cosmetic, both modes)

User feedback: **too much space above the “Filters” label** inside the card.

- Try reducing dialog `padding-top` from `16px` → `12px` (or only on `.modal-head` margin).
- Keep **separate** from safe-area notch clearance (notch = space **above** the card, not inside it).

### 2. PWA: space above the card (notch / status bar)

Goal: sheet sits below the status bar; backdrop visible in rounded top corners.

- `margin-top` / `top` offset on `dialog[open]` using **JS-measured** `--ow-safe-top` from body probe (not `env()` on dialog).
- Or fixed `margin-top: max(8px, 47px)` for standalone only.

### 3. PWA: scroll region (functional — priority)

Goal: only `.sheet-body` scrolls; header/footer fixed; no sheet drifting on touch-scroll.

Candidates (test on device one at a time):

- `min-height: 0` on `.sheet-body` **with** `flex: 1 1 auto` and explicit `max-height` on dialog (or `height: min(fit-content, max-height)` where supported).
- CSS Grid on dialog: `grid-template-rows: auto minmax(0, 1fr) auto` **plus** explicit `max-height` and verify grid container actually hits max-height on iOS.
- Avoid `flex: 1 1 0` (collapses body when dialog height is content-sized).
- On `openDialog`, set dialog `style.maxHeight` from `visualViewport.height - safeTop - safeBottom` (one-shot JS layout).

### 4. PWA: bottom spacing (cosmetic)

- **Either** `close-row` padding-bottom **or** sheet `margin-bottom` + scrim — not both at full safe-area height.
- Symmetric `12px` above/below buttons inside tray; home-indicator clearance = gap **below the card** (margin), not empty tray padding.

### 5. Do not tie layout to `totalVisibleEventCount()`

“No matches” does not change filter chip DOM; breakage correlates with **empty schedule + PWA + scroll**, not chip count text. Fix layout container, not result label.

---

## Test checklist (real device)

- [ ] PWA: Filters with 500+ events visible behind → open → scroll to Neighbourhoods → sheet stable
- [ ] PWA: Favorites only, zero events → Filters → all sections scrollable, footer not overlapping
- [ ] PWA: Settings → Backup → close → Settings footer still correct
- [ ] Safari tab: Filters title clears status bar
- [ ] Safari tab: bottom sheet above URL bar, acceptable corner gap

---

## Key files

| File | Role |
|------|------|
| `index.html` | `<dialog id="filters-modal">`, viewport meta, scrim divs |
| `styles.css` | ~L235–280 scrims; ~L2120–2220 mobile dialog/sheet |
| `app.js` | `bindStandaloneAppClass`, `openDialog`, filters snapshot, `renderModalResultCounts` |
| `scripts/dialog-review.js` | Playwright screenshots (does **not** simulate iOS safe areas) |

---

## Screenshots (user-provided, May 2026)

Stored in Cursor assets / user camera roll; reference labels:

- **With results, initial** — full chip list, acceptable header spacing
- **With results, after scroll** — sheet collapsed to bottom third (`IMG_3001`)
- **No matches** — footer overlap / tight (`IMG_3003`)

Attach fresh screenshots when opening a new agent thread.
