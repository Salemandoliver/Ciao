/**
 * A signed-in partner session for the audit tools.
 *
 * The marketplace's `audit-session.mjs` mints a guest session with an OTP; the
 * partner app signs in with a password and gets a token in a different
 * audience, so it needs its own. Kept beside it rather than folded into it,
 * because a helper that silently returns the wrong kind of session would send
 * an auditor round a login loop wondering what it had misconfigured.
 */
const API = process.env.API_URL ?? "http://localhost:4000";
export const partnerPhone = process.env.PARTNER_PHONE ?? "";
export const partnerPassword = process.env.PARTNER_PASSWORD ?? "";

export async function mintPartnerRefresh() {
  if (!partnerPhone || !partnerPassword) return "";
  const res = await fetch(`${API}/v1/partner/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: partnerPhone, password: partnerPassword }),
  });
  if (res.status === 429) {
    throw new Error("Partner login is throttled (10 per 10 minutes per IP). Wait, or restart the API.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refreshToken) {
    throw new Error(`Partner login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.refreshToken;
}

/** Theme first, session second — same contract as the marketplace helper. */
export function partnerBootScript(theme, refresh) {
  return `try{
    localStorage.setItem('ciao_theme', ${JSON.stringify(theme)});
    ${refresh ? `localStorage.setItem('ciao_partner_refresh', ${JSON.stringify(refresh)});` : ""}
    if (${theme === "dark"}) document.documentElement.classList.add('dark');
  }catch(e){}`;
}
