// Mobile screenshot harness for the Otherworld 2026 site.
//
// Launches a headless Chromium emulating an iPhone 15 Pro, walks through
// the key UI states (search modal, filters modal, scrolled state, map
// fullscreen, etc.), and writes one PNG per state into screenshots/.
//
// Usage:
//   1. make sure something is serving the site at http://localhost:8000
//      (e.g. `python3 -m http.server 8000`)
//   2. `node scripts/mobile-screenshots.js`
//
// The script is idempotent — overwrites previous shots in place.

const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = process.env.OW_URL || "http://localhost:8000/";
const OUT_DIR = path.join(__dirname, "..", "screenshots");

// iPhone 15 Pro: 393x852 logical pixels, 3x DPR, mobile UA + touch
// support. Playwright's chromium engine sometimes ignores the device's
// viewport, so we explicitly override to be safe.
const DEVICE = {
  ...devices["iPhone 15"],
  viewport: { width: 393, height: 852 },
  screen: { width: 393, height: 852 },
};

function out(name) {
  return path.join(OUT_DIR, name + ".png");
}

async function shot(page, name) {
  const p = out(name);
  await page.screenshot({ path: p, fullPage: false });
  console.log("  →", path.relative(process.cwd(), p));
}

async function shotFull(page, name) {
  const p = out(name);
  await page.screenshot({ path: p, fullPage: true });
  console.log("  → (full)", path.relative(process.cwd(), p));
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ ...DEVICE });
  const page = await context.newPage();

  page.on("pageerror", e => console.error("[pageerror]", e.message));
  page.on("console", msg => {
    if (msg.type() === "error") console.error("[console.error]", msg.text());
  });

  console.log("Loading", BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  // Render settles after fetch+dedupe; small grace period.
  await wait(400);

  console.log("\n[1] Default By Day view");
  await shot(page, "01-default-by-day");

  console.log("\n[2] Scrolled (~800px) — header should auto-hide");
  await page.evaluate(() => window.scrollTo(0, 800));
  await wait(400);
  await shot(page, "02-scrolled-header-hidden");

  console.log("\n[3] Scroll up a tiny bit — header reveals instantly");
  await page.evaluate(() => window.scrollBy(0, -8));
  await wait(400);
  await shot(page, "03-scrolled-header-back");

  console.log("\n[4] Search modal open (empty)");
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await page.locator("#search-open").click();
  await wait(350);
  await shot(page, "04-search-modal-empty");

  console.log("\n[5] Search modal with a query");
  await page.locator("#search").fill("music");
  await wait(250);
  await shot(page, "05-search-modal-typed");

  console.log("    ...closing search");
  await page.locator("#search-clear").click();
  await wait(100);
  await page.locator("#search-done").click();
  await wait(300);

  console.log("\n[6] Filters modal open (empty)");
  await page.locator("#filters-open").click();
  await wait(350);
  await shot(page, "06-filters-modal-empty");

  console.log("\n[7] Filters modal with selections");
  // Tap Happening Now + a couple of tags + a neighbourhood
  await page.locator('#quick-chips .chip[data-quick="now"]').click({ force: true });
  await wait(80);
  // First two tag chips
  const tagChips = page.locator("#tag-chips .chip");
  if ((await tagChips.count()) >= 2) {
    await tagChips.nth(0).click({ force: true });
    await wait(50);
    await tagChips.nth(1).click({ force: true });
  }
  // First neighbourhood
  const nbhChips = page.locator("#neighbourhood-chips .chip");
  if ((await nbhChips.count()) >= 1) await nbhChips.nth(0).click({ force: true });
  await wait(200);
  await shot(page, "07-filters-modal-active");

  console.log("    ...scroll inside filters sheet");
  await page.locator(".filters-modal .sheet-body").evaluate(el => el.scrollTo(0, 500));
  await wait(200);
  await shot(page, "08-filters-modal-scrolled");

  console.log("    ...closing filters");
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);

  console.log("\n[9] Active filter pill row in header (apply 1 quick filter)");
  await page.locator("#filters-open").click();
  await wait(200);
  await page.locator('#quick-chips .chip[data-quick="favorites"]').click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);
  await shot(page, "09-active-filter-pills");
  // Reset
  await page.locator("#filters-open").click();
  await wait(200);
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);

  console.log("\n[10] Event detail modal");
  const firstCard = page.locator(".event-card").first();
  await firstCard.click();
  await wait(350);
  await shot(page, "10-event-modal");
  await page.locator("#m-close").click({ force: true });
  await wait(250);

  console.log("\n[11] By Camp view");
  await page.locator('#mode-tabs .tab[data-mode="camp"]').click();
  await wait(400);
  await shot(page, "11-by-camp");

  console.log("\n[12] Map fullscreen view");
  await page.locator('#mode-tabs .tab[data-mode="map"]').click();
  await wait(700); // map image fetch
  await shot(page, "12-map-fullscreen");

  console.log("\n[13] Map zoomed in (pins should shrink)");
  // Zoom in 3 times
  for (let i = 0; i < 3; i++) {
    await page.locator('.map-view [data-act="in"]').click();
    await wait(180);
  }
  await wait(300);
  await shot(page, "13-map-zoomed-in");

  console.log("\n[14] Map with pins hidden");
  await page.locator('.map-view [data-act="pins"]').click();
  await wait(250);
  await shot(page, "14-map-pins-hidden");

  console.log("\n[15] Map fit-to-screen");
  await page.locator('.map-view [data-act="pins"]').click(); // re-show pins
  await wait(100);
  await page.locator('.map-view [data-act="fit"]').click();
  await wait(250);
  await shot(page, "15-map-fit");

  console.log("\n[16] Back to schedule from fullscreen map");
  await page.locator("#map-back").click();
  await wait(400);
  await shot(page, "16-back-to-schedule");

  console.log("\n[17] About modal");
  await page.locator("#about-open").click();
  await wait(300);
  await shot(page, "17-about-modal");
  await page.locator("#about-close").click({ force: true });
  await wait(200);

  console.log("\n[18] Header Favorites star toggle (no favorites yet)");
  await page.locator("#fav-toggle").click();
  await wait(300);
  await shot(page, "18-fav-toggle-on-no-favs");
  // Reset
  await page.locator("#fav-toggle").click();
  await wait(200);

  console.log("\n[19] Star an event from a card, then toggle Favorites filter");
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  // Star a couple of cards
  const favBtns = page.locator(".event-card .fav-btn");
  const n = Math.min(3, await favBtns.count());
  for (let i = 0; i < n; i++) {
    await favBtns.nth(i).click();
    await wait(80);
  }
  await wait(150);
  await shot(page, "19-cards-starred");

  console.log("\n[20] Header fav badge + filtered view (favorites only)");
  await page.locator("#fav-toggle").click();
  await wait(400);
  await shot(page, "20-favorites-filter-on");
  await page.locator("#fav-toggle").click();
  await wait(200);

  console.log("\n[21] Multi-select quick filters: Favorites + Up next");
  await page.locator("#filters-open").click();
  await wait(300);
  await page.locator('#quick-chips .chip[data-quick="favorites"]').click({ force: true });
  await wait(100);
  await page.locator('#quick-chips .chip[data-quick="next"]').click({ force: true });
  await wait(200);
  await shot(page, "21-quick-multiselect");
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);

  console.log("\n[22] Filters modal order: Quick → Tags → Neighbourhoods");
  await page.locator("#filters-open").click();
  await wait(300);
  await shot(page, "22-filters-order");
  await page.locator("#filters-close").click({ force: true });
  await wait(200);

  console.log("\n[23] About modal with festival countdown");
  await page.locator("#about-open").click();
  await wait(350);
  await shot(page, "23-about-with-settings");
  await page.locator("#about-close").click({ force: true });
  await wait(200);

  console.log("\n[25] Time-of-day chips in filters modal");
  await page.locator("#filters-open").click();
  await wait(350);
  await shot(page, "25-time-of-day-chips");
  // Activate Evening + Late night
  await page.locator('#time-of-day-chips .chip[data-tod="evening"]').click({ force: true });
  await wait(80);
  await page.locator('#time-of-day-chips .chip[data-tod="late"]').click({ force: true });
  await wait(150);
  await shot(page, "26-tod-active");
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);

  console.log("\n[27] Now line — simulate Friday during the day");
  // Fake getToday so the now-line shows up in the screenshot
  await page.evaluate(() => {
    // Reach into the closure isn't possible — instead, simulate by
    // patching Date for this run. Just set state.day to a known fest day
    // and inject a "now-line" div manually for visual review.
    const view = document.querySelector('#mode-tabs .tab[data-mode="day"]');
    if (view && !view.classList.contains("active")) view.click();
  });
  await wait(150);
  // Tap Friday tab to render that day
  const fri = page.locator('#day-tabs .tab').filter({ hasText: "Friday" });
  if ((await fri.count()) > 0) await fri.click();
  await wait(400);
  await shot(page, "27-by-day-friday");

  console.log("\n[28] Empty-hour quiet-run divider visible");
  // Find the quiet-run element if present and scroll to it
  await page.evaluate(() => {
    const el = document.querySelector(".hour-row.quiet-run");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await wait(400);
  await shot(page, "28-quiet-run-collapsed");

  console.log("\n[29] Out-of-festival empty state via Happening Now");
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await page.locator("#filters-open").click();
  await wait(300);
  await page.locator('#quick-chips .chip[data-quick="now"]').click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(400);
  await shot(page, "29-out-of-festival-empty");
  // Reset
  await page.locator("#filters-open").click();
  await wait(300);
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(300);

  console.log("\n[30] Centered search modal (mobile)");
  await page.locator("#search-open").click();
  await wait(400);
  await shot(page, "30-search-centered");
  await page.locator("#search-close").click({ force: true });
  await wait(200);

  // Full-page screenshot disabled — the page is taller than Chromium's
  // screenshot capture limit (~15,000 px). Use individual scroll-state
  // screenshots above for verification instead.

  await browser.close();
  console.log("\nDone. Screenshots in", OUT_DIR);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
