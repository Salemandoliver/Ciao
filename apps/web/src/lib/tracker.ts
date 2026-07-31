"use client";
/**
 * Client event tracker — batched, offline-tolerant, never blocks UX.
 * anonId persists in localStorage; sessionId per tab. Events queue and flush
 * every 5s / 10 events / on tab hide (sendBeacon). If offline, the queue
 * persists to localStorage and flushes next visit — Libyan network reality.
 * PRIVACY: never put phone numbers, names, or free text into props.
 */
import { API_URL } from "./api";

interface QueuedEvent {
  name: string;
  ts: string;
  props: Record<string, unknown>;
}

const QUEUE_KEY = "ciao_evt_queue";
const ANON_KEY = "ciao_anon";
const MAX_QUEUE = 100;

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function anonId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

function sessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem("ciao_session");
  if (!id) {
    id = crypto.randomUUID().slice(0, 13);
    sessionStorage.setItem("ciao_session", id);
  }
  return id;
}

function loadPersisted() {
  try {
    const saved = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedEvent[];
    if (saved.length) queue.unshift(...saved.slice(-MAX_QUEUE));
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* ignore */
  }
}

export function trackClient(name: string, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  queue.push({ name, ts: new Date().toISOString(), props });
  if (queue.length >= 10) void flush();
  ensureLoop();
}

async function flush(useBeacon = false): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, 25);
  const body = JSON.stringify({ anonId: anonId(), sessionId: sessionId(), events: batch });
  try {
    if (useBeacon && "sendBeacon" in navigator) {
      const ok = navigator.sendBeacon(
        `${API_URL}/v1/events`,
        new Blob([body], { type: "application/json" }),
      );
      if (!ok) queue.unshift(...batch);
      return;
    }
    const res = await fetch(`${API_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    if (!res.ok && res.status !== 400) queue.unshift(...batch);
  } catch {
    queue.unshift(...batch); // offline — keep for later
    persist();
  }
}

function ensureLoop() {
  if (flushTimer || typeof window === "undefined") return;
  loadPersisted();
  flushTimer = setInterval(() => void flush(), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flush(true);
      persist();
    }
  });
}
