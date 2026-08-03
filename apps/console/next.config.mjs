/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ciao/shared"],
  poweredByHeader: false,
  output: "standalone",
  compress: true,
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      /*
       * The control panel is a business tool holding a diary, a client book and
       * a payout destination. None of it should ever be framed by another site,
       * indexed by a search engine, or leak its URLs as referrers — a
       * set-password link in a Referer header is a credential in somebody's
       * access log.
       */
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
