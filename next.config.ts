import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", serverExternalPackages: ["e2b", "@e2b/desktop"], experimental: { cpus: 1 } };
export default config;
