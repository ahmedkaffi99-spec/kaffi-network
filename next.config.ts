import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // Chargés via readFileSync avec un chemin construit dynamiquement — le
    // traçage automatique de Next.js ne les détecte pas, il faut les
    // inclure explicitement dans le bundle serverless (même problème déjà
    // rencontré avec les polices).
    '/api/**': ['./lib/assets/fonts/*.woff', './node_modules/flag-icons/flags/4x3/*.svg'],
  },
}

export default nextConfig
