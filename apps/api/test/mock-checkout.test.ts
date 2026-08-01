/**
 * The mock payment gateway.
 *
 * It is "only" the dev provider, but it is the page a guest passes through
 * mid-booking in every demo, and it is reachable on a public URL. Three things
 * went wrong on it at once, and all three are the kind that stay broken
 * quietly:
 *
 *  1. The response had no charset, so browsers guessed Latin-1 and every
 *     Arabic character rendered as mojibake — on the one screen where a guest
 *     is deciding whether to trust us with money.
 *  2. Query parameters were interpolated into the HTML unescaped.
 *  3. The return URL was followed without checking, making it an open
 *     redirect that a shared demo link could point anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/client.js";
import { config } from "../src/config.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const isMock = config.paymentProvider === "mock";

describe.skipIf(!isMock)("mock checkout page", () => {
  it("declares UTF-8, so Arabic is not served as mojibake", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payments/mock/checkout?ref=mock_CIA-TEST-1&return=/booking/CIA-TEST",
    });
    expect(res.statusCode).toBe(200);
    // Both belt and braces: the header is what browsers actually obey, the
    // meta tag is what survives being saved or proxied.
    expect(res.headers["content-type"]).toMatch(/charset=utf-8/i);
    expect(res.body).toContain('<meta charset="utf-8"/>');
    // And the Arabic round-trips intact.
    expect(res.body).toContain("بوابة دفع تجريبية");
  });

  it("escapes anything reflected from the query string", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payments/mock/checkout?ref=${encodeURIComponent('"><script>alert(1)</script>')}&return=/x`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>alert(1)</script>");
    expect(res.body).toContain("&lt;script&gt;");
  });

  it("refuses to bounce the guest anywhere but our own app", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payments/mock/checkout?ref=mock_1&return=${encodeURIComponent("https://evil.example/steal")}`,
    });
    expect(res.body).not.toContain("evil.example");
    expect(res.body).toContain(config.webBaseUrl);
  });

  it("applies the same guard to the POST that follows", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock/complete",
      payload: { ref: "mock_NOPE", return: "https://evil.example/steal", outcome: "fail" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).not.toContain("evil.example");
  });

  it("says plainly that no real money moves", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payments/mock/checkout?ref=mock_1&return=/booking/X",
    });
    // A guest mid-checkout should never be left wondering whether they were
    // just charged.
    expect(res.body).toContain("لا يُخصم منك أي مبلغ حقيقي");
  });
});
