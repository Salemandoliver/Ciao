/**
 * Passkeys (WebAuthn).
 *
 * Why this matters in Libya specifically: OTP is our identity system, and OTP
 * is the weakest part of it. Every login costs a WhatsApp conversation or an
 * SMS, needs signal at the moment of use, and fails outright during the
 * network outages that are routine here (§12.1). A passkey is a fingerprint on
 * a phone that already has the key in its secure element — no message, no
 * signal, no cost. That is worth building before the wallet holds real money,
 * not after.
 *
 * Design notes:
 *  - The private key never leaves the device. We hold a public key, which is
 *    useless to whoever steals this table.
 *  - Registration requires an existing session, so a passkey is always added
 *    by someone who already proved the phone number. Passkeys augment OTP;
 *    they never replace the first proof of identity.
 *  - Challenges are single-use and short-lived, stored in `action_tokens`
 *    alongside every other one-shot token in the system rather than in a new
 *    parallel mechanism.
 *  - The signature counter is checked on every login. A counter that goes
 *    backwards means a cloned authenticator, and we refuse.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";
import { config } from "../../config.js";

/**
 * The relying party is the site's registered domain. It must match the origin
 * the browser is on or the ceremony fails — which is exactly the anti-phishing
 * property we want, and also the thing that will break the day ciao.ly goes
 * live if this is hardcoded. So derive it from config.
 */
function relyingParty() {
  const url = new URL(config.webBaseUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: "Ciao — تشاو" };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function storeChallenge(userId: string | null, challenge: string): Promise<void> {
  await db.insert(schema.actionTokens).values({
    jti: randomUUID(),
    scope: `webauthn:${challenge}`,
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/** Consume a challenge, refusing replays and expiries. */
async function takeChallenge(challenge: string): Promise<{ userId: string | null }> {
  const [row] = await db
    .select()
    .from(schema.actionTokens)
    .where(
      and(
        eq(schema.actionTokens.scope, `webauthn:${challenge}`),
        isNull(schema.actionTokens.consumedAt),
        gt(schema.actionTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) throw new CiaoError("AUTH_REQUIRED", "challenge_expired");
  await db
    .update(schema.actionTokens)
    .set({ consumedAt: new Date() })
    .where(eq(schema.actionTokens.jti, row.jti));
  return { userId: row.userId };
}

export async function registrationOptions(userId: string) {
  const { rpID, rpName } = relyingParty();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new CiaoError("AUTH_REQUIRED");

  const existing = await db
    .select({ credentialId: schema.webauthnCredentials.credentialId })
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.userId, userId));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(user.id),
    // Shown on the device's own prompt. The phone number is what a Libyan user
    // recognises as their identity here — not an email they may not have.
    userName: user.phone,
    userDisplayName: user.displayName ?? user.phone,
    attestationType: "none", // we don't need to know the manufacturer
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred", // fingerprint / face / device PIN
    },
  });

  await storeChallenge(userId, options.challenge);
  return options;
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string,
) {
  const { rpID, origin } = relyingParty();
  const challenge = response.response.clientDataJSON
    ? JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString()).challenge
    : "";
  const stored = await takeChallenge(challenge);
  if (stored.userId !== userId) throw new CiaoError("AUTH_FORBIDDEN");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo)
    throw new CiaoError("AUTH_REQUIRED", "registration_failed");

  const { credential } = verification.registrationInfo;
  await db.insert(schema.webauthnCredentials).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: response.response.transports ?? [],
    deviceLabel: deviceLabel?.slice(0, 60) ?? null,
  });

  return { verified: true };
}

/**
 * Login options. Deliberately does NOT take a user id: asking "which account?"
 * before the fingerprint leaks whether a phone number is registered. The
 * resident key on the device tells us who it is after the ceremony.
 */
export async function authenticationOptions() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  await storeChallenge(null, options.challenge);
  return options;
}

export async function verifyAuthentication(response: AuthenticationResponseJSON) {
  const { rpID, origin } = relyingParty();
  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString(),
  ).challenge as string;
  await takeChallenge(challenge);

  const [cred] = await db
    .select()
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.credentialId, response.id))
    .limit(1);
  if (!cred) throw new CiaoError("AUTH_REQUIRED", "unknown_passkey");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
      counter: cred.counter,
    },
  });
  if (!verification.verified) throw new CiaoError("AUTH_REQUIRED", "passkey_rejected");

  // A counter that fails to advance is the signature of a cloned
  // authenticator. Some platform authenticators legitimately stay at 0, so we
  // only refuse when a previously-counting credential goes backwards.
  const next = verification.authenticationInfo.newCounter;
  if (cred.counter > 0 && next <= cred.counter)
    throw new CiaoError("AUTH_FORBIDDEN", "possible_cloned_authenticator");

  await db
    .update(schema.webauthnCredentials)
    .set({ counter: next, lastUsedAt: new Date() })
    .where(eq(schema.webauthnCredentials.id, cred.id));

  return { userId: cred.userId };
}

export async function listPasskeys(userId: string) {
  const rows = await db
    .select({
      id: schema.webauthnCredentials.id,
      deviceLabel: schema.webauthnCredentials.deviceLabel,
      createdAt: schema.webauthnCredentials.createdAt,
      lastUsedAt: schema.webauthnCredentials.lastUsedAt,
    })
    .from(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.userId, userId));
  return rows;
}

export async function deletePasskey(userId: string, id: string) {
  await db
    .delete(schema.webauthnCredentials)
    .where(and(eq(schema.webauthnCredentials.id, id), eq(schema.webauthnCredentials.userId, userId)));
}
