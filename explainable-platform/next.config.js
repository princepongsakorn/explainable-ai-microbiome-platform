module.exports = {
  /* config options here */
  reactStrictMode: true,
  // Next 12 standalone build: produces .next/standalone/server.js with minimal node_modules.
  // Enables a tiny runtime Docker image (no source, no devDeps).
  output: 'standalone',
  publicRuntimeConfig: {
    api: process.env.API,
  },
};
