// One-shot review harness for the native <dialog> modal migration.
// Captures every modal state on both iPhone 15 (393x852) and a
// desktop viewport (1280x800), so we can eyeball padding / margin /
// keyboard-inset issues side-by-side.
//
// Usage:
//   1. dev server at http://localhost:8000 (python3 -m http.server 8000)
//   2. node scripts/dialog-review.js

const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = process.env.OW_URL || "http://localhost:8000/";
const OUT_DIR = path.join(__dirname, "..", "screenshots", "dialog-review");

const MOBILE = {
  ...devices["iPhone 15"],
  viewport: { width: 393, height: 852 },
  screen: { width: 393, height: 852 },
};
const DESKTOP = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page, label, name) {
  const p = path.join(OUT_DIR, `${label}-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log("  →", path.relative(process.cwd(), p));
}

async function captureFlow(page, label) {
  console.log(`\n=== ${label.toUpperCase()} ===`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await wait(500);

  // [1] Baseline — should NOT show any modal in flow
  await shot(page, label, "01-baseline");

  // [2] Event modal — tap first event card
  const firstCard = page.locator(".event-card").first();
  await firstCard.click();
  await wait(400);
  await shot(page, label, "02-event-modal");
  await page.locator("#m-close").click({ force: true });
  await wait(250);

  // [3] Search modal
  await page.locator("#search-open").click();
  await wait(400);
  await shot(page, label, "03-search-empty");

  // [4] Search typed
  await page.locator("#search").fill("music");
  await wait(250);
  await shot(page, label, "04-search-typed");
  await page.locator("#search-clear").click({ force: true });
  await wait(100);
  await page.locator("#search-done").click({ force: true });
  await wait(250);

  // [5] Filters modal
  await page.locator("#filters-open").click();
  await wait(400);
  await shot(page, label, "05-filters-empty");

  // [6] Filters with selections
  await page.locator('#quick-chips .chip[data-quick="now"]').click({ force: true });
  await wait(80);
  const tagChips = page.locator("#tag-chips .chip");
  if ((await tagChips.count()) >= 2) {
    await tagChips.nth(0).click({ force: true });
    await wait(50);
    await tagChips.nth(1).click({ force: true });
  }
  await wait(200);
  await shot(page, label, "06-filters-active");

  // [7] Filters scrolled
  await page.locator(".filters-modal .sheet-body").evaluate(el => el.scrollTo(0, 400));
  await wait(200);
  await shot(page, label, "07-filters-scrolled");
  await page.locator("#filters-clear").click({ force: true });
  await wait(100);
  await page.locator("#filters-done").click({ force: true });
  await wait(250);

  // [8] Settings modal
  await page.locator("#settings-open").click();
  await wait(400);
  await shot(page, label, "08-settings");

  // [9] Settings scrolled to bottom (about + dev tools)
  await page.locator(".settings-modal .sheet-body").evaluate(el => el.scrollTo(0, 9999));
  await wait(200);
  await shot(page, label, "09-settings-scrolled");
  await page.locator(".settings-modal .sheet-body").evaluate(el => el.scrollTo(0, 0));
  await wait(150);

  // [10] Backup modal — needs at least one favorite first.
  // Open Settings → close settings → star one event → reopen settings → backup.
  await page.locator("#settings-close").click({ force: true });
  await wait(250);
  await page.locator(".event-card .fav-btn").first().click({ force: true });
  await wait(200);
  await page.locator("#settings-open").click();
  await wait(400);
  await page.locator("#fav-backup").click({ force: true });
  await wait(400);
  await shot(page, label, "10-backup-over-settings");
  await page.locator("#backup-modal-close").click({ force: true });
  await wait(250);

  // [11] After closing backup — settings should still be there
  await shot(page, label, "11-settings-after-backup-closed");
  await page.locator("#settings-close").click({ force: true });
  await wait(250);

  // Camp modal shares the same .modal rules as event modal — any
  // padding/margin issue would already be visible on 02-event-modal.
  // Skipping the brittle map-pin click in headless.
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  const mobileCtx = await browser.newContext({ ...MOBILE });
  const mobilePage = await mobileCtx.newPage();
  mobilePage.on("pageerror", e => console.error("[mobile pageerror]", e.message));
  await captureFlow(mobilePage, "mobile");
  await mobileCtx.close();

  const desktopCtx = await browser.newContext({ ...DESKTOP });
  const desktopPage = await desktopCtx.newPage();
  desktopPage.on("pageerror", e => console.error("[desktop pageerror]", e.message));
  await captureFlow(desktopPage, "desktop");
  await desktopCtx.close();

  await browser.close();
  console.log("\nDone. Screenshots in", OUT_DIR);
}

run().catch(err => { console.error(err); process.exit(1); });
