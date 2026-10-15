import { siteUrl } from '../lib/basePath'
import { useState, useEffect } from 'react'
import type { Catalog } from '../types'
import { validateCatalog } from '../lib/dataValidation'

interface UseCatalogResult {
  catalog: Catalog | null
  loading: boolean
  error: string | null
}

export function useCatalog(): UseCatalogResult {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchCatalog() {
      try {
        const response = await fetch(siteUrl('data/catalog.json'), { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Failed to load catalog: ${response.status}`)
        }
        const data = validateCatalog(await response.json())
        if (!cancelled) {
          setCatalog(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    fetchCatalog()

    return () => {
      cancelled = true
    }
  }, [])

  return { catalog, loading, error }
}
