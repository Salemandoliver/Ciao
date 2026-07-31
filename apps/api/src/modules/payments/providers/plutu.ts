/**
 * Plutu provider — §10.2. One API for Sadad (OTP flow), Adfali, local bank
 * cards (Nomu), T-Lync hosted checkout, and MPGS international cards.
 * API shape per docs.plutu.ly: Bearer access token + X-API-KEY header,
 * amounts in LYD with 2 decimals, unique invoice numbers,
 * SHA-256 HMAC callback verification.
 *
 * NOTE (launch gate, design doc §10.2): fees, settlement schedule, refund
 * support per rail are unverified with Plutu — confirm before go-live.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../../config.js";
import type {
  InitiateParams,
  InitiateResult,
  PaymentProvider,
  ProviderStatus,
  RefundResult,
  WebhookVerification,
} from "../provider.js";

function toLydString(dirhams: number): string {
  return (dirhams / 1000).toFixed(2);
}

async function plutuFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${config.plutu.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.plutu.accessToken}`,
      "X-API-KEY": config.plutu.apiKey,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Plutu ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

const RAIL_PATHS: Record<string, string> = {
  sadad: "/transaction/sadadapi",
  adfali: "/transaction/edfali",
  local_card: "/transaction/localbankcards",
  tlync: "/transaction/tlync",
  mpgs: "/transaction/mpgs",
};

export const plutuProvider: PaymentProvider = {
  name: "plutu",
  rails: ["sadad", "adfali", "local_card", "tlync", "mpgs"],

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const path = RAIL_PATHS[p.rail];
    if (!path) throw new Error(`Plutu does not support rail ${p.rail}`);

    if (p.rail === "sadad") {
      // Two-step OTP flow: verify (sends OTP to customer) then confirm.
      const r = await plutuFetch(`${path}/verify`, {
        amount: toLydString(p.amount),
        mobile_number: p.sadad?.mobile ?? p.customerPhone,
        birth_year: p.sadad?.birthYear,
        invoice_no: p.invoiceNo,
      });
      const processId = String(
        (r.result as Record<string, unknown> | undefined)?.process_id ?? r.process_id ?? "",
      );
      return { providerRef: processId, kind: "otp_confirm", otpRequestId: processId };
    }

    // Hosted-checkout style rails: redirect the customer.
    const r = await plutuFetch(`${path}/confirm`, {
      amount: toLydString(p.amount),
      invoice_no: p.invoiceNo,
      return_url: p.returnUrl,
      customer_ip: p.metadata?.customerIp ?? "0.0.0.0",
      lang: "ar",
    });
    const result = (r.result ?? r) as Record<string, unknown>;
    return {
      providerRef: String(result.transaction_id ?? p.invoiceNo),
      kind: "redirect",
      redirectUrl: String(result.redirect_url ?? result.url ?? ""),
    };
  },

  async confirmOtp(processId: string, otp: string): Promise<ProviderStatus> {
    const r = await plutuFetch("/transaction/sadadapi/confirm", {
      process_id: processId,
      code: otp,
    });
    const result = (r.result ?? r) as Record<string, unknown>;
    const ok =
      String(result.status ?? r.status ?? "").toLowerCase() === "completed" ||
      r.status === 200;
    return {
      providerRef: String(result.transaction_id ?? processId),
      status: ok ? "captured" : "failed",
      raw: r,
    };
  },

  async status(providerRef: string): Promise<ProviderStatus> {
    // Plutu is callback-driven; poll endpoint availability is a launch-gate
    // question. Until confirmed, status is resolved by webhook only.
    return { providerRef, status: "pending" };
  },

  async refund(): Promise<RefundResult> {
    // Refund rails in Libya are immature (§10.6): credit-first ladder applies.
    return { supported: false };
  },

  verifyWebhook(headers, rawBody): WebhookVerification {
    // Plutu callback: SHA-256 HMAC over the payload using the secret key,
    // sent in X-Signature (parameters concatenated per docs — verify exact
    // canonicalization against live sandbox before launch).
    const sigHeader = String(headers["x-signature"] ?? headers["x-plutu-signature"] ?? "");
    const expected = createHmac("sha256", config.plutu.secretKey)
      .update(rawBody)
      .digest("hex");
    let valid = false;
    try {
      valid =
        sigHeader.length > 0 &&
        timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    } catch {
      valid = false;
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    const approved =
      String(parsed.transaction_status ?? parsed.status ?? "").toLowerCase() ===
        "approved" || String(parsed.payment_status ?? "").toLowerCase() === "completed";
    return {
      valid,
      externalId: String(parsed.transaction_id ?? sigHeader ?? rawBody.slice(0, 64)),
      invoiceNo: parsed.invoice_no ? String(parsed.invoice_no) : undefined,
      event: approved ? "payment.completed" : "payment.failed",
      amount: parsed.amount ? Math.round(Number(parsed.amount) * 1000) : undefined,
      raw: parsed,
    };
  },
};
