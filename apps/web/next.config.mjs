/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting is run as a dedicated monorepo task (`pnpm lint`), not during build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
