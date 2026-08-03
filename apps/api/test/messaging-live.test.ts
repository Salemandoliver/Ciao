/**
 * Live messaging — the ladder with real providers, HTTP mocked.
 *
 * What these tests protect:
 *  - the WhatsApp payload is a TEMPLATE message (free-form text only reaches
 *    someone who wrote to us within 24 hours, which Ciao-initiated messages
 *    never are), named and parameterised exactly the way the registration
 *    doc registers it;
 *  - a WhatsApp failure falls through to the Twilio rung, and the provider's
 *    own error text lands in the journal — a "failed" with no detail means
 *    grepping rotated logs;
 *  - the control-plane kill switches actually remove rungs, and with every
 *    rung off the message journals as skipped rather than pretending to send;
 *  - quiet hours follow the control-plane window, wrap and all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";

vi.mock("../src/config.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config.js")>();
  return {
    config: {
      ...mod.config,
      messagingProvider: "live",
      whatsapp: { token: "wa-test-token", phoneNumberId: "12345", templateSends: true },
      sms: { twilioSid: "ACtest", twilioToken: "twtoken", senderId: "CIAO" },
    },
  };
});

import { db, pool, schema } from "../src/db/client.js";
import {
  inQuietHours,
  ladder,
  notify,
  templateVarOrder,
  waPayload,
} from "../src/modules/messaging/service.js";
import { invalidateSettingsCache } from "../src/modules/business/settings.js";

const phone = `+2189177${Date.now().toString().slice(-5)}`;

const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  fetchMock.mockReset();
  await db
    .delete(schema.platformSettings)
    .where(eq(schema.platformSettings.key, "messaging.whatsappEnabled"));
  await db
    .delete(schema.platformSettings)
    .where(eq(schema.platformSettings.key, "messaging.smsEnabled"));
  invalidateSettingsCache();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});

async function setSwitch(key: string, value: boolean) {
  await db
    .insert(schema.platformSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value } });
  invalidateSettingsCache();
}

async function lastRows(n: number) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.toPhone, phone))
    .orderBy(desc(schema.messages.createdAt))
    .limit(n);
}

describe("the WhatsApp template payload", () => {
  it("derives positional parameters from the body of the language being sent", () => {
    expect(templateVarOrder("رمز الدخول: {{code}} صالح {{mins}} دقائق {{code}}")).toEqual([
      "code",
      "mins",
    ]);
    const payload = waPayload("218911111111", "ignored", {
      templateKey: "otp",
      locale: "ar",
      vars: { code: "123456" },
    }) as { type: string; template: { name: string; language: { code: string }; components: unknown[] } };
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("ciao_otp");
    expect(payload.template.language.code).toBe("ar");
    expect(payload.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });
});

describe("the live ladder", () => {
  it("sends a template message to Meta, and stops at first success", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    await notify({ templateKey: "otp", toPhone: phone, vars: { code: "654321" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("graph.facebook.com");
    expect(String(url)).toContain("/12345/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("ciao_otp");
    expect(body.to).toBe(phone.replace("+", ""));

    const [row] = await lastRows(1);
    expect(row!.deliveryStatus).toBe("sent");
    expect(row!.channel).toBe("whatsapp");
  });

  it("falls through to Twilio on a Meta failure and journals the provider's words", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        text: async () => '{"error":{"message":"template not approved"}}',
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "" });

    await notify({ templateKey: "otp", toPhone: phone, vars: { code: "111222" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url2, init2] = fetchMock.mock.calls[1]!;
    expect(String(url2)).toContain("api.twilio.com");
    expect(String(url2)).toContain("ACtest");
    const form = new URLSearchParams((init2 as RequestInit).body as string);
    expect(form.get("To")).toBe(phone);
    expect(form.get("From")).toBe("CIAO");
    expect(form.get("Body")).toContain("111222");

    const rows = await lastRows(2);
    const failed = rows.find((r) => r.deliveryStatus === "failed")!;
    expect(failed.channel).toBe("whatsapp");
    expect(failed.deliveryDetail).toContain("template not approved");
    const sent = rows.find((r) => r.deliveryStatus === "sent")!;
    expect(sent.channel).toBe("sms");
    expect(sent.ladderStep).toBe(1);
  });

  it("kill switches remove rungs, and with every rung off the message journals as skipped", async () => {
    await setSwitch("messaging.whatsappEnabled", false);
    const settings = { "messaging.whatsappEnabled": false, "messaging.smsEnabled": true };
    expect(ladder(settings).map((s) => s.name)).toEqual(["sms"]);

    await setSwitch("messaging.smsEnabled", false);
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    await notify({ templateKey: "otp", toPhone: phone, vars: { code: "999888" } });
    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await lastRows(1);
    expect(row!.deliveryStatus).toBe("skipped");
  });
});

describe("quiet hours", () => {
  const at = (hourUtc: number) => new Date(Date.UTC(2026, 6, 15, hourUtc, 30));
  // Africa/Tripoli is UTC+2 year-round.
  it("handles the midnight wrap, a plain window, and an empty window", () => {
    expect(inQuietHours(23, 8, at(21 - 2))).toBe(false); // 21:00 Tripoli
    expect(inQuietHours(23, 8, at(23 - 2))).toBe(true); // 23:30
    expect(inQuietHours(23, 8, at(7 - 2))).toBe(true); // 07:30
    expect(inQuietHours(23, 8, at(8 - 2))).toBe(false); // 08:30
    expect(inQuietHours(1, 6, at(3 - 2))).toBe(true); // non-wrapping window
    expect(inQuietHours(1, 6, at(7 - 2))).toBe(false);
    expect(inQuietHours(8, 8, at(8 - 2))).toBe(false); // equal ends = no window
  });
});
