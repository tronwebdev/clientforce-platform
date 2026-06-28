/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Linting is run as a dedicated monorepo task (`pnpm lint`), not during build.
  eslint: { ignoreDuringBuilds: true },
  // Standalone server output for a slim container image (T7).
  output: "standalone",
};

export default nextConfig;
