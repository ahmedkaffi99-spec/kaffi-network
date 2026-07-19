import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**': ['./lib/assets/fonts/*.ttf'],
  },
}

export default nextConfig
