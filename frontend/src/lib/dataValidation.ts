import type {
  Aspect,
  BestMetricsMap,
  Catalog,
  CurvesMap,
  MethodsConfig,
  ReleaseMeta,
  ReleaseMethods,
  Subset,
} from '../types'
import { ASPECTS, SUBSETS } from '../types'

const VALID_ASPECTS = new Set<string>(ASPECTS)
const VALID_SUBSETS = new Set<string>(SUBSETS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function assertString(value: unknown, name: string): string {
  if (!isString(value)) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function assertNumber(value: unknown, name: string): number {
  if (!isNumber(value)) {
    throw new Error(`${name} must be numeric`)
  }
  return value
}

function assertSubset(value: unknown, name: string): Subset {
  const subset = assertString(value, name)
  if (!VALID_SUBSETS.has(subset)) {
    throw new Error(`${name} has invalid subset: ${subset}`)
  }
  return subset as Subset
}

function assertAspect(value: unknown, name: string): Aspect {
  const aspect = assertString(value, name)
  if (!VALID_ASPECTS.has(aspect)) {
    throw new Error(`${name} has invalid aspect: ${aspect}`)
  }
  return aspect as Aspect
}

function assertMetricRange(value: unknown, name: string): number {
  const metric = assertNumber(value, name)
  if (metric < 0 || metric > 1) {
    throw new Error(`${name} must be between 0 and 1`)
  }
  return metric
}

function assertBestKey(key: string): void {
  const [subset, ...aspectParts] = key.split('_')
  const aspect = aspectParts.join('_')
  assertSubset(subset, `${key} subset`)
  assertAspect(aspect, `${key} aspect`)
}

function assertCurveKey(key: string): void {
  const parts = key.split('_')
  const subset = parts[0]
  const methodStart = parts.findIndex((_, index) => index >= 2 && VALID_ASPECTS.has(parts.slice(1, index).join('_')))
  if (methodStart < 0) {
    throw new Error(`${key} is not a valid curve key`)
  }
  const aspect = parts.slice(1, methodStart).join('_')
  const method = parts.slice(methodStart).join('_')
  assertSubset(subset, `${key} subset`)
  assertAspect(aspect, `${key} aspect`)
  assertString(method, `${key} method`)
}

export function validateCatalog(value: unknown): Catalog {
  const catalog = assertRecord(value, 'catalog')
  if (!Array.isArray(catalog.releases)) {
    throw new Error('catalog.releases must be an array')
  }
  if (!Array.isArray(catalog.timepoints)) {
    throw new Error('catalog.timepoints must be an array')
  }
  const timepointDates = assertRecord(catalog.timepointDates, 'catalog.timepointDates')
  catalog.releases.forEach((release, index) => {
    const item = assertRecord(release, `catalog.releases[${index}]`)
    assertString(item.id, `catalog.releases[${index}].id`)
    // Only a GO release is a T0-T1 window with timepoints.
    if ((item.task ?? 'go_whole_protein') === 'go_whole_protein') {
      assertString(item.startTimepoint, `catalog.releases[${index}].startTimepoint`)
      assertString(item.endTimepoint, `catalog.releases[${index}].endTimepoint`)
    }
    if (item.status !== 'ready' && item.status !== 'pending' && item.status !== 'invalid') {
      throw new Error(`catalog.releases[${index}].status is invalid`)
    }
  })
  catalog.timepoints.forEach((timepoint, index) => {
    const timepointLabel = assertString(timepoint, `catalog.timepoints[${index}]`)
    const dates = assertRecord(timepointDates[timepointLabel], `catalog.timepointDates.${timepointLabel}`)
    assertString(dates.goa, `catalog.timepointDates.${timepointLabel}.goa`)
    assertString(dates.uniprot, `catalog.timepointDates.${timepointLabel}.uniprot`)
  })
  assertString(catalog.generatedAt, 'catalog.generatedAt')
  return value as Catalog
}

export function validateMethodsConfig(value: unknown): MethodsConfig {
  const config = assertRecord(value, 'methods config')
  const methods = assertRecord(config.methods, 'methods config.methods')
  assertRecord(config.aspects, 'methods config.aspects')
  assertRecord(config.subsets, 'methods config.subsets')
  Object.entries(methods).forEach(([name, method]) => {
    const item = assertRecord(method, `methods config.methods.${name}`)
    assertString(item.label, `methods config.methods.${name}.label`)
    if (typeof item.description !== 'string') throw new Error(`methods config.methods.${name}.description must be a string`)
    if (typeof item.dockerUrl !== 'string') throw new Error(`methods config.methods.${name}.dockerUrl must be a string`)
    if (typeof item.isBaseline !== 'boolean') throw new Error(`methods config.methods.${name}.isBaseline must be boolean`)
  })
  return value as MethodsConfig
}

export function validateReleaseMeta(value: unknown): ReleaseMeta {
  const meta = assertRecord(value, 'release meta')
  assertString(meta.releaseId, 'release meta.releaseId')
  assertString(meta.startTimepoint, 'release meta.startTimepoint')
  assertString(meta.endTimepoint, 'release meta.endTimepoint')
  const dates = assertRecord(meta.dates, 'release meta.dates')
  assertString(dates.goaStart, 'release meta.dates.goaStart')
  assertString(dates.goaEnd, 'release meta.dates.goaEnd')
  assertString(dates.uniprotStart, 'release meta.dates.uniprotStart')
  assertString(dates.uniprotEnd, 'release meta.dates.uniprotEnd')
  const targetCounts = assertRecord(meta.targetCounts, 'release meta.targetCounts')
  assertNumber(targetCounts.uniqueAcrossSubsets, 'release meta.targetCounts.uniqueAcrossSubsets')
  SUBSETS.forEach((subset) => {
    const counts = assertRecord(targetCounts[subset], `release meta.targetCounts.${subset}`)
    assertNumber(counts.total, `release meta.targetCounts.${subset}.total`)
    assertRecord(counts.byAspect, `release meta.targetCounts.${subset}.byAspect`)
  })
  return value as ReleaseMeta
}

export function validateReleaseMethods(value: unknown): ReleaseMethods {
  const payload = assertRecord(value, 'release methods')
  const methods = assertRecord(payload.methods, 'release methods.methods')
  Object.entries(methods).forEach(([name, method]) => {
    const item = assertRecord(method, `release methods.${name}`)
    assertString(item.filename, `release methods.${name}.filename`)
    assertString(item.label, `release methods.${name}.label`)
    const availability = assertRecord(item.availability, `release methods.${name}.availability`)
    SUBSETS.forEach((subset) => {
      if (typeof availability[subset] !== 'boolean') {
        throw new Error(`release methods.${name}.availability.${subset} must be boolean`)
      }
    })
  })
  return value as ReleaseMethods
}

export function validateBestMetrics(value: unknown): BestMetricsMap {
  const map = assertRecord(value, 'best metrics')
  Object.entries(map).forEach(([key, metrics]) => {
    assertBestKey(key)
    if (!Array.isArray(metrics)) throw new Error(`best metrics.${key} must be an array`)
    metrics.forEach((metric, index) => {
      const item = assertRecord(metric, `best metrics.${key}[${index}]`)
      assertString(item.method, `best metrics.${key}[${index}].method`)
      assertSubset(item.subset, `best metrics.${key}[${index}].subset`)
      assertAspect(item.aspect, `best metrics.${key}[${index}].aspect`)
      assertMetricRange(item.precision, `best metrics.${key}[${index}].precision`)
      assertMetricRange(item.recall, `best metrics.${key}[${index}].recall`)
      assertMetricRange(item.fmax, `best metrics.${key}[${index}].fmax`)
      assertNumber(item.coverage, `best metrics.${key}[${index}].coverage`)
      assertMetricRange(item.threshold, `best metrics.${key}[${index}].threshold`)
      assertNumber(item.n, `best metrics.${key}[${index}].n`)
    })
  })
  return value as BestMetricsMap
}

export function validateCurvesMap(value: unknown): CurvesMap {
  const map = assertRecord(value, 'curves')
  Object.entries(map).forEach(([key, points]) => {
    assertCurveKey(key)
    if (!Array.isArray(points)) throw new Error(`curves.${key} must be an array`)
    points.forEach((point, index) => {
      const item = assertRecord(point, `curves.${key}[${index}]`)
      assertMetricRange(item.tau, `curves.${key}[${index}].tau`)
      assertMetricRange(item.precision, `curves.${key}[${index}].precision`)
      assertMetricRange(item.recall, `curves.${key}[${index}].recall`)
    })
  })
  return value as CurvesMap
}
