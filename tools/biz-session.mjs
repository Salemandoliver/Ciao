/**
 * A signed-in business-console session for the audit tools.
 *
 * Third product, third helper, same reasoning as `partner-session.mjs`: the
 * console signs in with a password and gets a token in the `biz` audience, and
 * a helper that silently returned the wrong kind of session would send an
 * auditor round a login loop wondering what it had misconfigured.
 *
 * Set BIZ_PHONE and BIZ_PASSWORD to point the audits at the console app.
 */
const API = process.env.API_URL ?? "http://localhost:4000";
export const bizPhone = process.env.BIZ_PHONE ?? "";
export const bizPassword = process.env.BIZ_PASSWORD ?? "";

export async function mintBizRefresh() {
  if (!bizPhone || !bizPassword) return "";
  const res = await fetch(`${API}/v1/biz/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: bizPhone, password: bizPassword }),
  });
  if (res.status === 429) {
    throw new Error("Console login is throttled (10 per 10 minutes per IP). Wait, or restart the API.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refreshToken) {
    throw new Error(`Console login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.refreshToken;
}

/** Theme first, session second — same contract as the other helpers. */
export function bizBootScript(theme, refresh) {
  return `try{
    localStorage.setItem('ciao_theme', ${JSON.stringify(theme)});
    ${refresh ? `localStorage.setItem('ciao_biz_refresh', ${JSON.stringify(refresh)});` : ""}
    if (${theme === "dark"}) document.documentElement.classList.add('dark');
  }catch(e){}`;
}
