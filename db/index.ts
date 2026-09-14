import { env } from "@/server/runtime";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
// The SQLite adapter preserves the prepared-query interface used by Drizzle.
export function getDb() { return drizzle(env.DB, { schema }); }
