import { useMemo, useState } from 'react'
import type { RegionMeta, RegionRow, ToolCard } from '../../types'
import {
  DEFAULT_FILTERS,
  FEATURE_WORDS,
  KINDS,
  SPECIES_GROUPS,
  SPECIES_NAMES,
  STRATUM_AXES,
  TOOLS,
  TRUTH_LABELS,
  binLabel,
  settingShort,
  settingWords,
  toolColor,
  toolName,
  toolShape,
  type RegionFilters,
} from '../../lib/regionLabels'
import { generateFScoreContour } from '../../lib/fscoreContour'
import { Tabs } from '../ui'
import { Marker, MarkerSwatch, MissingMark } from './Marker'
import './RegionView.css'

type MetricId = 'fmax' | 'auprc' | 'medianIouTp'
const METRICS: { id: MetricId; label: string; help: string }[] = [
  { id: 'fmax', label: 'Fmax', help: 'the best F (harmonic mean of precision and recall) over all score thresholds; 1 is perfect, 0 finds nothing' },
  { id: 'auprc', label: 'AUPRC', help: 'area under the precision-recall curve, over all thresholds; higher is better' },
  { id: 'medianIouTp', label: 'Median IoU', help: 'for correct calls, the overlap between call and true region divided by their union; 1 means the boundaries match' },
]

const fmt3 = (v: number | null) => (v === null ? '—' : v.toFixed(3))
const fmtSig = (v: number | null, digits = 3) => (v === null ? '—' : Number(v.toPrecision(digits)).toString())
const fmtInt = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('en-US'))

function rowKey(r: RegionRow) {
  return `${r.tool}|${r.setting}`
}

interface RegionViewProps {
  meta: RegionMeta
  rows: RegionRow[]
  cards: Record<string, ToolCard>
}

export function RegionView({ meta, rows, cards }: RegionViewProps) {
  const [filters, setFilters] = useState<RegionFilters>(DEFAULT_FILTERS)
  const [metric, setMetric] = useState<MetricId>('fmax')
  const [activeTab, setActiveTab] = useState('table')
  const [openTool, setOpenTool] = useState<string | null>(null)

  const present = useMemo(() => {
    const s = new Set<string>()
    rows.forEach((r) => {
      if (r.truthSet === filters.truthSet) s.add(`${r.stratumAxis}|${r.stratumBin}`)
    })
    return s
  }, [rows, filters.truthSet])

  // Million years since the split from the human line (species_mya in results.parquet).
  const speciesMya = useMemo(() => {
    const m: Record<string, number> = {}
    rows.forEach((r) => {
      if (r.speciesMya !== null && r.species !== 'all') m[r.species] = Math.round(r.speciesMya)
    })
    return m
  }, [rows])

  const allMethods = useMemo(() => {
    const m = new Map<string, { tool: string; setting: string }>()
    rows.forEach((r) => m.set(rowKey(r), { tool: r.tool, setting: r.setting }))
    return [...m.values()].sort((a, b) => a.tool.localeCompare(b.tool) || a.setting.localeCompare(b.setting))
  }, [rows])

  // hmmscan searches Pfam's models, not a relative, so its rows (species "all") show beside
  // every relative.
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.truthSet === filters.truthSet &&
          r.dedup === filters.dedup &&
          (r.species === filters.species || (r.tool === 'hmmscan' && r.species === 'all')) &&
          r.stratumAxis === filters.stratumAxis &&
          r.stratumBin === filters.stratumBin,
      ),
    [rows, filters],
  )
  const shownKeys = new Set(shown.map(rowKey))
  const notRun = allMethods.filter((m) => !shownKeys.has(`${m.tool}|${m.setting}`))

  const openCard = (tool: string) => {
    setOpenTool(tool)
    setActiveTab('cards')
  }

  const filterWords = [
    TRUTH_LABELS[filters.truthSet]?.label + ' truth set',
    filters.dedup ? 'dedup calls' : 'raw calls',
    filters.species === 'all' ? 'no relative' : `${SPECIES_NAMES[filters.species]} as the relative searched`,
    filters.stratumAxis === 'all'
      ? 'all regions'
      : `${STRATUM_AXES.find((a) => a.axis === filters.stratumAxis)?.label}: ${binLabel(filters.stratumAxis, filters.stratumBin)}`,
  ].join(', ')

  const tabs = [
    {
      id: 'table',
      label: 'Table',
      content: <RegionTable rows={shown} notRun={notRun} onTool={openCard} />,
    },
    {
      id: 'cost',
      label: 'Score against cost',
      content: <CostPlot rows={shown} metric={metric} onTool={openCard} />,
    },
    {
      id: 'pr',
      label: 'Precision and recall',
      content: <RegionPRPlot rows={shown} onTool={openCard} />,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      content: <CoverageGrid rows={rows} truthSet={filters.truthSet} dedup={filters.dedup} />,
    },
    {
      id: 'cards',
      label: 'Tool cards',
      content: <ToolCards cards={cards} openTool={openTool} onOpen={setOpenTool} />,
    },
  ]

  return (
    <div className="region-view">
      <p className="region-source">
        {meta.title}. Run finished {meta.info.run_date}. Numbers from{' '}
        <a href={`https://github.com/${meta.info.source_repo}/tree/${meta.info.source_commit}/results/leaderboard`}>
          {meta.info.source_repo} at <code>{meta.info.source_commit.slice(0, 8)}</code>
        </a>{' '}
        (results.parquet sha256 <code>{meta.info.results_sha256?.slice(0, 12)}…</code>).
      </p>

      <FilterChips filters={filters} onChange={setFilters} present={present} speciesMya={speciesMya} />

      <div className="region-metric" role="group" aria-label="Score shown in the plots">
        <span className="region-metric__label">Score in the plot of score against cost:</span>
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip ${metric === m.id ? 'chip--on' : ''}`}
            aria-pressed={metric === m.id}
            title={m.help}
            onClick={() => setMetric(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="region-showing">
        Showing: {filterWords}. {shown.length} tool settings scored, {notRun.length} not run here.
      </p>

      <Tabs tabs={tabs} defaultTab={activeTab} onChange={setActiveTab} />
    </div>
  )
}

/* ---------- filter chips ---------- */

function FilterChips({
  filters,
  onChange,
  present,
  speciesMya,
}: {
  filters: RegionFilters
  onChange: (f: RegionFilters) => void
  present: Set<string>
  speciesMya: Record<string, number>
}) {
  const set = (patch: Partial<RegionFilters>) => onChange({ ...filters, ...patch })
  const chip = (label: string, on: boolean, onClick: () => void, title?: string, disabled = false) => (
    <button
      key={label}
      type="button"
      className={`chip ${on ? 'chip--on' : ''} ${disabled ? 'chip--empty' : ''}`}
      aria-pressed={on}
      title={disabled ? 'not run: no row of the table has this' : title}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div className="filters" aria-label="Filters">
      <div className="chiprow">
        <div className="chiprow__axis">
          Truth set
          <small>the known annotations the calls are graded against</small>
        </div>
        <div className="chips">
          {Object.entries(TRUTH_LABELS).map(([v, t]) =>
            chip(t.label, filters.truthSet === v, () => set({ truthSet: v, stratumAxis: 'all', stratumBin: 'all' }), t.help),
          )}
        </div>
      </div>
      <div className="chiprow">
        <div className="chiprow__axis">
          Dedup or raw
          <small>raw keeps every call; dedup merges calls of one family that overlap on the same protein</small>
        </div>
        <div className="chips">
          {chip('raw', !filters.dedup, () => set({ dedup: false }))}
          {chip('dedup', filters.dedup, () => set({ dedup: true }))}
        </div>
      </div>
      <div className="chiprow">
        <div className="chiprow__axis">
          Nearest reviewed relative: time since split
          <small>the proteome searched; the number is how many million years (Mya) ago its line split from ours</small>
        </div>
        <div className="chips">
          {SPECIES_GROUPS.map((g) => (
            <span className="chipgroup" key={g.label}>
              <span className="chipgroup__label">{g.label}</span>
              {g.members.map((s) =>
                chip(
                  s === 'all' ? SPECIES_NAMES[s] : `${SPECIES_NAMES[s]} ${speciesMya[s] ?? ''}`,
                  filters.species === s,
                  () => set({ species: s }),
                ),
              )}
            </span>
          ))}
        </div>
      </div>
      {STRATUM_AXES.map((a) => (
        <div className="chiprow" key={a.axis}>
          <div className="chiprow__axis">
            {a.label}
            <small>{a.help}</small>
          </div>
          <div className="chips">
            {chip('any', filters.stratumAxis !== a.axis, () => set({ stratumAxis: 'all', stratumBin: 'all' }))}
            {a.groups.map((g, gi) => (
              <span className="chipgroup" key={gi}>
                {g.label && <span className="chipgroup__label">{g.label}</span>}
                {g.bins.map(([v, w]) =>
                  chip(
                    w,
                    filters.stratumAxis === a.axis && filters.stratumBin === v,
                    () => set({ stratumAxis: a.axis, stratumBin: v }),
                    a.axis === 'feature_type' ? FEATURE_WORDS[v] : undefined,
                    !present.has(`${a.axis}|${v}`),
                  ),
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
      <p className="filters__note">One stratum at a time: picking a value in one row sets the other rows back to "any". Greyed values were not run.</p>
    </div>
  )
}

/* ---------- legend shared by the plots ---------- */

function KindLegend({ rows }: { rows: RegionRow[] }) {
  const tools = [...new Set(rows.map((r) => r.tool))]
  const kinds = Object.entries(KINDS).filter(([k]) => tools.some((t) => TOOLS[t]?.kind === k))
  const alphabets = [...new Set(rows.filter((r) => r.tool === 'kmerseek').map((r) => r.setting.replace(/_k\d+_lc(True|False)$/, '')))]
  return (
    <div className="region-legend" aria-label="Legend">
      <div>
        <strong>Colour: kind of method.</strong>{' '}
        {kinds.map(([k, v]) => (
          <span className="region-legend__item" key={k}>
            <span className="region-legend__dot" style={{ background: v.color }} /> {v.label}
          </span>
        ))}
      </div>
      <div>
        <strong>Shape: tool.</strong>{' '}
        {tools.filter((t) => t !== 'kmerseek').map((t) => (
          <span className="region-legend__item" key={t}>
            <MarkerSwatch shape={toolShape(t, '')} color={toolColor(t)} /> {toolName(t)}
          </span>
        ))}
        {alphabets.map((a) => (
          <span className="region-legend__item" key={a}>
            <MarkerSwatch shape={toolShape('kmerseek', `${a}_k1_lcFalse`)} color={toolColor('kmerseek')} /> kmerseek {a}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- table ---------- */

type SortKey = 'tool' | 'fmax' | 'auprc' | 'medianIouTp' | 'n' | 'cpuH' | 'peakRamGb' | 'gpuH' | 'costUsdEst'

function RegionTable({ rows, notRun, onTool }: { rows: RegionRow[]; notRun: { tool: string; setting: string }[]; onTool: (t: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'fmax', desc: true })
  const sorted = useMemo(() => {
    const v = (r: RegionRow): number | string => (sort.key === 'tool' ? `${r.tool} ${r.setting}` : (r[sort.key] as number | null) ?? -Infinity)
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b)
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return sort.desc ? -c : c
    })
  }, [rows, sort])
  const head = (key: SortKey, label: string, title: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" title={title} onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'tool' })}>
        {label} {sort.key === key ? (sort.desc ? '▼' : '▲') : ''}
      </button>
    </th>
  )
  return (
    <div className="region-table-wrap">
      <p className="region-note">
        One row per tool setting. Click a column to sort. CPU-h is reserved core-hours (cores × wall time) of the search, per
        relative searched and per 1,000 human query proteins; building the relative's database is not counted. GPU-h is the
        same for GPUs. "—" means not measured. Cost = CPU-h × $0.044625 + GPU-h × $1.006 (AWS on-demand prices, US East, read
        2026-10-15).
      </p>
      <table className="region-table">
        <thead>
          <tr>
            {head('tool', 'Tool and setting', 'sort by name')}
            {head('fmax', 'Fmax', METRICS[0].help)}
            {head('auprc', 'AUPRC', METRICS[1].help)}
            {head('medianIouTp', 'Median IoU', METRICS[2].help)}
            {head('n', 'True instances', 'known regions in this stratum')}
            {head('cpuH', 'CPU-h', 'reserved core-hours per relative, per 1,000 queries')}
            {head('peakRamGb', 'Peak RAM, GB', 'peak memory of one search task')}
            {head('gpuH', 'GPU-h', 'GPU-hours per relative, per 1,000 queries')}
            {head('costUsdEst', 'Cost, US$', 'estimated cost per 1,000 queries')}
            <th scope="col">Cost source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              <th scope="row">
                <MarkerSwatch shape={toolShape(r.tool, r.setting)} color={toolColor(r.tool)} filled={r.provenance !== 'reported'} />{' '}
                <button type="button" className="linklike" onClick={() => onTool(r.tool)}>{toolName(r.tool)}</button>{' '}
                <span className="mono" title={settingWords(r.tool, r.setting)}>{settingShort(r.tool, r.setting)}</span>
                {r.species === 'all' && r.tool === 'hmmscan' && <span className="tag"> no relative searched</span>}
              </th>
              <td className="num">{fmt3(r.fmax)}</td>
              <td className="num">{fmt3(r.auprc)}</td>
              <td className="num">{fmt3(r.medianIouTp)}</td>
              <td className="num">{fmtInt(r.n)}</td>
              <td className="num">{fmtSig(r.cpuH)}</td>
              <td className="num">{r.peakRamGb === null ? '—' : r.peakRamGb.toFixed(1)}</td>
              <td className="num">{fmtSig(r.gpuH)}</td>
              <td className="num">{r.costUsdEst === null ? '—' : `$${fmtSig(r.costUsdEst)}`}</td>
              <td>{r.provenance ?? 'not measured'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notRun.length > 0 && (
        <p className="region-note">
          Not run under these filters: {notRun.map((m) => `${toolName(m.tool)} ${settingShort(m.tool, m.setting)}`).join('; ')}.
        </p>
      )}
    </div>
  )
}

/* ---------- score against cost ---------- */

const W = 720, H = 420, M = { l: 64, r: 20, t: 16, b: 52 }

function CostPlot({ rows, metric, onTool }: { rows: RegionRow[]; metric: MetricId; onTool: (t: string) => void }) {
  const metricInfo = METRICS.find((m) => m.id === metric)!
  const withCost = rows.filter((r) => r.cpuH !== null && r.cpuH > 0 && r[metric] !== null)
  const noCost = rows.filter((r) => !(r.cpuH !== null && r.cpuH > 0))
  if (withCost.length === 0) return <p className="region-note">No row under these filters has both a score and a measured cost.</p>

  const xs = withCost.map((r) => r.cpuH as number)
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...xs))))
  const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...xs))))
  const yMax = Math.max(0.1, Math.ceil(Math.max(...withCost.map((r) => r[metric] as number)) * 10) / 10)
  const px = (v: number) => M.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - M.l - M.r)
  const py = (v: number) => H - M.b - (v / yMax) * (H - M.t - M.b)
  const ticks: number[] = []
  for (let d = lo; d <= hi * 1.0001; d *= 10) [1, 2, 5].forEach((m) => d * m <= hi * 1.0001 && ticks.push(d * m))

  // Line through the settings that no other setting beats on both score and cost.
  const byCost = [...withCost].sort((a, b) => (a.cpuH as number) - (b.cpuH as number) || (b[metric] as number) - (a[metric] as number))
  const front: RegionRow[] = []
  let best = -Infinity
  byCost.forEach((r) => {
    if ((r[metric] as number) > best) {
      front.push(r)
      best = r[metric] as number
    }
  })

  return (
    <div className="region-plot">
      <p className="region-note">
        Up is better ({metricInfo.label}: {metricInfo.help}); left is cheaper. The x axis spaces values by ratio: the step from
        0.01 to 0.1 core-hours takes as much room as the step from 0.1 to 1. The dark line joins the settings that no other
        setting beats on both score and cost.
      </p>
      <KindLegend rows={withCost} />
      <div className="region-legend">
        <span className="region-legend__item"><MarkerSwatch shape="circle" color="var(--ink)" /> filled: cost measured on Sherlock</span>
        <span className="region-legend__item"><MarkerSwatch shape="circle" color="var(--ink)" filled={false} /> open: cost reported by a submitter (none yet)</span>
        <span className="region-legend__item"><svg width="16" height="16" aria-hidden="true"><MissingMark x={8} y={8} size={4} /></svg> not measured, listed under the plot</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="region-svg" role="img" aria-label={`${metricInfo.label} against CPU-hours per 1,000 queries`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={px(t)} x2={px(t)} y1={M.t} y2={H - M.b} className="grid" />
            <text x={px(t)} y={H - M.b + 16} textAnchor="middle" className="tick">{Number(t.toPrecision(2))}</text>
          </g>
        ))}
        {Array.from({ length: Math.round(yMax * 10) + 1 }, (_, i) => i / 10).map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} className="grid" />
            <text x={M.l - 8} y={py(t) + 4} textAnchor="end" className="tick">{t.toFixed(1)}</text>
          </g>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 10} textAnchor="middle" className="axis-label">Reserved core-hours of the search, per relative and per 1,000 query proteins</text>
        <text transform={`translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{metricInfo.label}</text>
        <polyline
          points={front.map((r) => `${px(r.cpuH as number)},${py(r[metric] as number)}`).join(' ')}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.5}
        />
        {withCost.map((r) => (
          <Marker
            key={rowKey(r)}
            shape={toolShape(r.tool, r.setting)}
            x={px(r.cpuH as number)}
            y={py(r[metric] as number)}
            color={toolColor(r.tool)}
            filled={r.provenance !== 'reported'}
            title={`${toolName(r.tool)} ${settingShort(r.tool, r.setting)}: ${metricInfo.label} ${fmt3(r[metric])}, ${fmtSig(r.cpuH)} core-hours per relative per 1,000 queries, ${r.costUsdEst === null ? 'cost not measured' : `$${fmtSig(r.costUsdEst)}`}`}
            onClick={() => onTool(r.tool)}
          />
        ))}
      </svg>
      {noCost.length > 0 && (
        <p className="region-note">
          <svg width="14" height="14" aria-hidden="true"><MissingMark x={7} y={7} size={4} /></svg> Cost not measured, so not
          on the plot: {noCost.map((r) => `${toolName(r.tool)} ${settingShort(r.tool, r.setting)} (${metricInfo.label} ${fmt3(r[metric])})`).join('; ')}.
        </p>
      )}
    </div>
  )
}

/* ---------- precision and recall at Fmax ---------- */

function RegionPRPlot({ rows, onTool }: { rows: RegionRow[]; onTool: (t: string) => void }) {
  const S = 420, m = { l: 56, r: 48, t: 16, b: 48 }
  const p = (v: number) => m.l + v * (S - m.l - m.r)
  const q = (v: number) => S - m.b - v * (S - m.t - m.b)
  const contours = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  return (
    <div className="region-plot">
      <p className="region-note">
        Each mark is one tool setting at the score threshold that gives its Fmax. Up and right is better. The grey curves join
        points of equal F, labelled in the right margin. The release stores only this one point per setting, not the whole
        precision-recall curve.
      </p>
      <KindLegend rows={rows} />
      <svg viewBox={`0 0 ${S} ${S}`} className="region-svg region-svg--square" role="img" aria-label="Precision against recall at Fmax">
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
          <g key={t}>
            <line x1={p(t)} x2={p(t)} y1={m.t} y2={S - m.b} className="grid" />
            <line x1={m.l} x2={S - m.r} y1={q(t)} y2={q(t)} className="grid" />
            <text x={p(t)} y={S - m.b + 16} textAnchor="middle" className="tick">{t.toFixed(1)}</text>
            <text x={m.l - 8} y={q(t) + 4} textAnchor="end" className="tick">{t.toFixed(1)}</text>
          </g>
        ))}
        {contours.map((f) => {
          const pts = generateFScoreContour(f, 200)
          const last = pts[pts.length - 1]
          return (
            <g key={f}>
              <polyline points={pts.map((pt) => `${p(pt.x)},${q(pt.y)}`).join(' ')} fill="none" className="contour" />
              {last && <text x={p(1) + 4} y={q(last.y) + 3} textAnchor="start" className="contour-label">F {f.toFixed(1)}</text>}
            </g>
          )
        })}
        <text x={(m.l + S - m.r) / 2} y={S - 10} textAnchor="middle" className="axis-label">Recall</text>
        <text transform={`translate(16 ${(m.t + S - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">Precision</text>
        {rows.map((r) => (
          <Marker
            key={rowKey(r)}
            shape={toolShape(r.tool, r.setting)}
            x={p(r.recall)}
            y={q(r.precision)}
            color={toolColor(r.tool)}
            filled={r.provenance !== 'reported'}
            title={`${toolName(r.tool)} ${settingShort(r.tool, r.setting)}: Fmax ${fmt3(r.fmax)}, precision ${fmt3(r.precision)}, recall ${fmt3(r.recall)}`}
            onClick={() => onTool(r.tool)}
          />
        ))}
      </svg>
    </div>
  )
}

/* ---------- coverage grid ---------- */

function CoverageGrid({ rows, truthSet, dedup }: { rows: RegionRow[]; truthSet: string; dedup: boolean }) {
  const subset = rows.filter((r) => r.truthSet === truthSet && r.dedup === dedup)
  const cells = new Map<string, { settings: Set<string>; species: Set<string> }>()
  subset.forEach((r) => {
    const k = `${r.tool}|${r.stratumAxis}|${r.stratumBin}`
    const c = cells.get(k) ?? { settings: new Set(), species: new Set() }
    c.settings.add(r.setting)
    c.species.add(r.species)
    cells.set(k, c)
  })
  const tools = Object.keys(TOOLS).filter((t) => rows.some((r) => r.tool === t))
  const columns: { axis: string; label: string; bins: [string, string][] }[] = [
    { axis: 'all', label: 'all', bins: [['all', 'all regions']] },
    ...STRATUM_AXES.map((a) => ({ axis: a.axis, label: a.label, bins: a.groups.flatMap((g) => g.bins) })),
  ]
  const empty: string[] = []
  columns.forEach((c) =>
    c.bins.forEach(([v, w]) => {
      const missing = tools.filter((t) => !cells.has(`${t}|${c.axis}|${v}`))
      if (missing.length === tools.length) empty.push(`${c.axis === 'all' ? '' : c.label + ': '}${w}`)
    }),
  )
  return (
    <div className="region-coverage">
      <p className="region-note">
        Which tool was scored in which stratum, for the {TRUTH_LABELS[truthSet]?.label} truth set with {dedup ? 'dedup' : 'raw'}{' '}
        calls, over every relative. <span className="cov cov--on" aria-hidden="true" /> scored (hover for the number of
        settings and relatives); <span className="cov" aria-hidden="true" /> not run. The empty columns are the runs still to do.
      </p>
      <div className="region-coverage__scroll">
        <table className="coverage-table">
          <thead>
            <tr>
              <th rowSpan={2} scope="col">Tool</th>
              {columns.map((c) => <th key={c.axis} colSpan={c.bins.length} scope="colgroup" className="cov-axis">{c.label}</th>)}
            </tr>
            <tr>
              {columns.flatMap((c) => c.bins.map(([v, w]) => <th key={`${c.axis}|${v}`} scope="col" className="cov-bin"><span>{w}</span></th>))}
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t}>
                <th scope="row"><MarkerSwatch shape={toolShape(t, '')} color={toolColor(t)} /> {toolName(t)}</th>
                {columns.flatMap((c) =>
                  c.bins.map(([v, w]) => {
                    const cell = cells.get(`${t}|${c.axis}|${v}`)
                    return (
                      <td key={`${c.axis}|${v}`} className="cov-cell">
                        <span
                          className={`cov ${cell ? 'cov--on' : ''}`}
                          title={cell ? `${toolName(t)}, ${w}: ${cell.settings.size} settings, ${cell.species.size} relatives` : `${toolName(t)}, ${w}: not run`}
                        />
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {empty.length > 0 && <p className="region-note">Not run for any tool under the {TRUTH_LABELS[truthSet]?.label} truth set: {empty.join('; ')}.</p>}
    </div>
  )
}

/* ---------- tool cards ---------- */

function ToolCards({ cards, openTool, onOpen }: { cards: Record<string, ToolCard>; openTool: string | null; onOpen: (t: string | null) => void }) {
  const tools = Object.keys(TOOLS).filter((t) => cards[t])
  if (tools.length === 0) return <p className="region-note">No tool cards in this build.</p>
  const card = openTool ? cards[openTool] : null
  return (
    <div className="tool-cards">
      <p className="region-note">
        One card per tool: what it compares, what it needs, how to read its score, where it does well and badly, cost, and the
        exact command. Cards are copied from{' '}
        <a href="https://github.com/seanome/protein-function-annotation-leaderboard/pull/2">seanome/protein-function-annotation-leaderboard PR 2</a>.
      </p>
      <div className="tool-cards__list" role="list">
        {tools.map((t) => (
          <button key={t} type="button" role="listitem" className={`tool-chip ${openTool === t ? 'tool-chip--on' : ''}`} onClick={() => onOpen(t)}>
            <MarkerSwatch shape={toolShape(t, '')} color={toolColor(t)} /> {toolName(t)}
          </button>
        ))}
      </div>
      {card && (
        <article className="tool-card" aria-labelledby="tool-card-title">
          <h3 id="tool-card-title">{toolName(card.tool)}</h3>
          <p className="tool-card__kind">{card.kind}</p>
          <dl>
            <dt>What it compares</dt><dd>{card.compares}</dd>
            <dt>What it needs</dt>
            <dd>{Object.entries(card.needs).map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`).join('; ')}</dd>
            <dt>Reference searched</dt><dd>{card.reference}</dd>
            <dt>How to read its score</dt><dd>{card.score}</dd>
            {card.best_setting && (<><dt>Best setting here</dt><dd><span className="mono">{card.best_setting}</span>: {settingWords(card.tool, card.best_setting)}</dd></>)}
            {card.strong && card.strong.length > 0 && (
              <><dt>Strong strata ({card.numbers_from.filters})</dt>
                <dd><ul>{card.strong.map((s, i) => <li key={i}>{binLabel(s.axis, s.stratum)}: Fmax {fmt3(s.fmax)} (n = {fmtInt(s.n)}), against {toolName(s.other_tool)} {fmt3(s.other_fmax)}</li>)}</ul></dd></>
            )}
            {card.weak && card.weak.length > 0 && (
              <><dt>Weak strata ({card.numbers_from.filters})</dt>
                <dd><ul>{card.weak.map((s, i) => <li key={i}>{binLabel(s.axis, s.stratum)}: Fmax {fmt3(s.fmax)} (n = {fmtInt(s.n)}), against {toolName(s.other_tool)} {fmt3(s.other_fmax)}</li>)}</ul></dd></>
            )}
            <dt>How it fails</dt><dd><ul>{card.failure_modes.map((f, i) => <li key={i}>{f}</li>)}</ul></dd>
            <dt>Version</dt><dd>{card.version}</dd>
            <dt>Container</dt><dd><code>{card.container}</code></dd>
            <dt>Command</dt><dd><pre><code>{card.command}</code></pre></dd>
            {card.questions && (<><dt>Will it work on your proteins?</dt><dd><ol>{card.questions.map((q, i) => <li key={i}>{q.replace(/\*\*/g, '')}</li>)}</ol></dd></>)}
          </dl>
          <p className="region-note">
            Numbers from <a href={`https://github.com/${card.numbers_from.repo}/tree/${card.numbers_from.commit}`}>{card.numbers_from.repo} at <code>{card.numbers_from.commit.slice(0, 8)}</code></a>.
          </p>
        </article>
      )}
    </div>
  )
}
