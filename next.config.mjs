/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fail the build on type or lint errors. A backend whose invariants are enforced
  // by the type system must not ship with those checks disabled.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  experimental: {
    // Keep Node-only modules (crypto, server-only token handling) out of any
    // client bundle that might accidentally import a server module.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
