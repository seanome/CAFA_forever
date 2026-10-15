/**
 * Types for region_transfer releases (task added by the seanome fork).
 * One RegionRow is one tool at one setting, graded against one truth set, raw or
 * deduplicated, against one relative's proteome, in one stratum.
 */

export type TruthSet = 'pfam' | 'pfamn' | 'swissprot'
export type Provenance = 'measured' | 'reported'

export interface RegionRow {
  method: string
  tool: string
  setting: string
  truthSet: TruthSet
  dedup: boolean
  species: string
  speciesMya: number | null
  stratumAxis: string
  stratumBin: string
  /** Fmax: the best F (harmonic mean of precision and recall) over score thresholds */
  fmax: number
  precision: number
  recall: number
  /** score threshold at Fmax; the long tables do not store it */
  threshold: number | null
  /** true instances in this stratum */
  n: number
  auprc: number | null
  /** median overlap / union of a correct call with its true region */
  medianIouTp: number | null
  nTpCalls: number | null
  nFpCalls: number | null
  /** reserved core-hours (cores x wall time) of the search step, per relative searched, per 1,000 query proteins */
  cpuH: number | null
  peakRamGb: number | null
  gpuH: number | null
  provenance: Provenance | null
  costUsdEst: number | null
}

export interface RegionMeta {
  releaseId: string
  task: 'region_transfer'
  title: string
  targetCounts: { ALL: { total: number; byAspect: Record<string, number> } }
  info: Record<string, string>
}

export interface ToolCardStratum {
  axis: string
  stratum: string
  fmax: number
  n: number
  other_tool: string
  other_setting: string
  other_fmax: number
  margin: number
}

/** One tool card, as written by seanome/protein-function-annotation-leaderboard (PR 2). */
export interface ToolCard {
  tool: string
  name: string
  kind: string
  compares: string
  needs: Record<string, boolean>
  reference: string
  score: string
  failure_modes: string[]
  version: string
  container: string
  command: string
  numbers_from: { repo: string; commit: string; filters: string }
  best_setting?: string
  strong?: ToolCardStratum[]
  weak?: ToolCardStratum[]
  questions?: string[]
  [key: string]: unknown
}
