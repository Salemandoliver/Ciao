/**
 * The card photo carousel, checked in a browser in both directions.
 *
 * Every assertion here is a bug this component could plausibly ship with:
 * an arrow that navigates to the property instead of advancing the photo, an
 * arrow that points the wrong way in Arabic, a carousel that downloads every
 * photo of every card on a page load, or a page that jumps vertically when you
 * press "next".
 */
import { chromium } from "playwright";

const WEB = process.env.BASE ?? "http://localhost:3111";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

for (const [locale, prefix, dir] of [["ar", "", "rtl"], ["en", "/en", "ltr"]]) {
  console.log(`\n${locale} (${dir}):`);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();

  // Count image requests before any interaction: photo 2+ must not be fetched.
  const imageRequests = new Set();
  page.on("request", (r) => {
    if (r.resourceType() === "image") imageRequests.add(new URL(r.url()).pathname);
  });

  await page.goto(`${WEB}${prefix}/search?type=coast`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const cards = await page.locator('[aria-roledescription="carousel"]').count();
  check("cards render a carousel", cards > 0, `${cards} card(s)`);

  const beforeCount = imageRequests.size;
  const secondPhotos = [...imageRequests].filter((p) => /\/2[-.]/.test(p)).length;
  check("second photos are not downloaded before anyone looks", secondPhotos === 0,
    `${beforeCount} image request(s) so far`);

  const nextLabel = locale === "ar" ? "الصورة التالية" : "Next photo";
  const next = page.locator(`button[aria-label="${nextLabel}"]`).first();
  check("a next-photo arrow exists", (await next.count()) > 0);

  if (await next.count()) {
    // Arrow position: "previous" must sit where "back" belongs in this script.
    const box = await next.boundingBox();
    const card = await page.locator('[aria-roledescription="carousel"]').first().boundingBox();
    const nextIsOnLeft = box.x < card.x + card.width / 2;
    check(
      dir === "rtl" ? "next sits on the left in Arabic" : "next sits on the right in English",
      dir === "rtl" ? nextIsOnLeft : !nextIsOnLeft,
    );

    const urlBefore = page.url();
    /*
     * Playwright scrolls a target into view before clicking it, so the scroll
     * position has to be sampled AFTER that and not before — otherwise this
     * check measures the test harness moving the page and blames the app. It
     * failed that way first time round.
     */
    /*
     * Park the page at the top and click the first card's arrow, which is
     * already on screen there — so Playwright never needs to scroll and this
     * check measures the app, not the harness.
     *
     * The previous version called `scrollIntoViewIfNeeded()` first. The app
     * sets `html { scroll-behavior: smooth }`, so that started an ANIMATED
     * scroll, and sampling "before" caught it at zero while it was still
     * accelerating — the check then attributed 80px of the harness's own
     * scrolling to the button press. Two hours of a real bug hunt for a
     * measurement error.
     */
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
    await page.waitForTimeout(600);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    check("the arrow is on screen without scrolling", await next.isVisible());
    await next.click();
    await page.waitForTimeout(900);

    check("pressing next does not open the property", page.url() === urlBefore, page.url());
    const scrollAfter = await page.evaluate(() => window.scrollY);
    check(
      "pressing next does not scroll the page",
      Math.abs(scrollAfter - scrollBefore) < 5,
      `${scrollBefore} → ${scrollAfter}`,
    );

    const moved = await page.evaluate(() => {
      const strip = document.querySelector('[aria-roledescription="carousel"]');
      return Math.abs(strip.scrollLeft) > 10;
    });
    check("the strip actually advanced", moved);

    const nowLoaded = [...imageRequests].filter((p) => /\/2[-.]/.test(p)).length;
    check("the second photo loads once asked for", nowLoaded > 0, `${nowLoaded} fetched`);

    // And the card is still a working link — from the title AND from a tap
    // on the photograph itself, which is what people actually do.
    await page.locator("h3 a").first().click();
    await page.waitForURL(/\/l\//, { timeout: 30000 }).catch(() => {});
    check("the title link opens the property", /\/l\//.test(page.url()), page.url());

    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.locator('[aria-roledescription="carousel"]').first().click();
    await page.waitForURL(/\/l\//, { timeout: 30000 }).catch(() => {});
    check("tapping the photo opens the property", /\/l\//.test(page.url()), page.url());
  }

  await ctx.close();
}

await browser.close();
console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
