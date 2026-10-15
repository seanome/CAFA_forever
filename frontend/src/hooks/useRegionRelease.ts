import { useEffect, useState } from 'react'
import type { RegionMeta, RegionRow, ToolCard } from '../types'
import { siteUrl } from '../lib/basePath'

interface RegionData {
  meta: RegionMeta | null
  rows: RegionRow[]
}

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be numeric`)
  return value
}

function numOrNull(value: unknown, name: string): number | null {
  return value === null || value === undefined ? null : num(value, name)
}

/** Turn best.json of a region_transfer release into one flat list of rows, checked. */
export function flattenRegionBest(best: Record<string, unknown[]>): RegionRow[] {
  const rows: RegionRow[] = []
  for (const [key, entries] of Object.entries(best)) {
    if (!Array.isArray(entries)) throw new Error(`best.${key} must be an array`)
    entries.forEach((raw, i) => {
      const e = raw as Record<string, unknown>
      const at = `best.${key}[${i}]`
      if (e.task !== 'region_transfer') throw new Error(`${at}.task must be region_transfer`)
      rows.push({
        method: String(e.method),
        tool: String(e.tool),
        setting: String(e.setting),
        truthSet: String(e.truthSet) as RegionRow['truthSet'],
        dedup: Boolean(e.dedup),
        species: String(e.species),
        speciesMya: numOrNull(e.speciesMya, `${at}.speciesMya`),
        stratumAxis: String(e.stratumAxis),
        stratumBin: String(e.stratumBin),
        fmax: num(e.fmax, `${at}.fmax`),
        precision: num(e.precision, `${at}.precision`),
        recall: num(e.recall, `${at}.recall`),
        threshold: num(e.threshold, `${at}.threshold`),
        n: num(e.n, `${at}.n`),
        auprc: numOrNull(e.auprc, `${at}.auprc`),
        medianIouTp: numOrNull(e.medianIouTp, `${at}.medianIouTp`),
        nTpCalls: numOrNull(e.nTpCalls, `${at}.nTpCalls`),
        nFpCalls: numOrNull(e.nFpCalls, `${at}.nFpCalls`),
        cpuH: numOrNull(e.cpuH, `${at}.cpuH`),
        peakRamGb: numOrNull(e.peakRamGb, `${at}.peakRamGb`),
        gpuH: numOrNull(e.gpuH, `${at}.gpuH`),
        provenance: (e.provenance ?? null) as RegionRow['provenance'],
        costUsdEst: numOrNull(e.costUsdEst, `${at}.costUsdEst`),
      })
    })
  }
  return rows
}

export function useRegionRelease(releaseId: string | null) {
  const [data, setData] = useState<RegionData>({ meta: null, rows: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!releaseId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const base = siteUrl(`data/releases/${releaseId}`)
    Promise.all([
      fetch(`${base}/meta.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`meta.json: ${r.status}`)
        return r.json()
      }),
      fetch(`${base}/best.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`best.json: ${r.status}`)
        return r.json()
      }),
    ])
      .then(([meta, best]) => {
        if (cancelled) return
        if (meta.task !== 'region_transfer') throw new Error(`${releaseId} is not a region_transfer release`)
        setData({ meta: meta as RegionMeta, rows: flattenRegionBest(best) })
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [releaseId])

  return { ...data, loading, error }
}

export function useToolCards() {
  const [cards, setCards] = useState<Record<string, ToolCard>>({})
  useEffect(() => {
    let cancelled = false
    fetch(siteUrl('data/tools/index.json'))
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((index: { tools: string[] }) =>
        Promise.all(index.tools.map((t) => fetch(siteUrl(`data/tools/${t}.json`)).then((r) => r.json()))),
      )
      .then((list: ToolCard[]) => {
        if (!cancelled) setCards(Object.fromEntries(list.map((c) => [c.tool, c])))
      })
      .catch(() => {
        if (!cancelled) setCards({})
      })
    return () => {
      cancelled = true
    }
  }, [])
  return cards
}
