/** @type {import('next').NextConfig} */
const withBundleAnalyzer = process.env.ANALYZE === "true"
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (config) => config;

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.nga.178.com' },
      { protocol: 'https', hostname: 'img4.nga.178.com' },
      { protocol: 'https', hostname: 'img.nga.cn' },
      { protocol: 'https', hostname: 'img4.ngacn.cc' },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'playwright'],
    instrumentationHook: true,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

module.exports = withBundleAnalyzer(nextConfig);
