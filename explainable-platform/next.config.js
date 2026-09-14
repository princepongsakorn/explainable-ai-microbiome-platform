module.exports = {
  /* config options here */
  reactStrictMode: true,
  // Next 12 standalone build: produces .next/standalone/server.js with minimal node_modules.
  // Enables a tiny runtime Docker image (no source, no devDeps).
  output: 'standalone',
  publicRuntimeConfig: {
    api: process.env.API,
  },
  // There is no home page: sign-in lands on "/", which used to render empty.
  // The prediction list is where a signed-in visitor is sent from login too.
  async redirects() {
    return [
      { source: '/', destination: '/prediction/prediction', permanent: false },
    ];
  },
};
