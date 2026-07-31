/**
 * Provider routing table by rail + health state (§13.4, §10.8).
 * Primary: Plutu. Failover order per rail is config, not code.
 */
import { eq } from "drizzle-orm";
import type { PaymentRail } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { config } from "../../config.js";
import type { PaymentProvider } from "./provider.js";
import { plutuProvider } from "./providers/plutu.js";
import { mockProvider } from "./providers/mock.js";

const providers: Record<string, PaymentProvider> = {
  plutu: plutuProvider,
  mock: mockProvider,
};

export function getProvider(name?: string): PaymentProvider {
  const p = providers[name ?? config.paymentProvider];
  if (!p) throw new Error(`Unknown payment provider ${name}`);
  return p;
}

export async function railIsHealthy(rail: PaymentRail): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.railHealth)
    .where(eq(schema.railHealth.rail, rail))
    .limit(1);
  return row?.healthy ?? true;
}

export async function markRail(rail: PaymentRail, healthy: boolean, note?: string) {
  await db
    .insert(schema.railHealth)
    .values({
      rail,
      healthy,
      lastCheckAt: new Date(),
      lastFailureAt: healthy ? undefined : new Date(),
      note,
    })
    .onConflictDoUpdate({
      target: schema.railHealth.rail,
      set: {
        healthy,
        lastCheckAt: new Date(),
        ...(healthy ? {} : { lastFailureAt: new Date() }),
        note,
      },
    });
}

/** Rails offered at checkout right now — dead rails auto-hidden (§10.8). */
export async function availableRails(): Promise<PaymentRail[]> {
  const provider = getProvider();
  const rails: PaymentRail[] = [];
  for (const rail of provider.rails) {
    if (await railIsHealthy(rail)) rails.push(rail);
  }
  return rails;
}
