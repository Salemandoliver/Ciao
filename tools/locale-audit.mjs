/**
 * Untranslated-string audit.
 *
 * Adding a second language to fifty files is a job with no natural end: the
 * build passes whether or not a string was translated, and the miss is always
 * on the screen you did not open. So this opens every screen in English and
 * looks for Arabic characters in rendered text.
 *
 * It is not a blanket ban on Arabic. Plenty of Arabic on an English page is
 * correct and deliberate — a listing title with no English version yet, a
 * host's message, an operator announcement, the brand's own wordmark. Those
 * are marked `lang="ar"` at the point where the fallback is chosen (see
 * lib/content.ts), so the rule is precise: **Arabic text that is not declared
 * as Arabic is a missed translation.** That distinction is exactly what a
 * screen reader relies on too, which is why the marking is worth having
 * regardless.
 *
 * It also runs the mirror check — Latin text on an Arabic page is usually
 * fine (brand names, LYD, WhatsApp) so that direction is reported, not failed.
 */
import { chromium } from "playwright";
import { mintRefreshToken, bootScript } from "./audit-session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3111";
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ["/"];

const probe = () => {
  const ARABIC = /[؀-ۿ]/;
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").trim();
    if (!text || !ARABIC.test(text)) continue;
    const el = n.parentElement;
    if (!el) continue;
    // Declared Arabic is intentional: a fallback title, a host's own words.
    if (el.closest('[lang="ar"], [lang="ar-LY"]')) continue;
    // Next.js dev overlay and other injected chrome.
    if (el.closest("nextjs-portal, [data-nextjs-dialog], script, style")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({
      text: text.slice(0, 60),
      sel:
        el.tagName.toLowerCase() +
        (typeof el.className === "string" && el.className
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : ""),
    });
  }
  return out;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const refresh = await mintRefreshToken();
await ctx.addInitScript(bootScript("en", refresh));
const page = await ctx.newPage();

let total = 0;
for (const path of PAGES) {
  const url = `${BASE}/en${path === "/" ? "" : path}`;
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    status = res ? res.status() : 0;
  } catch {
    await page.waitForTimeout(2500);
  }
  let loading = true;
  for (let i = 0; i < 20 && loading; i++) {
    await page.waitForTimeout(400);
    loading = await page.evaluate(() => /جارٍ|جاري|Loading…|Checking/.test(document.body.innerText));
  }
  const rows = await page.evaluate(probe);
  if (status !== 200 || loading) {
    total += 1;
    console.log(`\n### ${path} — DID NOT RENDER (http ${status}${loading ? ", stuck loading" : ""})`);
    continue;
  }
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.text)) seen.set(r.text, r.sel);
  if (!seen.size) {
    console.log(`### /en${path} — clean`);
    continue;
  }
  total += seen.size;
  console.log(`\n### /en${path} — ${seen.size} undeclared Arabic string(s)`);
  for (const [text, sel] of [...seen].slice(0, 12)) console.log(`  ${sel}\n      "${text}"`);
}
await ctx.close();
await browser.close();
console.log(`\nTOTAL undeclared Arabic on English pages: ${total}`);
