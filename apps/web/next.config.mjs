/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ciao/shared"],
  poweredByHeader: false,
  output: "standalone",
  // Low-bandwidth engineering (§12.3): compress, cache immutable assets.
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
