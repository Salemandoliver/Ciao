#!/usr/bin/env node
/**
 * Contrast for text that sits on a photograph.
 *
 * `theme-audit.mjs` walks every text node and composites the alpha stack to
 * find the background colour behind it. That is exactly right for a page made
 * of surfaces and exactly blind on a hero, because the background there is not
 * a colour — it is a photograph, and it changes every six seconds. The audit
 * has always reported the heroes as clean, and twice in one session it was
 * wrong to:
 *
 *  - the scrim was weighted at the bottom of the box while every headline sat
 *    at the top, so the type ran at about 2.6:1 over the brightest frame of
 *    the rotation while the darkest part of the gradient dimmed a part of the
 *    picture nothing was written on;
 *  - and a later fix that made the photography clearer dropped the About
 *    page's body copy to 2.5:1, which nothing caught either.
 *
 * So this tool screenshots the hero, reads the actual pixels behind each run
 * of type, and measures. It forces each frame of the rotation visible in turn,
 * because "readable on average" is not the promise — it has to hold on the
 * brightest photograph anyone might see.
 *
 * Usage:
 *   BASE=http://localhost:3000 node tools/photo-contrast.mjs [paths…]
 *
 * Text is found by the `data-on-photo` attribute, which the pages already use
 * to mark the containers whose contrast cannot come from a token.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/about"];

/** WCAG AA: 3:1 for large or bold text, 4.5:1 for body. */
const NEED_LARGE = 3;
const NEED_BODY = 4.5;

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const [x, y] = [a, b].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/** Mean luminance of one rectangle of a raw RGBA screenshot. */
function meanLuminance(png, rect) {
  const { data, width, height } = png;
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width, Math.round(rect.x + rect.width));
  const y1 = Math.min(height, Math.round(rect.y + rect.height));
  let total = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      total += lum(data[i], data[i + 1], data[i + 2]);
      n++;
    }
  }
  return n ? total / n : 0;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

let findings = 0;

for (const path of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const frames = await page.evaluate(() => {
    const box = document.querySelector("[data-on-photo]")?.closest("section");
    return box ? box.querySelectorAll("img").length : 0;
  });
  if (frames === 0) {
    console.log(`### ${path} — no photo-backed text found`);
    continue;
  }

  /* Every run of type on the photograph, with the threshold it must meet. */
  const runs = await page.evaluate(() => {
    const box = document.querySelector("[data-on-photo]").closest("section");
    const s = box.getBoundingClientRect();
    const out = [];
    for (const holder of box.querySelectorAll("[data-on-photo]")) {
      for (const el of holder.querySelectorAll("h1, h2, h3, p, span")) {
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(" ");
        if (!text) continue;
        /*
         * Skip anything that is not really "type on a photograph".
         *
         * An emoji has no foreground colour worth measuring — it is a picture,
         * and reporting 2.7:1 for a bell glyph is noise that trains people to
         * ignore the tool. And a run sitting inside its own opaque surface —
         * the search pill, a chip, a tab — is not on the photograph at all:
         * its background *is* a colour, which is precisely the case
         * `theme-audit.mjs` already measures correctly.
         */
        if (!/\p{Letter}|\p{Number}/u.test(text)) continue;
        let backed = false;
        for (let n = el; n && n !== holder.parentElement; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const a = bg.match(/rgba?\(([^)]+)\)/);
          if (a) {
            const parts = a[1].split(/[,\s/]+/).filter(Boolean).map(Number);
            if ((parts.length > 3 ? parts[3] : 1) > 0.25) { backed = true; break; }
          }
        }
        if (backed) continue;
        const st = getComputedStyle(el);
        const size = parseFloat(st.fontSize);
        const bold = Number(st.fontWeight) >= 700;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        out.push({
          text: text.slice(0, 42),
          large: size >= 24 || (size >= 18.66 && bold),
          color: st.color,
          rect: { x: r.left - s.left, y: r.top - s.top, width: r.width, height: r.height },
        });
      }
    }
    return { runs: out, box: { x: s.left, y: s.top, width: s.width, height: s.height } };
  });

  for (let frame = 0; frame < frames; frame++) {
    await page.evaluate((idx) => {
      const box = document.querySelector("[data-on-photo]").closest("section");
      box.querySelectorAll("img").forEach((el, j) => {
        el.style.opacity = j === idx ? "1" : "0";
      });
    }, frame);
    await page.waitForTimeout(400);

    const shot = await page.locator("[data-on-photo]").first().evaluate(() => null);
    void shot;
    const buffer = await page
      .locator("[data-on-photo]")
      .first()
      .evaluateHandle(() => null)
      .then(() => page.screenshot({ clip: runs.box }));

    // Decode the PNG without a dependency: Playwright can hand back raw pixels
    // through the page instead, which keeps this tool free of image libraries.
    const png = await page.evaluate(
      async ([b64, w, h]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h);
        return { data: Array.from(d.data), width: d.width, height: d.height };
      },
      [buffer.toString("base64"), Math.round(runs.box.width), Math.round(runs.box.height)],
    );

    for (const run of runs.runs) {
      const bg = meanLuminance(png, run.rect);
      const m = run.color.match(/\d+/g).map(Number);
      const fg = lum(m[0], m[1], m[2]);
      const r = ratio(fg, bg);
      const need = run.large ? NEED_LARGE : NEED_BODY;
      if (r < need) {
        findings++;
        console.log(
          `### ${path} frame ${frame} — ${r.toFixed(2)}:1 (needs ${need}) — "${run.text}"`,
        );
      }
    }
  }
  console.log(`### ${path} — ${frames} frame(s) checked`);
}

console.log(`\nTOTAL text-on-photo findings: ${findings}`);
await browser.close();
process.exit(findings > 0 ? 1 : 0);
