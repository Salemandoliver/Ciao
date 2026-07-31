import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function main() {
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
