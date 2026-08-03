/**
 * The business console's API client.
 *
 * The third product's front door, shaped like the partner app's and sharing
 * nothing with it at runtime:
 *
 *  - its own storage key, so the three apps never collide even if someone
 *    runs them all on localhost during development;
 *  - its own refresh endpoint, backed by its own table (`biz_sessions`);
 *  - a token minted with the `biz` audience, which the API refuses on every
 *    consumer and partner route and vice versa.
 *
 * The token lives in memory and only the refresh token is persisted, which is
 * the same shape the marketplace uses and for the same reason: an access token
 * in localStorage is an access token any script on the page can read.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const REFRESH_KEY = "ciao_biz_refresh";

let accessToken: string | null = null;

let apiLocale = "ar";
export function setApiLocale(locale: string) {
  apiLocale = locale;
}
function acceptLanguage(): string {
  return apiLocale === "en" ? "en-GB,en;q=0.9" : "ar-LY,ar;q=0.9";
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (typeof window !== "undefined" && refresh) {
    try {
      localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* private mode — the session lasts until the tab closes, which is
         inconvenient rather than broken */
    }
  }
}

export function storedRefresh(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function clearTokens() {
  accessToken = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function hasSession(): boolean {
  return Boolean(accessToken ?? storedRefresh());
}

/**
 * One refresh flight, shared.
 *
 * Partner sessions rotate on use — presenting a refresh token revokes it and
 * issues a replacement — so two concurrent refreshes guarantee that the second
 * presents a token the first has already killed, and the failure path signs
 * the partner out. The console opens several panels at once on every tab, so
 * without this it would log people out at random. Same bug the marketplace hit
 * and fixed; same fix.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(refresh: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/biz/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
  } catch {
    // The network failed, not the token. Signing someone out because a request
    // timed out is its own bug on a connection that drops hourly.
    return false;
  }
  if (!res.ok) {
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
  const refresh = storedRefresh();
  if (!refresh) return false;
  const flight = performRefresh(refresh);
  refreshInFlight = flight;
  try {
    return await flight;
  } finally {
    if (refreshInFlight === flight) refreshInFlight = null;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
        "Accept-Language": acceptLanguage(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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

/** Ensure a live access token. Called on mount by every gated screen. */
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

export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

export async function signOut(): Promise<void> {
  const refresh = storedRefresh();
  // Tell the server first so the session is dead even if the browser keeps a
  // copy of the token in a cache somewhere; then clear locally regardless.
  if (refresh) {
    await fetch(`${API_URL}/v1/biz/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  clearTokens();
}

/**
 * Money.
 *
 * The currency is the Libyan dinar in both languages. Only the numerals and
 * the symbol change: `1٬250 د.ل` reading right-to-left, `1,250 LYD` reading
 * left-to-right. The explicit `latn` numbering system for Arabic is not
 * optional — `ar-LY` defaults to Western digits in most runtimes but not all,
 * and a price that renders as ١٢٥٠ on one phone and 1250 on another makes a
 * business tool look unreliable in the one place it cannot afford to.
 */
export function fmtLyd(dirhams: number, locale: string = "ar"): string {
  const value = (dirhams / 1000).toLocaleString(
    locale === "en" ? "en-GB" : "ar-LY-u-nu-latn",
    { maximumFractionDigits: 0 },
  );
  return locale === "en" ? `${value} LYD` : `${value} د.ل`;
}
