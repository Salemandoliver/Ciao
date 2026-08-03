/**
 * Set a business-console password from the command line.
 *
 * This is how the FIRST console account comes into existence: the invite
 * endpoint requires a console session, so someone has to be let in from the
 * side that is already trusted with everything — the shell next to the
 * database. After that, invites happen in the console's People screen.
 *
 * Deliberately a script and not an endpoint, for the same reason as the
 * partner one: nothing in the running API can set a password on someone's
 * behalf. The user must already hold a console role (admin / ops / finance);
 * this script grants credentials, never roles.
 *
 *   pnpm --filter @ciao/api exec tsx src/db/set-biz-password.mts 0910000001 'a-long-password'
 */
import { eq } from "drizzle-orm";
import { isBizRole, normalizePhone } from "@ciao/shared";
import { db, pool, schema } from "./client.js";
import { passwordProblem } from "../lib/passwords.js";
import { setBizPassword } from "../modules/business/auth.js";

const [rawPhone, password] = process.argv.slice(2);
if (!rawPhone || !password) {
  console.error("usage: set-biz-password.mts <phone> <password>");
  process.exit(1);
}
const phone = normalizePhone(rawPhone);
const problem = passwordProblem(password, phone);
if (problem) {
  console.error(`refused: password is ${problem}`);
  process.exit(1);
}
const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
if (!user) {
  console.error(`no user with phone ${phone}`);
  process.exit(1);
}
if (!isBizRole(user.role)) {
  console.error(
    `refused: ${phone} has role '${user.role}', not a console role (admin/ops/finance). ` +
      `Grant the role first — this script sets credentials, never roles.`,
  );
  process.exit(1);
}
// `mustChange` so the first sign-in forces them to pick their own: a password
// somebody else typed is not a password.
await setBizPassword(user.id, password, { mustChange: true });
console.log(
  `console password set for ${phone} (${user.displayName ?? "—"}, ${user.role}) — they must change it on first sign-in`,
);
await pool.end();
