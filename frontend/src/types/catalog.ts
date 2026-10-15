/**
 * Types for catalog.json - global release listing
 */

export interface ReleaseEntry {
  id: string
  startTimepoint: string
  endTimepoint: string
  status: 'ready' | 'pending' | 'invalid'
  /** go_whole_protein (LAFA's releases) or region_transfer; absent means GO */
  task?: TaskId
  title?: string
}

export type TaskId = 'go_whole_protein' | 'region_transfer'

export function releaseTask(release: ReleaseEntry): TaskId {
  return release.task ?? 'go_whole_protein'
}

export interface TimepointDates {
  goa: string
  uniprot: string
}

export interface Catalog {
  releases: ReleaseEntry[]
  invalidReleases?: Record<string, string[]>
  timepoints: string[]
  timepointDates: Record<string, TimepointDates>
  generatedAt: string
}
