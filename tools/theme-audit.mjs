/**
 * Dark-theme contrast audit.
 *
 * Eyeballing screenshots is how the first two attempts at this shipped
 * unreadable text: pale-on-white is obvious in a screenshot only if you happen
 * to scroll to it. This walks every rendered text node and every panel, works
 * out the *effective* background by climbing until it finds an opaque one, and
 * reports anything under the WCAG AA ratio for its size. Both themes, so a fix
 * for dark that breaks light gets caught in the same run.
 */
import { chromium } from "playwright";
import { mintRefreshToken, bootScript } from "./audit-session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3111";
const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/", "/search?type=coast", "/about", "/rewards", "/account", "/biz"];

function srgb(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lum([r, g, b]) {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const probe = () => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
  };
  const out = [];
  const els = document.querySelectorAll("body *");
  for (const el of els) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    /*
     * Text sitting on a photograph has no computable background — the pixels
     * behind it are a JPEG. Those subtrees are marked `data-on-photo` in the
     * markup and their legibility is guaranteed by a fixed scrim
     * (`.photo-scrim-*`, which deliberately does not follow the theme) rather
     * than by a token. Counting them here would bury the real findings under
     * permanent 1.00:1 noise.
     */
    if (el.closest("[data-on-photo]")) continue;
    // Effective background: climb until something is opaque enough to matter.
    let bg = [255, 255, 255];
    let node = el;
    const stack = [];
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0.01) stack.push(c);
      if (c && c[3] > 0.99) break;
      node = node.parentElement;
    }
    if (!node || node === document.documentElement) {
      const c = parse(getComputedStyle(document.documentElement).backgroundColor);
      bg = c && c[3] > 0.01 ? [c[0], c[1], c[2]] : [255, 255, 255];
    } else {
      const base = stack.pop();
      bg = [base[0], base[1], base[2]];
    }
    while (stack.length) bg = over(stack.pop(), bg);
    const fg = parse(cs.color);
    if (!fg) continue;
    const composed = over(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      text: text.slice(0, 48),
      sel:
        el.tagName.toLowerCase() +
        (el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".")
          : ""),
      fg: composed,
      bg,
      size,
      large,
    });
  }
  return out;
};

/**
 * Signed-in audit.
 *
 * The business console, the account tabs and the ops screens are behind a
 * login, and they are exactly where the risky colour lives — status tints,
 * ledger warnings, tab bars. Auditing only the logged-out shell would have
 * declared the theme done while the console was still unreadable.
 *
 * A refresh token rotates on first use, so each browser context gets a fresh
 * one rather than sharing (and invalidating) a single token.
 */

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
let failures = 0;
for (const theme of ["light", "dark"]) {
  /*
   * One context per theme, not per page: OTP requests are rate-limited (5 per
   * 10 minutes per IP, by design) and a refresh token rotates on use, so a
   * per-page login both trips the limiter and invalidates itself. Sharing the
   * context lets the app rotate its own token in place, the way a real session
   * does.
   */
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const refresh = await mintRefreshToken();
  await ctx.addInitScript(bootScript(theme, refresh));
  const page = await ctx.newPage();
  for (const path of PAGES) {
    /*
     * A page that 500s renders no text, so every "walk the text nodes" check
     * passes and the audit reports a clean run. That happened once already —
     * a CSS build error made all eleven pages green. Status and a floor on
     * rendered elements are now part of the assertion, not a precondition
     * anyone remembers to check.
     */
    let status = 0;
    try {
      const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
      status = res ? res.status() : 0;
    } catch {
      await page.waitForTimeout(2500);
    }
    /*
     * Settle before measuring. A client-rendered screen behind a permission
     * check renders "جارٍ التحقق…" first; a CORS failure leaves it there
     * forever. Measuring that state finds no low-contrast text and reports
     * clean — which is how a completely blank business console passed this
     * audit once already.
     */
    let stillLoading = true;
    for (let i = 0; i < 20 && stillLoading; i++) {
      await page.waitForTimeout(400);
      stillLoading = await page.evaluate(() => /جارٍ|جاري|Loading…/.test(document.body.innerText));
    }
    const rows = await page.evaluate(probe);
    if (status !== 200 || rows.length === 0 || stillLoading) {
      failures += 1;
      console.log(
        `\n### ${theme} ${path} — DID NOT RENDER (http ${status}, ${rows.length} text nodes` +
          `${stillLoading ? ", stuck loading" : ""})`,
      );
      continue;
    }
    /*
     * Broken images.
     *
     * Added after a middleware matcher that listed known asset prefixes missed
     * `/hero-marina-800.webp`, so every hero photograph on the site was
     * rewritten to `/ar/hero-…` and 404'd. The contrast audit sailed straight
     * past it: text was still perfectly legible on an empty gradient. On a
     * marketplace whose entire claim is "we went there and took these photos
     * ourselves", missing photography is not a cosmetic defect.
     */
    const broken = await page.evaluate(() => {
      const all = [...document.querySelectorAll("img")].filter(
        (i) => i.currentSrc && i.complete && i.naturalWidth === 0,
      );
      const ours = (src) => new URL(src, location.href).origin === location.origin;
      return {
        ours: all.filter((i) => ours(i.currentSrc)).map((i) => i.currentSrc).slice(0, 6),
        thirdParty: all.filter((i) => !ours(i.currentSrc)).map((i) => i.currentSrc).slice(0, 3),
      };
    });
    if (broken.ours.length) {
      failures += broken.ours.length;
      console.log(`\n### ${theme} ${path} — ${broken.ours.length} broken image(s)`);
      for (const src of broken.ours) console.log(`  ✗ ${src}`);
    }
    if (broken.thirdParty.length) {
      /*
       * Reported, never failed. A map tile that did not arrive is the sandbox
       * (or Libya) having a bad minute with someone else's CDN, and a check
       * that goes red for that gets ignored within a week — at which point it
       * stops catching the thing it was built for, which was our own assets
       * 404ing behind a routing change.
       */
      console.log(`  · ${broken.thirdParty.length} third-party image(s) did not load (not failed)`);
      for (const src of broken.thirdParty) console.log(`      ${src}`);
    }

    const bad = [];
    const seen = new Set();
    for (const r of rows) {
      const need = r.large ? 3 : 4.5;
      const got = ratio(r.fg, r.bg);
      if (got >= need) continue;
      const key = r.sel + "|" + Math.round(got * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      bad.push({ ...r, got: got.toFixed(2), need });
    }
    if (bad.length) {
      failures += bad.length;
      console.log(`\n### ${theme} ${path} — ${bad.length} low-contrast`);
      for (const b of bad.slice(0, 14))
        console.log(
          `  ${b.got}:1 (need ${b.need})  ${b.sel}\n      fg rgb(${b.fg}) on rgb(${b.bg})  "${b.text}"`,
        );
    } else {
      console.log(`### ${theme} ${path} — clean`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\nTOTAL low-contrast findings: ${failures}`);
