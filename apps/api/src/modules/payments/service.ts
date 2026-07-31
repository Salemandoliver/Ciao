/**
 * Webhook ingestion — journal-first processing (§13.4):
 * 1) verify signature; 2) insert into webhook_events (unique on provider+externalId
 *    = replay protection); 3) act on the journaled event.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { getProvider } from "./registry.js";
import { onDepositCaptured } from "../bookings/service.js";
import { transition } from "../bookings/machine.js";

export async function ingestWebhook(
  providerName: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): Promise<{ accepted: boolean; reason?: string }> {
  const provider = getProvider(providerName);
  const v = provider.verifyWebhook(headers, rawBody);

  // Journal first — even invalid signatures are recorded for forensics.
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({
      provider: provider.name,
      externalId: v.externalId,
      payload: v.raw as object,
      signatureValid: v.valid,
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });

  if (!v.valid) return { accepted: false, reason: "invalid_signature" };
  if (inserted.length === 0) return { accepted: true, reason: "replay_ignored" };
  const eventRowId = inserted[0]!.id;

  try {
    await processEvent(v.invoiceNo, v.event, v.amount);
    await db
      .update(schema.webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(schema.webhookEvents.id, eventRowId));
    return { accepted: true };
  } catch (e) {
    await db
      .update(schema.webhookEvents)
      .set({ error: String(e) })
      .where(eq(schema.webhookEvents.id, eventRowId));
    throw e;
  }
}

async function processEvent(
  invoiceNo: string | undefined,
  event: string | undefined,
  amount: number | undefined,
): Promise<void> {
  if (!invoiceNo) return;
  const [intent] = await db
    .select()
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.invoiceNo, invoiceNo))
    .limit(1);
  if (!intent) return;

  switch (event) {
    case "payment.completed": {
      // Amount mismatch → do not acknowledge money as ours (§10.4); flag it.
      if (amount != null && amount !== intent.amount) {
        await db
          .update(schema.paymentIntents)
          .set({ status: "failed", failureCode: "AMOUNT_MISMATCH", updatedAt: new Date() })
          .where(eq(schema.paymentIntents.id, intent.id));
        return;
      }
      await onDepositCaptured(intent.id);
      break;
    }
    case "payment.failed":
    case "payment.expired": {
      await db
        .update(schema.paymentIntents)
        .set({
          status: event === "payment.failed" ? "failed" : "expired",
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intent.id));
      await transition({
        bookingId: intent.bookingId,
        to: "payment_failed",
        actor: "system",
        reason: event,
        expectedFrom: ["payment_pending"],
        idempotencyKey: `payfail:${intent.id}`,
      });
      break;
    }
    case "payment.refunded": {
      await db
        .update(schema.paymentIntents)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(eq(schema.paymentIntents.id, intent.id));
      await db
        .update(schema.refunds)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(schema.refunds.bookingId, intent.bookingId),
            eq(schema.refunds.method, "rail_refund"),
            eq(schema.refunds.status, "pending"),
          ),
        );
      break;
    }
  }
}
