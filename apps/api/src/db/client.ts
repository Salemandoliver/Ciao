import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  // Railway private networking is fine without TLS; public URLs need it.
  ssl: config.databaseUrl.includes("proxy.rlwy.net")
    ? { rejectUnauthorized: false }
    : undefined,
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
