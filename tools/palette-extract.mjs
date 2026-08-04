import { chromium } from "playwright";
const BASE = "https://18b74d7e-61af-4d51-a0d1-dfbab935cd39-00-3s28gr9a28ro0.janeway.replit.dev/__mockup/preview/ciaoweb-variants";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
for (const variant of ["SaharanLight", "Saharan"]) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 1000 } });
  const p = await ctx.newPage();
  try {
    await p.goto(`${BASE}/${variant}`, { waitUntil: "networkidle", timeout: 60000 });
  } catch (e) { console.log(variant, "goto:", e.message.slice(0, 80)); }
  await p.waitForTimeout(4000);
  const info = await p.evaluate(() => {
    const out = { vars: {}, sample: [], bodyBg: getComputedStyle(document.body).backgroundColor };
    // every custom property declared anywhere
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules || []) {
        if (!r.style) continue;
        for (const prop of r.style) {
          if (prop.startsWith("--")) out.vars[`${r.selectorText} ${prop}`] = r.style.getPropertyValue(prop).trim();
        }
      }
    }
    // computed colours of the first 40 visible elements with text
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      const key = `${cs.color}|${cs.backgroundColor}`;
      if (seen.has(key) || seen.size > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      seen.add(key);
      out.sample.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), color: cs.color, bg: cs.backgroundColor, border: cs.borderColor });
    }
    return out;
  });
  console.log(`\n===== ${variant} =====`);
  console.log("body bg:", info.bodyBg);
  console.log("custom properties:");
  for (const [k, v] of Object.entries(info.vars)) console.log("  ", k, "=", v);
  console.log("computed samples:");
  for (const s of info.sample) console.log("  ", JSON.stringify(s));
  await p.screenshot({ path: `/tmp/shots/mock_${variant}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
