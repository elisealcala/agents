import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Webpack avoids Turbopack's build-time local port requirement in restricted hosts.
export default {
  ...defineCloudflareConfig(),
  buildCommand: "pnpm exec next build --webpack",
};
