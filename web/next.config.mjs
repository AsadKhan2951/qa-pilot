/** @type {import('next').NextConfig} */
const API = process.env.API_URL ?? "http://localhost:4000";

const nextConfig = {
  output: "standalone",
  // The browser only talks to Next; Next proxies /api/* to the Node backend (same-origin cookies)
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
export default nextConfig;
