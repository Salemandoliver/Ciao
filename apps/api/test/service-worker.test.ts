/**
 * The service worker is the one file in the product that ships to users
 * without a compiler, a type check, or a test ever having run it. It is also
 * the file that can brick the whole app for a returning visitor.
 *
 * Two failures we have already hit, both of which these tests would have
 * caught before deploy:
 *
 *  1. A `**​/` sequence inside the file's doc comment closed the comment
 *     early. The remainder parsed as an expression, so `node --check` passed
 *     happily — and the browser threw a ReferenceError at registration with
 *     the uninformative "ServiceWorker script evaluation failed". The worker
 *     silently never installed, taking offline support with it.
 *  2. Navigations were served stale-while-revalidate, so after a deploy a
 *     returning user got HTML from the previous build whose fingerprinted
 *     chunks had ceased to exist. The page died with "a client-side exception
 *     has occurred".
 *
 * So: evaluate the real file in a sandbox with the service-worker globals
 * stubbed, and assert both that it evaluates and that its routing rules are
 * the ones we meant.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const SW_PATH = fileURLToPath(new URL("../../web/public/sw.js", import.meta.url));

type Handler = (event: Record<string, unknown>) => void;

/** Evaluate sw.js the way a browser does, and capture its listeners. */
function loadServiceWorker() {
  const source = readFileSync(SW_PATH, "utf8");
  const listeners: Record<string, Handler[]> = {};
  const cacheStore = new Map<string, Map<string, unknown>>();

  const caches = {
    open: async (name: string) => {
      const c = cacheStore.get(name) ?? new Map();
      cacheStore.set(name, c);
      return {
        add: async () => undefined,
        put: async (req: { url?: string } | string, res: unknown) =>
          void c.set(typeof req === "string" ? req : (req.url ?? ""), res),
        match: async (req: { url?: string } | string) =>
          c.get(typeof req === "string" ? req : (req.url ?? "")),
      };
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
    match: async () => undefined,
  };

  const self = {
    addEventListener: (type: string, fn: Handler) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    location: { origin: "https://ciao.ly" },
  };

  const sandbox = { self, caches, fetch: async () => ({ ok: true }), URL, Request, Response };
  createContext(sandbox);
  // Throws exactly where a browser would throw at registration time.
  runInContext(source, sandbox, { filename: "sw.js" });

  return { listeners, source };
}

describe("service worker", () => {
  it("evaluates without throwing, the way a browser registers it", () => {
    expect(() => loadServiceWorker()).not.toThrow();
  });

  it("registers the lifecycle and fetch handlers", () => {
    const { listeners } = loadServiceWorker();
    for (const type of ["install", "activate", "fetch"]) {
      expect(listeners[type]?.length, `missing ${type} listener`).toBeGreaterThan(0);
    }
  });

  it("has no comment that terminates itself early", () => {
    const { source } = loadServiceWorker();
    // '**' immediately followed by '/' closes a block comment. Inside prose
    // about paths ("**/_next/static/**") that is invisible and fatal.
    const commentEnd = source.indexOf("*/");
    const header = source.slice(0, commentEnd);
    expect(header).not.toMatch(/\*\*\//);
  });

  it("serves navigations network-first so HTML and its chunks share a build", () => {
    const { source } = loadServiceWorker();
    // The property: a navigation must not be answered from cache while online.
    expect(source).toMatch(/request\.mode === "navigate"/);
    const navBlock = source.slice(source.indexOf('request.mode === "navigate"'));
    // The first strategy call after the navigation check must be networkFirst,
    // not a cache lookup — that ordering is the entire fix.
    expect(navBlock).toMatch(/^[^]{0,200}networkFirst\(/);
    expect(navBlock.slice(0, 200)).not.toMatch(/cacheFirst\(|caches\.match/);
  });

  it("keeps immutable build assets on the cheap path", () => {
    const { source } = loadServiceWorker();
    const assetBlock = source.slice(source.indexOf('"/_next/static/"'));
    expect(assetBlock).toMatch(/cacheFirst\(/);
  });

  it("never caches a failed response", () => {
    const { source } = loadServiceWorker();
    // A cached 404 outlives the deploy that caused it.
    expect(source).toMatch(/if \(res\.ok\)/);
  });

  it("purges caches from older versions on activate", () => {
    const { source } = loadServiceWorker();
    expect(source).toMatch(/caches\.delete/);
    expect(source).toMatch(/CURRENT/);
  });
});
