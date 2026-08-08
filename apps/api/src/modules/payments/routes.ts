import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { ingestWebhook } from "./service.js";
import { availableRails, getProvider } from "./registry.js";
import { onDepositCaptured } from "../bookings/service.js";
import { config } from "../../config.js";
import { signMockWebhook } from "./providers/mock.js";

export async function paymentRoutes(app: FastifyInstance) {
  // Rails offered right now — dead rails hidden (§10.8).
  app.get("/v1/payments/rails", async (_req, reply) => {
    return reply.send({ rails: await availableRails() });
  });

  // Webhook ingestion (§13.4) — raw body needed for HMAC verification.
  app.post("/v1/payments/webhook/:provider", {
    config: { rawBody: true },
    handler: async (req, reply) => {
      const { provider } = z
        .object({ provider: z.enum(["plutu", "dpay", "tlync", "mock"]) })
        .parse(req.params);
      const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
      const result = await ingestWebhook(provider, req.headers, raw);
      // Always 200 on verified events (retried webhooks deduplicated, §12.5);
      // 401 only on signature failure so the PSP retries with alarm on their side.
      if (!result.accepted && result.reason === "invalid_signature") {
        return reply.status(401).send({ ok: false });
      }
      return reply.send({ ok: true });
    },
  });

  // Sadad OTP confirmation step (§10.2).
  app.post("/v1/payments/sadad/confirm", async (req, reply) => {
    const body = z
      .object({ intentId: z.string().uuid(), otp: z.string().min(4).max(8) })
      .parse(req.body);
    const [intent] = await db
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, body.intentId))
      .limit(1);
    if (!intent || !intent.providerRef) return reply.status(404).send({ ok: false });
    const provider = getProvider(intent.provider);
    if (!provider.confirmOtp) return reply.status(400).send({ ok: false });
    const status = await provider.confirmOtp(intent.providerRef, body.otp);
    if (status.status === "captured") {
      /*
       * Route by purpose, exactly as the webhook does.
       *
       * This path used to send everything to `onDepositCaptured`, which is
       * deliberately inert for a non-booking intent — so a partner who bought
       * a year of Plus over Sadad had their money taken, got a success screen,
       * and received nothing. The two capture paths must agree on what a
       * payment was for or one of them is silently wrong.
       */
      if (intent.purpose === "subscription") {
        const subs = await import("../partner/subscription.js");
        await db
          .update(schema.paymentIntents)
          .set({ status: "captured", updatedAt: new Date() })
          .where(eq(schema.paymentIntents.id, intent.id));
        await subs.grantAnnualTerm(intent.id);
      } else {
        await onDepositCaptured(intent.id);
      }
      return reply.send({ ok: true, status: "captured" });
    }
    return reply.status(402).send({ ok: false, status: status.status });
  });

  // ---- Mock checkout pages for dev/staging (never mounted in prod) ----
  if (config.paymentProvider === "mock") {
    /** HTML-escape anything reflected back into the page. */
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );

    /**
     * Only ever bounce back to our own web app. `return` arrives as a query
     * parameter, so without this the mock gateway is an open redirect that a
     * phishing link could point anywhere — and "it's only the dev provider"
     * stops being true the moment a demo URL gets shared.
     */
    const safeReturn = (raw: string): string => {
      try {
        const url = new URL(raw, config.webBaseUrl);
        const base = new URL(config.webBaseUrl);
        return url.origin === base.origin ? url.toString() : config.webBaseUrl;
      } catch {
        return config.webBaseUrl;
      }
    };

    app.get("/v1/payments/mock/checkout", async (req, reply) => {
      const q = z.object({ ref: z.string().max(64), return: z.string().max(500) }).parse(req.query);
      const ref = esc(q.ref);
      const back = esc(safeReturn(q.return));
      // The charset matters: without it the browser guesses Latin-1 and every
      // Arabic character on this page renders as mojibake.
      reply.type("text/html; charset=utf-8");
      return reply.send(`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>بوابة دفع تجريبية — تشاو</title>
<style>
  :root { --sea:#1B4F72; --sand:#F5EFE3; --amber:#E8A33D; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--sand);
         color:#1a2a36; font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif; padding:1.5rem; }
  .card { background:#fff; border-radius:1.25rem; box-shadow:0 1px 3px rgb(0 0 0 / .08);
          padding:1.75rem; max-width:26rem; width:100%; text-align:center; }
  h1 { color:var(--sea); font-size:1.15rem; margin:0 0 .25rem; }
  .note { background:#FDF3E0; color:#8a5a12; border-radius:.75rem; padding:.6rem .8rem;
          font-size:.8rem; line-height:1.6; margin:1rem 0; }
  .ref { font-size:.75rem; color:#5a6b78; word-break:break-all; margin:.25rem 0 0; }
  button { font:inherit; font-weight:700; border:0; border-radius:1rem; padding:.9rem 1.25rem;
           width:100%; cursor:pointer; }
  .pay { background:var(--sea); color:#fff; margin-top:1rem; }
  .fail { background:transparent; color:#5a6b78; text-decoration:underline; margin-top:.5rem; }
</style>
</head>
<body>
  <main class="card">
    <h1>بوابة دفع تجريبية</h1>
    <p class="ref">المرجع: ${ref}</p>
    <p class="note">
      هذه محاكاة لبوابة الدفع ولا يُخصم منك أي مبلغ حقيقي. عند ربط مزوّد الدفع ستفتح هنا صفحة
      سداد أو أضفلي أو بطاقتك المصرفية.
    </p>
    <form method="post" action="/v1/payments/mock/complete">
      <input type="hidden" name="ref" value="${ref}"/>
      <input type="hidden" name="return" value="${back}"/>
      <button class="pay" name="outcome" value="success">تأكيد الدفع (محاكاة نجاح)</button>
      <button class="fail" name="outcome" value="fail">محاكاة فشل الدفع</button>
    </form>
  </main>
</body>
</html>`);
    });

    app.post("/v1/payments/mock/complete", async (req, reply) => {
      const body = z
        .object({
          ref: z.string().max(64),
          return: z.string().max(500),
          outcome: z.enum(["success", "fail"]),
        })
        .parse(req.body);
      const invoiceNo = body.ref.replace(/^mock_/, "");
      const [intent] = await db
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.invoiceNo, invoiceNo))
        .limit(1);
      const payload = JSON.stringify({
        event: body.outcome === "success" ? "payment.completed" : "payment.failed",
        invoice_no: invoiceNo,
        transaction_id: body.ref,
        amount: intent?.amount ?? 0,
      });
      await ingestWebhook("mock", { "x-signature": signMockWebhook(payload) }, payload);
      // Same guard on the way out: the POST body is as attacker-controllable
      // as the query string was.
      return reply.redirect(safeReturn(body.return));
    });
  }
}
