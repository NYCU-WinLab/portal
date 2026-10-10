import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // No cacheComponents: every page reads the session, so nothing here
  // prerenders, and the model would only ask for Suspense around each read.
  output: "standalone",
  // Trip files (up to 10 MB) and menu photos reach the server as base64 in
  // a server action, a third larger than the file.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
