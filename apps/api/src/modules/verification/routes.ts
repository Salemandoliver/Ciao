import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { authenticate, requireRole } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import { privacyScore } from "@ciao/shared";

/**
 * Field-agent verification intake — §8.10, §11.2.
 * The agent PWA queues bundles offline and syncs them here (idempotent by
 * client-generated bundle id). Approval issues/refreshes the Verified badge.
 */

const checklistSchema = z.object({
  bundleId: z.string().uuid(), // client-generated for offline idempotency
  venueId: z.string().uuid(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gps: z.object({ lat: z.string(), lng: z.string() }).optional(),
  identityEvidenceGrade: z.enum(["deed", "utility_bill_attestation", "local_attestation"]),
  amenities: z.array(
    z.object({
      key: z.string(),
      present: z.boolean(),
      condition: z.enum(["good", "fair", "poor"]).optional(),
      detail: z.string().optional(),
    }),
  ),
  generatorRunTest: z
    .object({ ran: z.boolean(), kva: z.number().optional(), fuelIncluded: z.boolean().optional() })
    .optional(),
  waterSupply: z.enum(["municipal", "tank", "well", "none"]).optional(),
  privacy: z
    .object({
      walledPool: z.boolean(),
      overlooked: z.boolean(),
      separateFamilyEntrance: z.boolean(),
    })
    .optional(),
  safetyBasics: z
    .object({ gasStorageSane: z.boolean(), poolDepthMarked: z.boolean() })
    .optional(),
  evidenceMedia: z.array(z.object({ ref: z.string(), kind: z.string() })).default([]),
  contractRef: z.string().optional(),
  notes: z.string().optional(),
});

export async function verificationRoutes(app: FastifyInstance) {
  // Offline-sync intake — accepts an array of queued bundles (§8.10).
  app.post("/v1/agent/verifications/sync", async (req, reply) => {
    const claims = await authenticate(req);
    requireRole(claims, "agent");
    const body = z.object({ bundles: z.array(checklistSchema).max(20) }).parse(req.body);

    const results: { bundleId: string; status: string }[] = [];
    for (const bundle of body.bundles) {
      const [existing] = await db
        .select({ id: schema.verifications.id })
        .from(schema.verifications)
        .where(eq(schema.verifications.id, bundle.bundleId))
        .limit(1);
      if (existing) {
        results.push({ bundleId: bundle.bundleId, status: "already_synced" });
        continue;
      }
      await db.insert(schema.verifications).values({
        id: bundle.bundleId,
        venueId: bundle.venueId,
        agentId: claims.sub,
        visitDate: bundle.visitDate,
        gpsLat: bundle.gps?.lat,
        gpsLng: bundle.gps?.lng,
        checklist: bundle,
        evidenceMedia: bundle.evidenceMedia,
        identityEvidenceGrade: bundle.identityEvidenceGrade,
        contractRef: bundle.contractRef,
        outcome: "pending",
        syncedFromOffline: true,
      });
      results.push({ bundleId: bundle.bundleId, status: "synced" });
    }
    return reply.send({ results });
  });

  // Ops approves a verification → badge issued, venue data updated (§11.2).
  app.post("/v1/ops/verifications/:id/approve", async (req, reply) => {
    const claims = await authenticate(req);
    requireRole(claims, "ops");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [v] = await db
      .select()
      .from(schema.verifications)
      .where(eq(schema.verifications.id, id))
      .limit(1);
    if (!v) throw new CiaoError("BOOKING_NOT_FOUND");

    const checklist = v.checklist as z.infer<typeof checklistSchema>;
    const amenities = checklist.amenities.map((a) => ({
      ...a,
      verifiedAt: v.visitDate,
    }));
    if (checklist.generatorRunTest?.ran) {
      const idx = amenities.findIndex((a) => a.key === "generator");
      const detail = `${checklist.generatorRunTest.kva ?? "?"} KVA${checklist.generatorRunTest.fuelIncluded ? "، الوقود مشمول" : ""} — شغّله وكيلنا يوم ${v.visitDate}`;
      if (idx >= 0) amenities[idx] = { ...amenities[idx]!, detail };
      else amenities.push({ key: "generator", present: true, detail, verifiedAt: v.visitDate });
    }
    const privacy = checklist.privacy
      ? { ...checklist.privacy, score: privacyScore(checklist.privacy) }
      : undefined;

    await db.transaction(async (tx) => {
      await tx
        .update(schema.verifications)
        .set({ outcome: "approved" })
        .where(eq(schema.verifications.id, id));
      await tx
        .update(schema.venues)
        .set({
          verificationGrade: v.identityEvidenceGrade,
          verifiedAt: new Date(),
          // Re-verification annually (§11.2).
          verificationExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          badgeRevoked: false,
          amenities,
          ...(privacy ? { privacy } : {}),
          ...(v.gpsLat ? { exactLat: v.gpsLat, exactLng: v.gpsLng } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.venues.id, v.venueId));
      await tx.insert(schema.auditLog).values({
        actorId: claims.sub,
        action: "verification.approve",
        targetType: "venue",
        targetId: v.venueId,
        detail: { verificationId: id },
      });
    });
    return reply.send({ ok: true });
  });
}
