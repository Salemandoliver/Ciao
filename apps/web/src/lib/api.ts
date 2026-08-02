/** API client — token storage in memory + localStorage refresh. */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let accessToken: string | null = null;

/**
 * The language the API should answer in.
 *
 * The error catalogue is bilingual server-side, so this is what decides
 * whether a failed booking says "هذه التواريخ لم تعد متاحة" or "These dates
 * are no longer available". Without it an English user gets an English
 * interface that reports its errors in Arabic — which is exactly the moment
 * they most need to understand what happened.
 */
let apiLocale = "ar";
export function setApiLocale(locale: string) {
  apiLocale = locale;
}
export function apiAcceptLanguage(): string {
  return apiLocale === "en" ? "en-GB,en;q=0.9" : "ar-LY,ar;q=0.9";
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (typeof window !== "undefined" && refresh) {
    localStorage.setItem("ciao_refresh", refresh);
  }
}

export function clearTokens() {
  accessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("ciao_refresh");
    localStorage.removeItem(NAME_KEY);
  }
}

/**
 * The member's display name, kept beside the refresh token.
 *
 * The greeting on the home page has to be right on the first paint or not
 * appear at all — a name that arrives a second late is a layout shift, and a
 * wrong name is worse than none. Both sign-in paths already hand back
 * `user.displayName`, so we keep it rather than spending a request on it.
 *
 * A phone number is never a name. Older accounts were created with the number
 * in that column, and «صباح الخير، 0912345678» is both cold and a small
 * privacy leak on a shared phone, so anything that looks like a number is
 * dropped and the greeting falls back to its nameless form.
 */
const NAME_KEY = "ciao_name";

function looksLikePhone(value: string): boolean {
  return /^[+\d\s()٠-٩-]+$/.test(value);
}

export function rememberDisplayName(name: string | null | undefined) {
  if (typeof window === "undefined") return;
  const clean = name?.trim();
  if (!clean || looksLikePhone(clean)) {
    localStorage.removeItem(NAME_KEY);
    return;
  }
  try {
    localStorage.setItem(NAME_KEY, clean.slice(0, 80));
  } catch {
    /* private mode — the greeting falls back to fetching it */
  }
}

export function storedDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(NAME_KEY)?.trim();
    return value && !looksLikePhone(value) ? value : null;
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  return Boolean(
    accessToken ??
      (typeof window !== "undefined" && localStorage.getItem("ciao_refresh")),
  );
}

/**
 * The role claim from the current access token, for shaping the UI only.
 * Never a security boundary — every privileged endpoint re-checks server-side,
 * so a forged token buys a differently-shaped screen and nothing else.
 */
export function sessionRole(): string {
  return sessionClaims().role ?? "";
}

/** Decoded access-token claims, for shaping the UI only (see sessionRole). */
export function sessionClaims(): { role?: string; phone?: string; sub?: string } {
  if (!accessToken) return {};
  try {
    const part = accessToken.split(".")[1];
    if (!part) return {};
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

/**
 * The in-flight refresh, shared by every caller that wants one.
 *
 * Refresh tokens rotate: presenting one revokes it and issues a replacement.
 * That is the right security design and it means a *second* concurrent refresh
 * is guaranteed to fail, because it is presenting a token the first one just
 * revoked — and the failure path signs the member out.
 *
 * Which is exactly what was happening. Loading the home page while signed in
 * fires `/v1/me` and `/v1/wishlist/ids` together; both 401 on an expired
 * access token, both call this, the first rotates, the second is rejected as a
 * replayed token, and the member's session is wiped. To them the app "keeps
 * logging me out" at random — the kind of fault that is maddening to live with
 * and nearly impossible to report usefully.
 *
 * One flight, shared. Everyone waiting gets the same answer.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(refresh: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
  } catch {
    /*
     * The network failed, not the token. Signing someone out because a request
     * timed out would be its own bug on a connection that drops several times
     * an hour — they keep their session and the next call tries again.
     */
    return false;
  }
  if (!res.ok) {
    // The server refused the token: it is expired, revoked, or not ours. That
    // is a real end of session and the only case that should clear it.
    clearTokens();
    return false;
  }
  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

async function refreshSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (refreshInFlight) return refreshInFlight;
  const refresh = localStorage.getItem("ciao_refresh");
  if (!refresh) return false;
  const flight = performRefresh(refresh);
  refreshInFlight = flight;
  try {
    return await flight;
  } finally {
    // Cleared only if we are still the current flight, so a refresh that
    // started while this one was settling is not orphaned.
    if (refreshInFlight === flight) refreshInFlight = null;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /**
     * The rest of the error envelope, verbatim.
     *
     * Some refusals are written to explain themselves — the under-18 birth
     * date, for one — and carry an English twin in `messageEn` plus the field
     * and problem they refer to. `message` alone would strand an English
     * reader with the Arabic, so the whole object travels and the caller
     * picks the sentence its reader can read.
     */
    public detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { retry?: boolean } = {},
): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": apiAcceptLanguage(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(typeof window !== "undefined" && localStorage.getItem("ciao_anon")
          ? { "x-ciao-anon": localStorage.getItem("ciao_anon")! }
          : {}),
        ...(opts.headers ?? {}),
      },
    });

  let res = await doFetch();
  if (res.status === 401 && opts.retry !== false && (await refreshSession())) {
    res = await doFetch();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string } & Record<string, unknown>;
    };
    throw new ApiError(
      res.status,
      body.error?.code ?? "CIAO-5000",
      body.error?.message ?? (apiLocale === "en" ? "Something went wrong" : "حدث خطأ"),
      body.error ?? {},
    );
  }
  return res.json() as Promise<T>;
}

/** Ensure a live access token (call on app mount for signed-in flows). */
export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

/**
 * Money.
 *
 * The currency is the Libyan dinar in both languages — an English-reading user
 * booking a chalet in Janzour still pays in dinars, and converting to anything
 * else would be a guess about a rate we do not set. Only the numerals and the
 * symbol change: `1٬250 د.ل` reading right-to-left, `1,250 LYD` reading
 * left-to-right.
 *
 * Note the explicit `latn` numbering system for Arabic. `ar-LY` defaults to
 * Western digits in most runtimes but not all, and a price that renders as
 * ١٢٥٠ on one phone and 1250 on another makes a marketplace look unreliable in
 * the one place it can least afford to.
 */
export function fmtLyd(dirhams: number, locale: string = "ar"): string {
  const value = (dirhams / 1000).toLocaleString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", {
    maximumFractionDigits: 0,
  });
  return locale === "en" ? `${value} LYD` : `${value} د.ل`;
}

/**
 * Money that can legitimately be a fraction of a dinar — a loyalty balance
 * part-way to its first dinar, say. fmtLyd rounds to whole dinars, which is
 * right for prices and wrong here: telling someone their 400 points are worth
 * "0 د.ل" is worse than not showing a number at all.
 */
export function fmtLydPrecise(dirhams: number, locale: string = "ar"): string {
  const lyd = dirhams / 1000;
  const digits = lyd > 0 && lyd < 10 ? 2 : 0;
  const value = lyd.toLocaleString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", {
    maximumFractionDigits: digits,
  });
  return locale === "en" ? `${value} LYD` : `${value} د.ل`;
}
