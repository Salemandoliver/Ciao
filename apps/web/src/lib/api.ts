/** API client — token storage in memory + localStorage refresh. */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let accessToken: string | null = null;

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (typeof window !== "undefined" && refresh) {
    localStorage.setItem("ciao_refresh", refresh);
  }
}

export function clearTokens() {
  accessToken = null;
  if (typeof window !== "undefined") localStorage.removeItem("ciao_refresh");
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
  if (!accessToken) return "";
  try {
    const part = accessToken.split(".")[1];
    if (!part) return "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return String((JSON.parse(json) as { role?: string }).role ?? "");
  } catch {
    return "";
  }
}

async function refreshSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const refresh = localStorage.getItem("ciao_refresh");
  if (!refresh) return false;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
      error?: { code: string; message: string };
    };
    throw new ApiError(
      res.status,
      body.error?.code ?? "CIAO-5000",
      body.error?.message ?? "حدث خطأ",
    );
  }
  return res.json() as Promise<T>;
}

/** Ensure a live access token (call on app mount for signed-in flows). */
export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

export function fmtLyd(dirhams: number): string {
  return `${(dirhams / 1000).toLocaleString("ar-LY", { maximumFractionDigits: 0 })} د.ل`;
}
