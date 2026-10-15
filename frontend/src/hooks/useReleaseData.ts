import { siteUrl } from '../lib/basePath'
import { useState, useEffect, useCallback } from 'react'
import type {
  ReleaseMeta,
  ReleaseMethods,
  BestMetricsMap,
  CurvesMap,
  MethodsConfig,
} from '../types'
import {
  validateBestMetrics,
  validateCurvesMap,
  validateMethodsConfig,
  validateReleaseMeta,
  validateReleaseMethods,
} from '../lib/dataValidation'

interface ReleaseData {
  meta: ReleaseMeta | null
  methods: ReleaseMethods | null
  best: BestMetricsMap | null
  curves: CurvesMap | null
}

interface UseReleaseDataResult {
  data: ReleaseData
  loading: boolean
  error: string | null
  loadCurves: () => Promise<void>
  curvesLoading: boolean
}

/**
 * Hook to load release-specific data
 * Loads meta, methods, and best metrics immediately
 * Curves are loaded on demand via loadCurves() due to their size
 */
export function useReleaseData(releaseId: string | null): UseReleaseDataResult {
  const [data, setData] = useState<ReleaseData>({
    meta: null,
    methods: null,
    best: null,
    curves: null,
  })
  const [loading, setLoading] = useState(false)
  const [curvesLoading, setCurvesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load essential data when releaseId changes
  useEffect(() => {
    if (!releaseId) {
      setData({ meta: null, methods: null, best: null, curves: null })
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchData() {
      try {
        const basePath = siteUrl(`data/releases/${releaseId}`)

        const [metaRes, methodsRes, bestRes] = await Promise.all([
          fetch(`${basePath}/meta.json`, { cache: 'no-store' }),
          fetch(`${basePath}/methods.json`, { cache: 'no-store' }),
          fetch(`${basePath}/best.json`, { cache: 'no-store' }),
        ])

        if (!metaRes.ok || !methodsRes.ok || !bestRes.ok) {
          throw new Error('Failed to load release data')
        }

        const [metaRaw, methodsRaw, bestRaw] = await Promise.all([
          metaRes.json(),
          methodsRes.json(),
          bestRes.json(),
        ])
        const meta = validateReleaseMeta(metaRaw)
        const methods = validateReleaseMethods(methodsRaw)
        const best = validateBestMetrics(bestRaw)

        if (!cancelled) {
          setData((prev) => ({ ...prev, meta, methods, best }))
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [releaseId])

  // Lazy load curves data
  const loadCurves = useCallback(async () => {
    if (!releaseId || data.curves) return

    setCurvesLoading(true)
    try {
      const response = await fetch(siteUrl(`data/releases/${releaseId}/curves.json`), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Failed to load curves data')
      }
      const curves = validateCurvesMap(await response.json())
      setData((prev) => ({ ...prev, curves }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load curves')
    } finally {
      setCurvesLoading(false)
    }
  }, [releaseId, data.curves])

  return { data, loading, error, loadCurves, curvesLoading }
}

/**
 * Hook to load global methods configuration
 */
export function useMethodsConfig() {
  const [config, setConfig] = useState<MethodsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchConfig() {
      try {
        const response = await fetch(siteUrl('data/methods.json'), { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Failed to load methods config')
        }
        const data = validateMethodsConfig(await response.json())
        if (!cancelled) {
          setConfig(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    fetchConfig()

    return () => {
      cancelled = true
    }
  }, [])

  return { config, loading, error }
}
