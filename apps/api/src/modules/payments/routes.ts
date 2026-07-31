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
      await onDepositCaptured(intent.id);
      return reply.send({ ok: true, status: "captured" });
    }
    return reply.status(402).send({ ok: false, status: status.status });
  });

  // ---- Mock checkout pages for dev/staging (never mounted in prod) ----
  if (config.paymentProvider === "mock") {
    app.get("/v1/payments/mock/checkout", async (req, reply) => {
      const q = z.object({ ref: z.string(), return: z.string() }).parse(req.query);
      reply.type("text/html");
      return reply.send(`<!doctype html><html dir="rtl" lang="ar"><body style="font-family:sans-serif;padding:2rem;text-align:center">
<h2>بوابة دفع تجريبية</h2><p>المرجع: ${q.ref}</p>
<form method="post" action="/v1/payments/mock/complete">
<input type="hidden" name="ref" value="${q.ref}"/><input type="hidden" name="return" value="${q.return}"/>
<button name="outcome" value="success" style="padding:1rem 2rem;background:#1B4F72;color:white;border:0;border-radius:8px">ادفع الآن (نجاح)</button>
<button name="outcome" value="fail" style="padding:1rem 2rem;margin-right:1rem">فشل الدفع</button>
</form></body></html>`);
    });

    app.post("/v1/payments/mock/complete", async (req, reply) => {
      const body = z
        .object({ ref: z.string(), return: z.string(), outcome: z.enum(["success", "fail"]) })
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
      return reply.redirect(body.return);
    });
  }
}
