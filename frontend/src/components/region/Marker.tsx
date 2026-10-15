import type { MarkerShape } from '../../lib/regionLabels'

interface MarkerProps {
  shape: MarkerShape
  x: number
  y: number
  size?: number
  color: string
  /** filled: cost measured in the run; open: cost reported by a submitter */
  filled?: boolean
  title?: string
  onClick?: () => void
}

/** One data point. Shape names the tool (or kmerseek alphabet), colour the kind of method. */
export function Marker({ shape, x, y, size = 6, color, filled = true, title, onClick }: MarkerProps) {
  const common = {
    fill: filled ? color : 'var(--surface)',
    stroke: color,
    strokeWidth: 1.6,
    onClick,
    style: onClick ? { cursor: 'pointer' } : undefined,
  }
  const t = title ? <title>{title}</title> : null
  const s = size
  if (shape === 'square') {
    return <rect x={x - s * 0.85} y={y - s * 0.85} width={s * 1.7} height={s * 1.7} {...common}>{t}</rect>
  }
  if (shape === 'triangle') {
    const h = s * 1.1
    return <polygon points={`${x},${y - h} ${x + h},${y + h * 0.8} ${x - h},${y + h * 0.8}`} {...common}>{t}</polygon>
  }
  if (shape === 'diamond') {
    const h = s * 1.15
    return <polygon points={`${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}`} {...common}>{t}</polygon>
  }
  return <circle cx={x} cy={y} r={s} {...common}>{t}</circle>
}

/** Not measured: a grey cross, a mark no data point uses. */
export function MissingMark({ x, y, size = 5 }: { x: number; y: number; size?: number }) {
  return (
    <g stroke="var(--missing)" strokeWidth={1.6}>
      <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
      <line x1={x - size} y1={y + size} x2={x + size} y2={y - size} />
    </g>
  )
}

export function MarkerSwatch({ shape, color, filled = true }: { shape: MarkerShape; color: string; filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="region-swatch">
      <Marker shape={shape} x={8} y={8} size={5} color={color} filled={filled} />
    </svg>
  )
}
