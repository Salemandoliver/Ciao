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
    const name = path.replace(/[^a-z]/gi, "_") || "home";
    await page.screenshot({ path: `/tmp/shots/${theme}${name}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log("done");
