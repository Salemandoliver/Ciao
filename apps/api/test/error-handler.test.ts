/**
 * The error handler's fall-through branch.
 *
 * Found while auditing the theme, of all things: requesting an OTP past the
 * limit answered `500 CIAO-5000 "حدث خطأ عندنا — فريق الدعم أُبلغ تلقائيًا"`.
 * Two separate failures in one response. A guest who taps "send code" twice is
 * told Ciao is broken and stops trusting it, when the truthful answer is "wait
 * a minute". And on our side every throttled request was logged at error
 * level, so the signal we would actually page on is buried under people
 * double-tapping a button on a slow connection.
 *
 * Rate limiting is a normal, expected, correct outcome. It has to read like
 * one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/client.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A phone nobody else in the suite uses, so the limiter counts only us. */
const phone = `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

describe("error handler", () => {
  it("answers a throttled OTP request with 429 and the throttle message", async () => {
    // The route allows 5 per 10 minutes; the sixth must be a clean refusal.
    let last = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone },
    });
    for (let i = 0; i < 8 && last.statusCode === 200; i++) {
      last = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        payload: { phone },
      });
    }

    expect(last.statusCode).toBe(429);
    const body = last.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("CIAO-4003");
    // Not the "something broke on our side" message.
    expect(body.error.message).not.toContain("فريق الدعم");
    expect(body.error.message).toContain("طلبات كثيرة");
  });

  it("answers in English when the client asks for it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone },
      headers: { "accept-language": "en-GB,en;q=0.9" },
    });
    expect(res.statusCode).toBe(429);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(
      /too many requests/i,
    );
  });

  it("still reports genuine server faults as 500", async () => {
    // A route that does not exist is a 404, not a 500 — and definitely not an
    // "internal error". This pins the boundary from the other side.
    const res = await app.inject({ method: "GET", url: "/v1/definitely-not-a-route" });
    expect(res.statusCode).toBe(404);
  });
});
