import type { FastifyRequest } from "fastify";
import type { UserRole } from "@ciao/shared";
import { verifyAccessToken, type SessionClaims, type TokenAudience } from "./auth.js";
import { CiaoError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
  }
}

/**
 * Authenticate a request for a given product.
 *
 * The audience defaults to `app`, so every existing consumer route keeps its
 * behaviour untouched and any route that forgets to pass one fails closed on
 * the partner side rather than open.
 */
export async function authenticate(
  req: FastifyRequest,
  audience: TokenAudience = "app",
): Promise<SessionClaims> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new CiaoError("AUTH_REQUIRED");
  const claims = await verifyAccessToken(header.slice(7), audience);
  req.session = claims;
  return claims;
}

const ROLE_RANK: Record<UserRole, number> = {
  guest: 0,
  host: 1,
  agent: 2,
  ops: 3,
  admin: 4,
};

export function requireRole(claims: SessionClaims, min: UserRole): void {
  if (ROLE_RANK[claims.role] < ROLE_RANK[min]) throw new CiaoError("AUTH_FORBIDDEN");
}
