/**
 * Who may open the business console, and what they may do once inside.
 *
 * Exactly one way in for every `/v1/biz` route, mirroring `partnerContext()`:
 * the token must carry the `biz` audience (so a marketplace or partner session
 * is refused structurally, not by discipline), and the action must be inside
 * the caller's capability set (`bizCan` in `packages/shared/src/biz.ts`).
 *
 * The role is read from the token, and that is safe for one specific reason:
 * console access tokens live fifteen minutes and are only ever re-minted by
 * `rotateBizSession()`, which re-reads `users.role` from the database. A
 * demotion therefore lands within one token lifetime — without paying a
 * users-table read on every request of an internal tool that draws six panels
 * per screen.
 */
import type { FastifyRequest } from "fastify";
import { bizCan, isBizRole, type BizCapability, type BizRole } from "@ciao/shared";
import { authenticate } from "../../lib/guards.js";
import { CiaoError } from "../../lib/errors.js";
import type { SessionClaims } from "../../lib/auth.js";

export interface BizContext {
  /** The team member acting. */
  actorId: string;
  /** Alias of `actorId`, so call sites written against SessionClaims read the same. */
  sub: string;
  role: BizRole;
  claims: SessionClaims;
  can(capability: BizCapability): boolean;
  /** Throws AUTH_FORBIDDEN unless the actor holds the capability. */
  require(capability: BizCapability): void;
}

export async function bizContext(req: FastifyRequest): Promise<BizContext> {
  const claims = await authenticate(req, "biz");
  /*
   * A `biz` token is only ever minted for a console role, but the check stays:
   * if that invariant is ever broken upstream, this fails closed rather than
   * letting a role the matrix has never heard of through with a default.
   */
  if (!isBizRole(claims.role)) throw new CiaoError("AUTH_FORBIDDEN");
  const role = claims.role;
  return {
    actorId: claims.sub,
    sub: claims.sub,
    role,
    claims,
    can: (capability) => bizCan(role, capability),
    require(capability) {
      if (!bizCan(role, capability)) throw new CiaoError("AUTH_FORBIDDEN");
    },
  };
}

/** The common shape: authenticate, then demand one capability. */
export async function bizGuard(
  req: FastifyRequest,
  capability: BizCapability,
): Promise<BizContext> {
  const ctx = await bizContext(req);
  ctx.require(capability);
  return ctx;
}
