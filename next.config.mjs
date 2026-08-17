/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin this project as the workspace root; the folders above it are unrelated.
  turbopack: { root: import.meta.dirname },

  // Bundles a self-contained server for container deploys (`node server.js`).
  output: "standalone",

  // Editor scaffolding has no business in a production image.
  agentRules: false,
};

export default nextConfig;
