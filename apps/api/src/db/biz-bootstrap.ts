/**
 * Env-gated bootstrap for the FIRST business-console credential.
 *
 * The console's invite flow needs a console session, and the CLI needs a shell
 * that can reach the production database — which a founder deploying from the
 * Railway dashboard does not have. This is the third door, and it is still on
 * the trusted side of the line: whoever can set environment variables on the
 * API service already owns the database the credential protects.
 *
 * Contract, deliberately narrow:
 *  - Runs once per boot, only when BIZ_BOOTSTRAP_PHONE and
 *    BIZ_BOOTSTRAP_PASSWORD are both set.
 *  - Refuses a user who does not exist or does not already hold a console
 *    role — like the CLI, it grants credentials, never roles.
 *  - Refuses to overwrite: if the user already has a console credential, it
 *    logs and does nothing, so a forgotten env var cannot be used to reset
 *    anyone's password later. Resetting is the console's own job.
 *  - The password lands `mustChange`, because it sat in an env var somebody
 *    else could read — the first sign-in forces a real one.
 *
 * After the first sign-in, delete both variables. They are inert once the
 *  credential exists, but a plaintext password should not outlive its minute
 * of usefulness.
 */
import { eq } from "drizzle-orm";
import { isBizRole, normalizePhone } from "@ciao/shared";
import { db, schema } from "./client.js";
import { passwordProblem } from "../lib/passwords.js";
import { hasBizPassword, setBizPassword } from "../modules/business/auth.js";

export async function bootstrapBizCredential(
  log: { info: (o: object | string, msg?: string) => void; warn: (o: object | string, msg?: string) => void },
): Promise<void> {
  const rawPhone = process.env.BIZ_BOOTSTRAP_PHONE;
  const password = process.env.BIZ_BOOTSTRAP_PASSWORD;
  if (!rawPhone || !password) return;

  try {
    const phone = normalizePhone(rawPhone);
    const problem = passwordProblem(password, phone);
    if (problem) {
      log.warn({ problem }, "biz bootstrap: refused — password too weak");
      return;
    }
    const [user] = await db
      .select({ id: schema.users.id, role: schema.users.role, disabled: schema.users.disabled })
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);
    if (!user || user.disabled) {
      log.warn({ phone }, "biz bootstrap: refused — no such user");
      return;
    }
    if (!isBizRole(user.role)) {
      log.warn({ phone, role: user.role }, "biz bootstrap: refused — not a console role");
      return;
    }
    if (await hasBizPassword(user.id)) {
      // Inert on purpose: this path creates the first credential and never
      // resets one, so the env var cannot become a standing backdoor.
      log.info({ phone }, "biz bootstrap: credential already exists — nothing to do (you can delete the BIZ_BOOTSTRAP_* vars)");
      return;
    }
    await setBizPassword(user.id, password, { mustChange: true });
    await db.insert(schema.auditLog).values({
      actorId: user.id,
      action: "biz.password.bootstrapped",
      targetType: "biz_user",
      targetId: user.id,
      detail: { via: "env" },
    });
    log.info(
      { phone },
      "biz bootstrap: first console credential created (mustChange) — sign in, change the password, then DELETE the BIZ_BOOTSTRAP_* vars",
    );
  } catch (err) {
    // Bootstrap must never take the API down with it.
    log.warn({ err: String(err) }, "biz bootstrap: failed");
  }
}
