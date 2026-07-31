import { describe, expect, it } from "vitest";
import {
  canTransition,
  refundFraction,
  quoteStay,
  quoteHall,
  priceBand,
  privacyScore,
  reliabilityScore,
  TRANSITIONS,
  BOOKING_STATES,
  TERMINAL_STATES,
} from "@ciao/shared";
import { maskContacts } from "../src/lib/masking.js";

describe("booking state machine graph (§9.3)", () => {
  it("allows the happy path end to end", () => {
    const path = [
      "draft",
      "requested",
      "payment_pending",
      "payment_held",
      "host_confirmed",
      "confirmed",
      "pre_arrival_reconfirmed",
      "checked_in",
      "completed",
      "reviewed",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("draft", "confirmed")).toBe(false);
    expect(canTransition("payment_pending", "host_confirmed")).toBe(false);
    expect(canTransition("completed", "checked_in")).toBe(false);
    expect(canTransition("host_declined", "confirmed")).toBe(false);
  });

  it("payment_failed is retryable (§9.3)", () => {
    expect(canTransition("payment_failed", "payment_pending")).toBe(true);
  });

  it("every transition target is a known state", () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      expect(BOOKING_STATES).toContain(from);
      for (const to of tos) expect(BOOKING_STATES).toContain(to);
    }
  });

  it("terminal states have no exits (except documented)", () => {
    for (const s of TERMINAL_STATES) {
      if (s === "payment_failed") continue;
      expect(TRANSITIONS[s]).toEqual([]);
    }
  });
});

describe("cancellation tiers (§9.7)", () => {
  it("flexible: full refund ≥48h", () => {
    expect(refundFraction("flexible", 49)).toBe(1);
    expect(refundFraction("flexible", 47)).toBe(0);
  });
  it("moderate: full ≥7d, 50% inside", () => {
    expect(refundFraction("moderate", 8 * 24)).toBe(1);
    expect(refundFraction("moderate", 3 * 24)).toBe(0.5);
    expect(refundFraction("moderate", -1)).toBe(0);
  });
  it("strict: nothing back — Exchange is the escape valve", () => {
    expect(refundFraction("strict", 100 * 24)).toBe(0);
  });
});

describe("pricing engine (§9.6)", () => {
  const cfg = {
    baseNightly: 600_000,
    weekendMultiplierBps: 12500,
    thursdayMultiplierBps: 11500,
    seasonMultiplierBps: 10000,
  };

  it("Libyan weekend is Fri–Sat with a Thursday band", () => {
    expect(priceBand(new Date("2026-08-06T00:00:00Z"))).toBe("thursday"); // Thu
    expect(priceBand(new Date("2026-08-07T00:00:00Z"))).toBe("weekend"); // Fri
    expect(priceBand(new Date("2026-08-08T00:00:00Z"))).toBe("weekend"); // Sat
    expect(priceBand(new Date("2026-08-09T00:00:00Z"))).toBe("weekday"); // Sun
  });

  it("quotes the design-doc example: 3 nights × 600 → 20% deposit", () => {
    // Sun→Wed: three weekday nights.
    const q = quoteStay(
      cfg,
      new Date("2026-08-09T00:00:00Z"),
      new Date("2026-08-12T00:00:00Z"),
    );
    expect(q.total).toBe(1_800_000);
    expect(q.deposit).toBe(360_000);
    expect(q.balanceOnArrival).toBe(1_440_000);
    // Commission 10% of booking value ≈ half the deposit (§9.2).
    expect(q.commission).toBe(180_000);
    expect(q.hostShareOfDeposit).toBe(180_000);
  });

  it("founding-host promo halves the commission (§16.2)", () => {
    const q = quoteStay(
      cfg,
      new Date("2026-08-09T00:00:00Z"),
      new Date("2026-08-12T00:00:00Z"),
      { foundingHost: true },
    );
    expect(q.commission).toBe(90_000);
  });

  it("hall commission capped at LYD 2,500 (§9.2)", () => {
    const q = quoteHall(40_000_000); // 40k LYD package
    expect(q.commission).toBeLessThanOrEqual(2_500_000);
    const q2 = quoteHall(25_000_000);
    expect(q2.commission).toBe(1_750_000); // 7%
    expect(q2.dateLockFee).toBe(2_500_000); // 10%
  });
});

describe("trust math (§8.4, §11.4)", () => {
  it("privacy score weights satar factors", () => {
    expect(
      privacyScore({ walledPool: true, overlooked: false, separateFamilyEntrance: true }),
    ).toBe(100);
    expect(
      privacyScore({ walledPool: false, overlooked: true, separateFamilyEntrance: false }),
    ).toBe(0);
  });
  it("reliability punishes double-bookings hard", () => {
    const good = reliabilityScore({
      confirmationRate: 1,
      medianResponseMinutes: 10,
      attestationStreakWeeks: 10,
      doubleBookingIncidents: 0,
      cancellationStrikes: 0,
      accuracyScore: 5,
    });
    const bad = { ...{
      confirmationRate: 1,
      medianResponseMinutes: 10,
      attestationStreakWeeks: 10,
      doubleBookingIncidents: 2,
      cancellationStrikes: 0,
      accuracyScore: 5,
    } };
    expect(good).toBe(100); // raw 110, clamped
    expect(reliabilityScore(bad)).toBe(80); // raw 110 − 2×15 incidents
  });
});

describe("contact masking (§8.7)", () => {
  it("masks Libyan phone numbers incl. spaced digits", () => {
    const r = maskContacts("كلمني على 0912345678 قبل الحجز");
    expect(r.hadContact).toBe(true);
    expect(r.masked).not.toContain("0912345678");
  });
  it("masks Arabic-Indic digits", () => {
    const r = maskContacts("رقمي ٠٩١٢٣٤٥٦٧٨");
    expect(r.hadContact).toBe(true);
    expect(r.masked).not.toContain("912345678");
  });
  it("masks wa.me links", () => {
    const r = maskContacts("تواصل معي https://wa.me/218912345678");
    expect(r.masked).toContain("[رابط مخفي]");
  });
  it("leaves normal chat alone", () => {
    const r = maskContacts("هل المولد شغال؟ وكم عمق المسبح؟");
    expect(r.hadContact).toBe(false);
    expect(r.masked).toBe("هل المولد شغال؟ وكم عمق المسبح؟");
  });
});

describe("phone normalization (local 09… format)", () => {
  it("converts local Libyan mobile formats to E.164", async () => {
    const { normalizePhone, localPhone } = await import("@ciao/shared");
    expect(normalizePhone("0911111111")).toBe("+218911111111");
    expect(normalizePhone("091 111 1111")).toBe("+218911111111");
    expect(normalizePhone("911111111")).toBe("+218911111111");
    expect(normalizePhone("218911111111")).toBe("+218911111111");
    expect(normalizePhone("+218911111111")).toBe("+218911111111");
    expect(normalizePhone("00447700900123")).toBe("+447700900123"); // diaspora
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
    expect(localPhone("+218911111111")).toBe("0911111111");
    expect(localPhone("+447700900123")).toBe("+447700900123");
  });
});
