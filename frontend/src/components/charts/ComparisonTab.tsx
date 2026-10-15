import { useMemo, useState, Fragment } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { ComparisonFacet } from './ComparisonFacet'
import type { ComparisonData } from '../../hooks/useComparisonData'
import type { Aspect, ComparisonSummaryRow, SelectedReleaseBundle, Subset } from '../../types'
import {
  ASPECTS,
  ASPECT_LABELS,
  ASPECT_SHORT,
  SUBSETS,
  SUBSET_LABELS,
  makeBestKey,
} from '../../types'
import { InfoIcon } from '../ui'
import './ComparisonTab.css'

interface ComparisonTabProps {
  comparisonData: ComparisonData
  releaseBundles: SelectedReleaseBundle[]
  windowALabel: string
  windowBLabel: string
  selectedMethods: string[]
  loading?: boolean
}

const METRICS = [
  { key: 'fmax', label: 'F-max' },
  { key: 'precision', label: 'Precision' },
  { key: 'recall', label: 'Recall' },
  { key: 'coverage', label: 'Coverage' },
] as const

const RELEASE_COLORS = ['var(--window-a)', 'var(--window-b)']

interface ComparisonTargetValue {
  total: number
  aspects: Record<Aspect, number>
  releaseLabel: string
}

interface ComparisonTargetRow {
  subset: string
  subsetKey: Subset
  releases: Record<string, ComparisonTargetValue>
  [releaseId: string]: string | Subset | Record<string, ComparisonTargetValue> | number
}

interface ComparisonMethodValue {
  avgFmax: number
  scores: Record<string, number>
  releaseLabel: string
}

interface ComparisonMethodRow {
  method: string
  releases: Record<string, ComparisonMethodValue>
  [releaseId: string]: string | Record<string, ComparisonMethodValue> | number
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits))
}

function buildSummaryRows(
  releaseBundles: SelectedReleaseBundle[],
  selectedMethods: string[]
): ComparisonSummaryRow[] {
  return releaseBundles.flatMap((bundle) =>
    SUBSETS.flatMap((subset) =>
      ASPECTS.flatMap((aspect) => {
        const key = makeBestKey(subset, aspect)
        const metrics = bundle.best[key] || []
        const groundTruthTargets = bundle.meta.targetCounts[subset].byAspect[aspect] ?? 0

        return selectedMethods.flatMap((method) => {
          const row = metrics.find((metric) => metric.method === method)
          if (!row) return []

          const targetCoveragePct = groundTruthTargets
            ? (row.n / groundTruthTargets) * 100
            : 0

          return [{
            release: bundle.releaseId,
            subset,
            aspect: ASPECT_LABELS[aspect],
            method,
            targetsPredicted: row.n,
            groundTruthTargets,
            targetCoveragePct: round(targetCoveragePct, 1),
            precision: round(row.precision, 3),
            recall: round(row.recall, 3),
            fmax: round(row.fmax, 3),
            coverage: round(row.coverage, 3),
            threshold: round(row.threshold, 3),
          }]
        })
      })
    )
  )
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function exportSummaryRows(rows: ComparisonSummaryRow[]) {
  if (rows.length === 0) return

  const headers = [
    'Release',
    'Subset',
    'Aspect',
    'Method',
    'Targets Predicted',
    'Ground Truth Targets',
    'Target Coverage %',
    'Precision',
    'Recall',
    'F-max',
    'Coverage',
    'Threshold',
  ]
  const csvRows = rows.map((row) => [
    row.release,
    row.subset,
    row.aspect,
    row.method,
    row.targetsPredicted,
    row.groundTruthTargets,
    row.targetCoveragePct,
    row.precision,
    row.recall,
    row.fmax,
    row.coverage,
    row.threshold,
  ])

  const csvContent = [
    headers.join(','),
    ...csvRows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'lafa_comparison_summary.csv'
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildComparisonTargetRows(releaseBundles: SelectedReleaseBundle[]): ComparisonTargetRow[] {
  return SUBSETS.map((subset) => {
    const row: ComparisonTargetRow = {
      subset: SUBSET_LABELS[subset],
      subsetKey: subset,
      releases: {},
    }

    releaseBundles.forEach((bundle) => {
      const counts = bundle.meta.targetCounts[subset]
      row[bundle.releaseId] = counts.total
      row.releases[bundle.releaseId] = {
        releaseLabel: bundle.label,
        total: counts.total,
        aspects: Object.fromEntries(
          ASPECTS.map((aspect) => [aspect, counts.byAspect[aspect] ?? 0])
        ) as Record<Aspect, number>,
      }
    })

    return row
  })
}

function buildComparisonMethodRows(
  releaseBundles: SelectedReleaseBundle[],
  selectedMethods: string[]
): ComparisonMethodRow[] {
  return selectedMethods.flatMap((method) => {
    const row: ComparisonMethodRow = {
      method,
      releases: {},
    }

    releaseBundles.forEach((bundle) => {
      const scores: Record<string, number> = {}

      SUBSETS.forEach((subset) => {
        ASPECTS.forEach((aspect) => {
          const key = makeBestKey(subset, aspect)
          const metric = (bundle.best[key] || []).find((item) => item.method === method)
          if (metric) scores[key] = metric.fmax
        })
      })

      const values = Object.values(scores)
      if (values.length === 0) return

      const avgFmax = values.reduce((sum, value) => sum + value, 0) / values.length
      row[bundle.releaseId] = avgFmax
      row.releases[bundle.releaseId] = {
        releaseLabel: bundle.label,
        avgFmax,
        scores,
      }
    })

    return Object.keys(row.releases).length > 0 ? [row] : []
  })
}

function ComparisonTargetCountChart({ releaseBundles }: { releaseBundles: SelectedReleaseBundle[] }) {
  const chartData = useMemo(() => buildComparisonTargetRows(releaseBundles), [releaseBundles])

  return (
    <div className="target-count-chart comparison-tab__summary-chart">
      <h4 className="target-count-chart__title">
        Targets by Knowledge Subset
        <InfoIcon tooltip="Number of proteins evaluated in each knowledge category for each compared time window." />
      </h4>
      <div className="target-count-chart__container">
        <ResponsiveContainer width="100%" height={Math.max(250, SUBSETS.length * 96)}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 8, bottom: 5 }}
            barCategoryGap="24%"
            barGap={3}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="subset" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              shared={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const data = payload[0].payload as ComparisonTargetRow
                const releaseId = String(payload[0].dataKey)
                const releaseData = data.releases[releaseId]
                if (!releaseData) return null
                return (
                  <div className="target-count-chart__tooltip">
                    <strong>{releaseData.releaseLabel}</strong>
                    <div>{data.subset}</div>
                    <div>Total: {releaseData.total.toLocaleString()}</div>
                    {ASPECTS.map((aspect) => (
                      <div key={aspect}>
                        {ASPECT_LABELS[aspect]}: {releaseData.aspects[aspect].toLocaleString()}
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            <Legend
              payload={releaseBundles.map((bundle, index) => ({
                value: bundle.label,
                type: 'square',
                color: RELEASE_COLORS[index % RELEASE_COLORS.length],
              }))}
            />
            {releaseBundles.map((bundle, index) => (
              <Bar
                key={bundle.releaseId}
                dataKey={bundle.releaseId}
                name={bundle.label}
                fill={RELEASE_COLORS[index % RELEASE_COLORS.length]}
                radius={[3, 3, 0, 0]}
              >
                <LabelList
                  dataKey={bundle.releaseId}
                  position="top"
                  formatter={(value: number) => value.toLocaleString()}
                  style={{ fontSize: 11, fill: 'var(--isu-charcoal)', fontWeight: 500 }}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ComparisonOverallRankingChart({
  releaseBundles,
  selectedMethods,
}: {
  releaseBundles: SelectedReleaseBundle[]
  selectedMethods: string[]
}) {
  const chartData = useMemo(
    () => buildComparisonMethodRows(releaseBundles, selectedMethods),
    [releaseBundles, selectedMethods]
  )

  return (
    <div className="overall-ranking-chart comparison-tab__summary-chart">
      <h4 className="overall-ranking-chart__title">
        Overall Method Ranking
        <InfoIcon tooltip="Average F-max across all 3 knowledge subsets and all 3 GO aspects for each compared time window." />
      </h4>
      <div className="overall-ranking-chart__container">
        <ResponsiveContainer width="100%" height={Math.max(250, selectedMethods.length * 58)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 36, left: 8, bottom: 30 }}
            barCategoryGap="28%"
            barGap={3}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 1]}
              tickFormatter={(value) => value.toFixed(2)}
              tick={{ fontSize: 12 }}
              label={{
                value: 'Average weighted F-max',
                position: 'insideBottom',
                offset: -14,
                fontSize: 12,
                fill: 'var(--isu-charcoal)',
              }}
            />
            <YAxis
              type="category"
              dataKey="method"
              tick={{ fontSize: 12 }}
              width={94}
            />
            <Tooltip
              shared={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const data = payload[0].payload as ComparisonMethodRow
                const releaseId = String(payload[0].dataKey)
                const releaseData = data.releases[releaseId]
                if (!releaseData) return null
                return (
                  <div className="overall-ranking-chart__tooltip">
                    <strong>{data.method}</strong>
                    <div className="overall-ranking-chart__tooltip-avg">
                      {releaseData.releaseLabel}: {releaseData.avgFmax.toFixed(4)}
                    </div>
                    <div className="overall-ranking-chart__tooltip-grid">
                      {SUBSETS.map((subset) => (
                        <div key={subset} className="overall-ranking-chart__tooltip-row">
                          <span className="overall-ranking-chart__tooltip-label">
                            {SUBSET_LABELS[subset]}:
                          </span>
                          {ASPECTS.map((aspect) => {
                            const key = makeBestKey(subset, aspect)
                            const score = releaseData.scores[key]
                            return (
                              <span key={key} className="overall-ranking-chart__tooltip-cell">
                                {ASPECT_SHORT[aspect]} {score !== undefined ? score.toFixed(3) : '-'}
                              </span>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }}
            />
            {releaseBundles.map((bundle, index) => (
              <Bar
                key={bundle.releaseId}
                dataKey={bundle.releaseId}
                name={bundle.label}
                fill={RELEASE_COLORS[index % RELEASE_COLORS.length]}
                radius={[0, 4, 4, 0]}
              >
                <LabelList
                  dataKey={bundle.releaseId}
                  position="right"
                  formatter={(value: number) => value.toFixed(2)}
                  style={{ fontSize: 11, fill: 'var(--isu-charcoal)' }}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ComparisonTab({
  comparisonData,
  releaseBundles,
  windowALabel,
  windowBLabel,
  selectedMethods,
  loading = false,
}: ComparisonTabProps) {
  const [activeSubset, setActiveSubset] = useState<Subset>('NK')

  const summaryRows = useMemo(
    () => buildSummaryRows(releaseBundles, selectedMethods),
    [releaseBundles, selectedMethods]
  )

  if (loading) {
    return (
      <div className="comparison-tab comparison-tab--loading">
        <div className="loading-spinner" />
        <p>Loading comparison data...</p>
      </div>
    )
  }

  if (!comparisonData.ready || releaseBundles.length < 2) {
    return (
      <div className="comparison-tab comparison-tab--empty">
        <p>Select two evaluation windows to compare methods.</p>
      </div>
    )
  }

  if (comparisonData.commonMethods.length === 0) {
    return (
      <div className="comparison-tab comparison-tab--empty">
        <p>No common methods found between the selected windows.</p>
        <p className="comparison-tab__hint">
          Try selecting windows that share methods available in NK, LK, and PK.
        </p>
      </div>
    )
  }

  return (
    <div className="comparison-tab">
      <div className="comparison-tab__header">
        <h3 className="comparison-tab__title">
          Window Comparison
          <InfoIcon tooltip="Compare method performance across two evaluation windows. Methods are constrained to those available in all selected windows and all knowledge subsets." />
        </h3>
        <div className="comparison-tab__legend">
          <span className="comparison-tab__legend-item comparison-tab__legend-item--a">
            {windowALabel}
          </span>
          <span className="comparison-tab__legend-vs">vs</span>
          <span className="comparison-tab__legend-item comparison-tab__legend-item--b">
            {windowBLabel}
          </span>
        </div>
      </div>

      <div className="comparison-tab__overview-grid">
        <ComparisonTargetCountChart releaseBundles={releaseBundles} />
        <ComparisonOverallRankingChart
          releaseBundles={releaseBundles}
          selectedMethods={selectedMethods}
        />
      </div>

      <section className="comparison-tab__section">
        <h4>Metric Comparison</h4>
        <div className="comparison-tab__subtabs">
          {SUBSETS.map((subset) => (
            <button
              key={subset}
              className={`comparison-tab__subtab ${activeSubset === subset ? 'comparison-tab__subtab--active' : ''}`}
              onClick={() => setActiveSubset(subset)}
            >
              {SUBSET_LABELS[subset]}
            </button>
          ))}
        </div>

        <div className="comparison-tab__table">
          <div className="comparison-tab__corner" />
          {ASPECTS.map((aspect) => (
            <div key={aspect} className="comparison-tab__col-header">
              {ASPECT_LABELS[aspect]}
            </div>
          ))}

          {METRICS.map((metric) => {
            return (
              <Fragment key={metric.key}>
                <div className="comparison-tab__row-header">
                  {metric.label}
                </div>
                {ASPECTS.map((aspect: Aspect) => {
                  const key = makeBestKey(activeSubset, aspect)
                  const data = comparisonData.data[key] || []

                  return (
                  <div key={`${metric.key}-${key}`} className="comparison-tab__cell">
                    <ComparisonFacet
                      data={data}
                      metric={metric.key}
                      methodOrder={selectedMethods}
                    />
                  </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </section>

      <section className="comparison-tab__section">
        <div className="comparison-tab__table-header">
          <h4>Combined Summary Table</h4>
          <button
            type="button"
            className="comparison-tab__export"
            onClick={() => exportSummaryRows(summaryRows)}
            disabled={summaryRows.length === 0}
          >
            Export CSV
          </button>
        </div>
        <div className="comparison-tab__summary-table-wrap">
          <table className="comparison-tab__summary-table">
            <thead>
              <tr>
                <th>Release</th>
                <th>Subset</th>
                <th>Aspect</th>
                <th>Method</th>
                <th>Targets Predicted</th>
                <th>Ground Truth Targets</th>
                <th>Target Coverage %</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F-max</th>
                <th>Coverage</th>
                <th>Threshold</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 ? (
                <tr>
                  <td colSpan={12}>No data available for selected methods.</td>
                </tr>
              ) : (
                summaryRows.map((row) => (
                  <tr key={`${row.release}-${row.subset}-${row.aspect}-${row.method}`}>
                    <td>{row.release}</td>
                    <td>{row.subset}</td>
                    <td>{row.aspect}</td>
                    <td>{row.method}</td>
                    <td>{row.targetsPredicted.toLocaleString()}</td>
                    <td>{row.groundTruthTargets.toLocaleString()}</td>
                    <td>{row.targetCoveragePct.toFixed(1)}</td>
                    <td>{row.precision.toFixed(3)}</td>
                    <td>{row.recall.toFixed(3)}</td>
                    <td>{row.fmax.toFixed(3)}</td>
                    <td>{row.coverage.toFixed(3)}</td>
                    <td>{row.threshold.toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
