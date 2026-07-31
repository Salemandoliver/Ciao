"use client";
/**
 * Wishlist state — server-backed when signed in, localStorage for anonymous
 * visitors (their hearts still emit events with anonId: behavior we learn
 * from either way; the local set syncs up on first login).
 */
import { api, hasSession } from "./api";
import { trackClient } from "./tracker";

const LOCAL_KEY = "ciao_wishlist";
let serverIds: Set<string> | null = null;
const listeners = new Set<() => void>();

function localIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveLocal(ids: Set<string>) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...ids]));
}

export function onWishlistChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}

export async function hydrateWishlist(): Promise<void> {
  if (!hasSession()) return;
  try {
    const r = await api<{ ids: string[] }>("/v1/wishlist/ids");
    serverIds = new Set(r.ids);
    // First login after anonymous hearting: push local hearts up, once.
    const local = localIds();
    for (const id of local) {
      if (!serverIds.has(id)) {
        await api(`/v1/wishlist/${id}`, { method: "POST", body: "{}" }).catch(() => {});
        serverIds.add(id);
      }
    }
    if (local.size) localStorage.removeItem(LOCAL_KEY);
    notify();
  } catch {
    /* stay local */
  }
}

export function isSaved(listingId: string): boolean {
  if (serverIds) return serverIds.has(listingId);
  if (typeof window === "undefined") return false;
  return localIds().has(listingId);
}

export async function toggleSaved(
  listingId: string,
  meta: { vertical?: string; city?: string; area?: string; priceNightly?: number } = {},
): Promise<boolean> {
  if (hasSession()) {
    try {
      const r = await api<{ saved: boolean }>(`/v1/wishlist/${listingId}`, {
        method: "POST",
        body: "{}",
      });
      serverIds ??= new Set();
      if (r.saved) serverIds.add(listingId);
      else serverIds.delete(listingId);
      notify();
      return r.saved; // server emits the event with userId
    } catch {
      /* fall through to local */
    }
  }
  const ids = localIds();
  const nowSaved = !ids.has(listingId);
  if (nowSaved) {
    ids.add(listingId);
    trackClient("listing.saved", { listingId, ...meta });
  } else {
    ids.delete(listingId);
    trackClient("listing.unsaved", { listingId });
  }
  saveLocal(ids);
  notify();
  return nowSaved;
}

export function localWishlistIds(): string[] {
  return serverIds ? [...serverIds] : [...localIds()];
}
