import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // No cacheComponents: every page reads the session, so nothing here
  // prerenders, and the model would only ask for Suspense around each read.
  output: "standalone",
  // Trip files (up to 10 MB) and menu photos reach the server as base64 in
  // a server action, a third larger than the file.
  // authInterrupts: forbidden() renders app/forbidden.tsx with a 403.
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
    authInterrupts: true,
  },
  // Rooms became part of Meetings; /rooms/join/<id> stays, it is in invites.
  async redirects() {
    return [
      { source: "/rooms", destination: "/meetings", permanent: true },
      { source: "/rooms/series", destination: "/meetings", permanent: true },
    ]
  },
  // No page is meant to be framed: the consent pages above all.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },
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
