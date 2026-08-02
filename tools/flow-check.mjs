/**
 * Signed-in member journey, end to end, in both languages.
 *
 * Checks the things a unit test cannot: that the greeting names you, that the
 * account screen actually renders signed in, that sign-out is reachable, and
 * that a page load does not silently destroy the session on the way past.
 *
 * Two harness rules learned the hard way here:
 *
 *  - **One session, one context.** Refresh tokens rotate, and OTP requests are
 *    rate-limited to five per ten minutes per IP by design. Minting a session
 *    per page burns the allowance and then reports a clean pass on screens it
 *    rendered logged out.
 *  - **Wait for a signed-in marker, never a fixed timeout.** The dev server
 *    compiles a route on first visit; a screenshot taken on a stopwatch
 *    catches the sign-in form and looks exactly like a bug.
 */
import { chromium } from "playwright";

const API = process.env.API_URL ?? "http://localhost:4000";
const WEB = process.env.BASE ?? "http://localhost:3111";
const phone = `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const NAME = "سالم الزرتي";

async function signIn() {
  const req = await fetch(`${API}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  }).then((r) => r.json());
  if (!req.devCode) {
    throw new Error(
      "could not mint a session: OTP throttled (5 per 10 min per IP) or dev echo off — " +
        "anything reported after that point would be meaningless.",
    );
  }
  const ver = await fetch(`${API}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: req.devCode, displayName: NAME }),
  }).then((r) => r.json());
  if (!ver.refreshToken) throw new Error(`verify returned no session: ${JSON.stringify(ver)}`);
  return ver;
}

const session = await signIn();
console.log(`signed in as ${session.user.displayName} (${phone})`);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 420, height: 1100 } });
/*
 * Seed the session only if there isn't one. `addInitScript` runs on *every*
 * document in the context, not just the first — so an unconditional write
 * restores the original token on each navigation, and since refresh tokens
 * rotate, that token is revoked the moment the first page uses it. The result
 * looks precisely like the app logging you out between pages, which cost an
 * hour of chasing a bug that was in the test.
 */
await ctx.addInitScript(`try{
  if (!localStorage.getItem('ciao_refresh')) {
    localStorage.setItem('ciao_refresh', ${JSON.stringify(session.refreshToken)});
  }
  localStorage.setItem('ciao_name', ${JSON.stringify(session.user.displayName)});
}catch(e){}`);
const page = await ctx.newPage();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Poll for a marker rather than trusting a timeout. */
async function waitForText(pattern, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page.evaluate(() => document.body.innerText);
    if (pattern.test(text)) return text;
    await page.waitForTimeout(400);
  }
  return null;
}

const CASES = [
  {
    locale: "ar",
    prefix: "",
    greeting: /صباح الخير|مساء الخير/,
    account: /نقاطي|المحفظة|الإعدادات/,
    signOut: /خروج/,
  },
  {
    locale: "en",
    prefix: "/en",
    greeting: /Good (morning|afternoon|evening)/,
    account: /points|Wallet|Settings/i,
    signOut: /Sign out/i,
  },
];

for (const c of CASES) {
  console.log(`\n${c.locale}:`);
  await page.goto(`${WEB}${c.prefix}/`, { waitUntil: "networkidle" });
  const home = await waitForText(c.greeting);
  check("home greets the member by name", Boolean(home && home.includes(NAME)));

  await page.goto(`${WEB}${c.prefix}/account`, { waitUntil: "networkidle" });
  const account = await waitForText(c.account);
  check("account renders signed in", Boolean(account));
  check("sign out is reachable", Boolean(account && c.signOut.test(account)));

  const stillIn = await page.evaluate(() => Boolean(localStorage.getItem("ciao_refresh")));
  check("session survived the page loads", stillIn);

  await page.screenshot({ path: `/tmp/shots/flow_${c.locale}_account.png`, fullPage: true });
}

await browser.close();
console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
