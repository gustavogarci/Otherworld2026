const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on("console", m => logs.push(`[console] ${m.text()}`));
  page.on("pageerror", e => logs.push(`[pageerror] ${e.message}`));
  await page.goto("http://127.0.0.1:8123/?v=" + Date.now(), { waitUntil: "networkidle" });

  // Ensure we're on the By Day view and wait for cards.
  await page.waitForSelector(".event-card", { timeout: 10000 }).catch(() => {});

  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".event-card")];
    const byKey = {};
    for (const c of cards) {
      const k = c.dataset.favKey;
      (byKey[k] = byKey[k] || []).push(c);
    }
    const dupKey = Object.keys(byKey).find(k => byKey[k].length > 1);
    return {
      totalCards: cards.length,
      hasFavKeyAttr: cards.length ? cards[0].hasAttribute("data-fav-key") : null,
      sampleKey: cards.length ? cards[0].dataset.favKey : null,
      dupKey,
      dupCount: dupKey ? byKey[dupKey].length : 0,
    };
  });
  console.log("PAGE INFO:", JSON.stringify(info, null, 2));

  if (info.dupKey) {
    const result = await page.evaluate((dupKey) => {
      const cards = [...document.querySelectorAll(".event-card")].filter(c => c.dataset.favKey === dupKey);
      const before = cards.map(c => c.querySelector(".fav-btn").classList.contains("is-fav"));
      // Click the first card's star
      cards[0].querySelector(".fav-btn").click();
      const after = cards.map(c => c.querySelector(".fav-btn").classList.contains("is-fav"));
      return { before, after, cardCount: cards.length };
    }, info.dupKey);
    console.log("TOGGLE RESULT:", JSON.stringify(result, null, 2));
    const allSame = result.after.every(v => v === result.after[0]);
    console.log("ALL SIBLINGS SYNCED:", allSame);
  } else {
    console.log("NO DUPLICATE-KEY EVENT FOUND IN CURRENT VIEW");
  }

  console.log("LOGS:\n" + logs.join("\n"));
  await browser.close();
})();
