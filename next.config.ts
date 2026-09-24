import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", serverExternalPackages: ["e2b", "@e2b/desktop", "playwright-core"] };
export default config;
