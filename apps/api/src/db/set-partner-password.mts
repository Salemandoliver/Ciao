/**
 * Set a partner's password from the command line.
 *
 * Exists for two jobs that both need doing without a browser: seeding a
 * walkable demo, and the recovery of last resort when a founder is on a call
 * with a partner whose phone has been stolen. It is deliberately a script and
 * not an endpoint — nothing in the running API can set a password on behalf of
 * someone else, which is the property that lets us tell partners nobody at
 * Ciao can get into their account.
 *
 *   pnpm --filter @ciao/api exec tsx src/db/set-partner-password.mts 0914000003 'a-long-password'
 */
import { eq } from "drizzle-orm";
import { normalizePhone } from "@ciao/shared";
import { db, pool, schema } from "./client.js";
import { passwordProblem, setPassword } from "../modules/partner/auth.js";

const [rawPhone, password] = process.argv.slice(2);
if (!rawPhone || !password) {
  console.error("usage: set-partner-password.mts <phone> <password>");
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
// `mustChange` so the first sign-in forces them to pick their own: a password
// somebody else typed is not a password.
await setPassword(user.id, password, { mustChange: true });
console.log(`password set for ${phone} (${user.displayName ?? "—"}) — they must change it on first sign-in`);
await pool.end();
