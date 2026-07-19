import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**': ['./lib/assets/fonts/*.woff'],
  },
}

export default nextConfig
