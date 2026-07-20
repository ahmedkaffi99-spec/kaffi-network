'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <span className="text-4xl mb-4 block">⚠️</span>
        <h1 className="text-lg font-semibold text-white mb-2">Une erreur est survenue</h1>
        <p className="text-sm text-gray-500 mb-6">
          {error.message || "Le dashboard n'a pas pu charger cette page."}
        </p>
        <Button variant="primary" onClick={reset}>
          Réessayer
        </Button>
      </div>
    </div>
  )
}
