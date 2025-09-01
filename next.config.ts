/** @type {import('next').NextConfig} */
const gatewayUrl =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://gateway.pinata.cloud";
const { hostname: ipfsHostname, protocol: ipfsProtocol } = new URL(gatewayUrl);

const nextConfig = {
  experimental: {
    // appDir is default in Next 13+, placeholder for future flags
  },
  env: {
    NEXT_PUBLIC_IPFS_GATEWAY: gatewayUrl,
  },
  images: {
    remotePatterns: [
      {
        protocol: ipfsProtocol.replace(":", ""),
        hostname: ipfsHostname,
        pathname: "/ipfs/**",
      },
    ],
  },
};

module.exports = nextConfig;
