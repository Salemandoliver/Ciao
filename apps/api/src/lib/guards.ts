import type { FastifyRequest } from "fastify";
import type { UserRole } from "@ciao/shared";
import { verifyAccessToken, type SessionClaims } from "./auth.js";
import { CiaoError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
  }
}

export async function authenticate(req: FastifyRequest): Promise<SessionClaims> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new CiaoError("AUTH_REQUIRED");
  const claims = await verifyAccessToken(header.slice(7));
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
