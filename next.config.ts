import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", serverExternalPackages: ["e2b", "@e2b/desktop", "playwright-core", "pg", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"] };
export default config;
