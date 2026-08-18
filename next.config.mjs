import createNextIntlPlugin from "next-intl/plugin";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep local production builds out of the dev server's directory. Sharing one .next
  // means running `next build` while `next dev` is live corrupts the dev server's chunk
  // map, and it fails with a baffling "Cannot find module './833.js'".
  //
  // Only locally, though. On Vercel there is no dev server to collide with, and the
  // build pipeline expects the default directory — moving it there buys nothing and
  // risks the output not being found at all.
  distDir: !process.env.VERCEL && process.env.NODE_ENV === "production" ? ".next-build" : ".next",

  // pdf.js reaches for node-canvas when it thinks it is on a server. Everything here is
  // client-side, so keep the bundler from trying to resolve it at all.
  webpack(config, { isServer }) {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing is uploaded, so nothing should be embeddable or framed either.
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
