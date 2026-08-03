/**
 * Ciao Business console — team roles and capabilities.
 *
 * Same philosophy as the partner matrix in `partner.ts`, and kept in `shared`
 * for the same reason: the console makes the same judgements the server does —
 * which tabs to draw, whether a person may reach the money screen — and two
 * copies of "can this role see the ledger" is the kind of drift that becomes a
 * security bug rather than a cosmetic one.
 *
 * Three roles, deliberately coarse:
 *
 *  - `admin`   — everything, including the actions that change what guests are
 *                charged and who holds power: settings writes, role changes,
 *                promo creation, partner settlement, team invites.
 *  - `ops`     — the daily work of running the marketplace: onboarding,
 *                catalogue, media, loyalty, the overview, the audit trail.
 *                Ops can see money; ops cannot change the rules of money.
 *  - `finance` — the books and nothing else. An accountant needs the ledger,
 *                the exports and the trail of who changed what; they do not
 *                need the power to onboard a chalet or edit a listing, and a
 *                role that carries powers its holder never uses is attack
 *                surface with no product behind it.
 */
export type BizRole = "admin" | "ops" | "finance";

export const BIZ_ROLES: BizRole[] = ["admin", "ops", "finance"];

export function isBizRole(role: string | null | undefined): role is BizRole {
  return role === "admin" || role === "ops" || role === "finance";
}

/**
 * What a capability means, in terms of the screens it opens:
 *
 *  - `overview`  — the morning screen: money summary, demand, supply health.
 *  - `catalogue` — businesses, listings, media, onboarding, partner invites.
 *  - `finance`   — the ledger screens and CSV exports.
 *  - `people`    — the user list (viewing; role changes are `govern`).
 *  - `marketing` — loyalty programme and promo codes (creation is `govern`).
 *  - `settings`  — reading the control plane (writing is `govern`).
 *  - `audit`     — the read-only trail of who changed what.
 *  - `govern`    — the admin-only actions: settings writes, role changes,
 *                  promo creation, partner settlement, console team invites.
 */
export type BizCapability =
  | "overview"
  | "catalogue"
  | "finance"
  | "people"
  | "marketing"
  | "settings"
  | "audit"
  | "govern";

const CAPABILITIES: Record<BizRole, BizCapability[]> = {
  admin: [
    "overview",
    "catalogue",
    "finance",
    "people",
    "marketing",
    "settings",
    "audit",
    "govern",
  ],
  ops: ["overview", "catalogue", "finance", "people", "marketing", "settings", "audit"],
  finance: ["overview", "finance", "audit"],
};

export function bizCan(role: string, capability: BizCapability): boolean {
  if (!isBizRole(role)) return false;
  return CAPABILITIES[role].includes(capability);
}

export function bizCapabilitiesFor(role: string): BizCapability[] {
  return isBizRole(role) ? CAPABILITIES[role] : [];
}
