/**
 * Who is allowed to act as which partner, and what they may do once they are.
 *
 * Every partner endpoint goes through `partnerContext()`. That is the point of
 * the file: the previous host surface checked ownership ad hoc, listing by
 * listing, and an ad-hoc check is one someone forgets to write on the route
 * added at 1am. Here there is exactly one way in, it always resolves both the
 * partner being acted on *and* the caller's role over them, and it fails
 * closed.
 *
 * The `partnerId` query parameter is the part that needs care. A team member
 * may act for a business that is not their own account, so the caller can name
 * one — which makes it a classic IDOR surface. It is only ever honoured after
 * a live `partner_team` row is found for that pair, and never for the caller's
 * own id by implication.
 */
import { and, eq, isNull } from "drizzle-orm";
import { partnerCan, type PartnerCapability, type PartnerRole } from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { authenticate } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import type { FastifyRequest } from "fastify";
import type { SessionClaims } from "../../lib/auth.js";

export interface PartnerContext {
  /** The business being acted on — whose jobs, money and calendar these are. */
  partnerId: string;
  /** The human doing the acting. Not the same person when a manager is working. */
  actorId: string;
  role: PartnerRole;
  claims: SessionClaims;
  can(capability: PartnerCapability): boolean;
  /** Throws AUTH_FORBIDDEN unless the actor holds the capability. */
  require(capability: PartnerCapability): void;
}

/**
 * Businesses this user can act for: their own, plus any team they are on.
 *
 * "Their own" is anything they host — resolved from venues rather than from a
 * `partner_profiles` row, because a host seeded before this console existed
 * has venues and no profile, and they must not be locked out of their own
 * bookings by a missing settings row.
 */
export async function partnerMemberships(
  userId: string,
): Promise<{ partnerId: string; role: PartnerRole; ownName: boolean }[]> {
  const out: { partnerId: string; role: PartnerRole; ownName: boolean }[] = [
    { partnerId: userId, role: "owner", ownName: true },
  ];
  const teams = await db
    .select()
    .from(schema.partnerTeam)
    .where(
      and(
        eq(schema.partnerTeam.memberUserId, userId),
        isNull(schema.partnerTeam.disabledAt),
      ),
    );
  for (const t of teams) {
    if (t.partnerId === userId) continue; // owner row for self is already above
    out.push({ partnerId: t.partnerId, role: t.role as PartnerRole, ownName: false });
  }
  return out;
}

/**
 * Resolve the partner context for a request.
 *
 * With no `partnerId` the caller acts for themselves. With one, membership is
 * checked before anything else happens — and the failure is AUTH_FORBIDDEN
 * rather than "not found", because distinguishing the two would let anyone
 * enumerate which user ids are partners.
 */
export async function partnerContext(
  req: FastifyRequest,
  partnerIdParam?: string | null,
): Promise<PartnerContext> {
  const claims = await authenticate(req);
  let partnerId = claims.sub;
  let role: PartnerRole = "owner";

  if (partnerIdParam && partnerIdParam !== claims.sub) {
    const [membership] = await db
      .select()
      .from(schema.partnerTeam)
      .where(
        and(
          eq(schema.partnerTeam.partnerId, partnerIdParam),
          eq(schema.partnerTeam.memberUserId, claims.sub),
          isNull(schema.partnerTeam.disabledAt),
        ),
      )
      .limit(1);
    if (!membership) throw new CiaoError("AUTH_FORBIDDEN");
    partnerId = partnerIdParam;
    role = membership.role as PartnerRole;
  }

  return {
    partnerId,
    actorId: claims.sub,
    role,
    claims,
    can: (capability) => partnerCan(role, capability),
    require(capability) {
      if (!partnerCan(role, capability)) throw new CiaoError("AUTH_FORBIDDEN");
    },
  };
}

/**
 * The listings this partner supplies. Used to scope every calendar and
 * pricing write, so a job or a block can never land on someone else's chalet.
 */
export async function partnerListingIds(partnerId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
    .where(eq(schema.venues.hostId, partnerId));
  return rows.map((r) => r.id);
}

/** Throw unless the listing belongs to this partner. */
export async function assertPartnerOwnsListing(
  partnerId: string,
  listingId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
    .where(and(eq(schema.listings.id, listingId), eq(schema.venues.hostId, partnerId)))
    .limit(1);
  if (!row) throw new CiaoError("AUTH_FORBIDDEN");
}

/**
 * Fetch a row that belongs to a partner, or refuse.
 *
 * Written as one helper because "select by id, then check the owner matches"
 * is the shape of every object-level authorisation bug ever written — the
 * check gets skipped, or it gets written after the row is already in the
 * response. Callers here cannot get the row without the check.
 */
export async function ownedRow<T extends { partnerId: string }>(
  rows: T[],
  partnerId: string,
): Promise<T> {
  const row = rows[0];
  if (!row || row.partnerId !== partnerId) throw new CiaoError("AUTH_FORBIDDEN");
  return row;
}
