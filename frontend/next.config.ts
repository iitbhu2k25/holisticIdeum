// import type { NextConfig } from "next"

// const nextConfig: NextConfig = {
//   images: {
//     remotePatterns: [

//       {
//         protocol: 'https',
//         hostname: 'images.pexels.com',
//         pathname: '/**',
//       },

//     ],
//   },
//   async rewrites() {
//     return [
//       {
//         source: "/assi/:path*",
//         destination: "https://holistic.pythonanywhere.com/assi/:path*",
//       },
//     ]
//   },
// }

// export default nextConfig





import type { NextConfig } from "next"

// Server-side target for rewrites; inside Docker this is the backend service name.
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:9000"

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [

      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/**',
      },

    ],
  },
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/assi/:path*/",
        destination: `${BACKEND_INTERNAL_URL}/assi/:path*/`,
      },
      {
        source: "/assi/:path*",
        destination: `${BACKEND_INTERNAL_URL}/assi/:path*`,
      },
    ]
  },
}

export default nextConfig
