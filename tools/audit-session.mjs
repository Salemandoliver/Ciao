/**
 * Mints a signed-in session for the theme tools.
 *
 * Shared because both the audit and the screenshot runner need it and both
 * were getting it subtly wrong: a refresh token rotates the first time the app
 * uses it, so a token cannot be shared across browser contexts, and OTP
 * requests are limited to five per ten minutes per IP — which is a real
 * defence, not a nuisance to route around. Hence: one token per context, and
 * an error that says which of the two things actually went wrong instead of
 * blaming dev echo for a throttle.
 */
const API = process.env.API_URL ?? "http://localhost:4000";

export const auditPhone = process.env.CIAO_PHONE ?? "";

export async function mintRefreshToken() {
  if (!auditPhone) return "";
  const res = await fetch(`${API}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: auditPhone }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) {
    throw new Error(
      "OTP throttled (5 per 10 minutes per IP). Wait for the window to clear, " +
        "or run the logged-out pages without CIAO_PHONE.",
    );
  }
  if (!res.ok) throw new Error(`OTP request failed: ${res.status} ${JSON.stringify(body)}`);
  if (!body.devCode) {
    throw new Error("OTP_DEV_ECHO is off on this API — cannot mint a session for the audit.");
  }
  const ver = await fetch(`${API}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: auditPhone, code: body.devCode }),
  }).then((r) => r.json());
  if (!ver.refreshToken) throw new Error(`OTP verify failed: ${JSON.stringify(ver)}`);
  return ver.refreshToken;
}

/** The init script every context needs: theme first, session second. */
export function bootScript(theme, refresh) {
  return `try{
    localStorage.setItem('ciao_theme', ${JSON.stringify(theme)});
    var rt = ${JSON.stringify(refresh ?? "")};
    if (rt && !localStorage.getItem('ciao_refresh')) localStorage.setItem('ciao_refresh', rt);
  }catch(e){}`;
}
