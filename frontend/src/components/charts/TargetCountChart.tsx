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
import type { TargetCounts } from '../../types'
import { SUBSETS, SUBSET_LABELS, ASPECTS, ASPECT_LABELS } from '../../types'
import { InfoIcon } from '../ui'
import './TargetCountChart.css'

interface TargetCountChartProps {
  targetCounts: TargetCounts
}

const ASPECT_COLORS = {
  // Three greys: aspects are labelled, so no hue is spent on them (index.css).
  biological_process: 'var(--aspect-bp)',
  molecular_function: 'var(--aspect-mf)',
  cellular_component: 'var(--aspect-cc)',
}

export function TargetCountChart({ targetCounts }: TargetCountChartProps) {
  const chartData = SUBSETS.map((subset) => {
    const counts = targetCounts[subset]
    return {
      subset: SUBSET_LABELS[subset],
      subsetKey: subset,
      total: counts.total,
      ...Object.fromEntries(
        ASPECTS.map((aspect) => [aspect, counts.byAspect[aspect] ?? 0])
      ),
    }
  })

  return (
    <div className="target-count-chart">
      <h4 className="target-count-chart__title">
        Targets by Knowledge Subset
        <InfoIcon tooltip="Number of proteins evaluated in each knowledge category. NK (No Knowledge) proteins have no prior annotations, making them hardest to predict." />
      </h4>
      <div className="target-count-chart__container">
        <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 72)}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 8, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="subset" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const data = chartData.find((d) => d.subset === label)
                return (
                  <div className="target-count-chart__tooltip">
                    <strong>{label}</strong>
                    <div>Total: {data?.total.toLocaleString()}</div>
                    {ASPECTS.map((aspect) => (
                      <div key={aspect} style={{ color: ASPECT_COLORS[aspect] }}>
                        {ASPECT_LABELS[aspect]}: {((data as Record<string, unknown>)?.[aspect] as number)?.toLocaleString() ?? 0}
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            <Legend
              formatter={(value) => ASPECT_LABELS[value as keyof typeof ASPECT_LABELS] || value}
            />
            {ASPECTS.map((aspect, index) => (
              <Bar
                key={aspect}
                dataKey={aspect}
                name={aspect}
                stackId="a"
                fill={ASPECT_COLORS[aspect]}
              >
                {/* Show label on top bar of stack (CC) */}
                {index === ASPECTS.length - 1 && (
                  <LabelList
                    valueAccessor={(entry: Record<string, unknown>) => {
                      return entry.total as number
                    }}
                    position="top"
                    formatter={(value: number) => value.toLocaleString()}
                    style={{ fontSize: 11, fill: 'var(--isu-charcoal)', fontWeight: 500 }}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
