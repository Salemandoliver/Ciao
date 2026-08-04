import { chromium } from "playwright";
import { mintRefreshToken, bootScript } from "./audit-session.mjs";
const BASE = process.env.BASE ?? "http://localhost:3111";
const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/", "/search?type=coast", "/about", "/rewards", "/account", "/biz"];
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});

for (const theme of ["light", "dark"]) {
  // One context per theme — refresh tokens rotate, OTP requests are limited.
  const ctx = await browser.newContext({ viewport: { width: 420, height: 1000 } });
  const refresh = await mintRefreshToken();
  await ctx.addInitScript(bootScript(theme, refresh));
  const page = await ctx.newPage();
  for (const path of PAGES) {
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(1200);
    /*
     * Scroll the whole page before shooting it.
     *
     * `fullPage: true` renders the full height but does NOT trigger lazy
     * loading for what was never in the viewport, and the card carousel
     * deliberately withholds `src` until a card is approached. Without this
     * pass the bottom two-thirds of a long page photographs as empty frames —
     * which reads exactly like broken images, and buried a real regression
     * once behind a shrug about the tool.
     */
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 220));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
    });
    // Give the images the scroll just requested a chance to decode.
    await page.waitForTimeout(1500);
    const name = path.replace(/[^a-z]/gi, "_") || "home";
    await page.screenshot({ path: `/tmp/shots/${theme}${name}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log("done");
