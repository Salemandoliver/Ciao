import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { CiaoError } from "./errors.js";

/**
 * Idempotency-Key support on mutating endpoints (§13.3, §12.5).
 * Same key + same body → replay stored response. Same key + different body → 409.
 */
export async function withIdempotency<T>(
  key: string | undefined,
  requestBody: unknown,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key) {
    const r = await handler();
    return { ...r, replayed: false };
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify(requestBody ?? null))
    .digest("hex");

  const [existing] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(eq(schema.idempotencyKeys.key, key))
    .limit(1);

  if (existing) {
    if (existing.requestHash !== requestHash) throw new CiaoError("IDEMPOTENCY_CONFLICT");
    if (existing.responseStatus != null) {
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
        replayed: true,
      };
    }
    // In-flight duplicate — treat as processing.
    throw new CiaoError("PAYMENT_DUPLICATE");
  }

  await db.insert(schema.idempotencyKeys).values({ key, requestHash });
  const result = await handler();
  await db
    .update(schema.idempotencyKeys)
    .set({ responseStatus: result.status, responseBody: result.body as object })
    .where(eq(schema.idempotencyKeys.key, key));
  return { ...result, replayed: false };
}
