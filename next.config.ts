import type { NextConfig } from "next";
import { LOCALES, DEFAULT_LOCALE } from "./app/i18n/locales";
// Language editions: /<code>/… serves the page at /…. The rewrite is internal (proxy.ts only tags the request
// with x-rw-locale; a rewrite in proxy.ts would be proxied as an external https request behind the load balancer).
const codes = LOCALES.map(l => l.code).filter(c => c !== DEFAULT_LOCALE).join("|");
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["e2b", "@e2b/desktop", "playwright-core", "pg", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  async rewrites() {
    return { beforeFiles: [
      { source: `/:lang(${codes})`, destination: "/" },
      { source: `/:lang(${codes})/:path*`, destination: "/:path*" },
    ], afterFiles: [], fallback: [] };
  },
};
export default config;
