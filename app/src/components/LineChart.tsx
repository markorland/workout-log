import { useState } from 'react'
import { fmtLb } from '../lib/targets'

export interface ChartPoint {
  t: number // time (ms)
  v: number // value
  readout: string // text shown when the point is selected, e.g. "135 lb × 3 · Oct 14"
  axisLabel: string // short date for the x-axis ends
}

/** Pick a tidy step (0.25, 0.5, 1, 2, 5, 10…) for about two gridline gaps. */
function niceStep(span: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]
  return steps.find((s) => span / s <= 4) ?? 100
}

/**
 * One series over time: 2px line, tap a point to read its value. Recessive
 * grid, scale never below zero. One point shows as a number, not a chart.
 */
export default function LineChart({
  points,
  unit,
  minSpan = 1,
  label,
}: {
  points: ChartPoint[]
  unit: string
  minSpan?: number
  label: string
}) {
  const pts = points.filter((p) => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t)
  const [sel, setSel] = useState<number | null>(pts.length ? pts.length - 1 : null)
  if (pts.length === 0) return null
  if (pts.length === 1) {
    return (
      <div className="stat">
        <div className="stat-value">
          {fmtLb(pts[0].v)} {unit}
        </div>
        <div className="muted">{pts[0].readout}</div>
      </div>
    )
  }

  const W = 340
  const H = 150
  const pad = { l: 40, r: 12, t: 12, b: 22 }
  const minV = Math.min(...pts.map((p) => p.v))
  const maxV = Math.max(...pts.map((p) => p.v))
  const span = Math.max(minSpan, maxV - minV)
  const step = niceStep(span)
  const lo = Math.max(0, Math.floor((minV - span * 0.15) / step) * step)
  const hi = Math.ceil((maxV + span * 0.15) / step) * step
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b)
  const mid = Math.round((lo + hi) / 2 / step) * step
  const ticks = [...new Set([lo, mid, hi])]
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const s = sel !== null ? pts[sel] : null

  return (
    <div className="chart">
      <div className="chart-readout">{s ? s.readout : <span className="muted">Tap a point</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, ${pts.length} points`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="axis">
              {fmtLb(v)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="axis">
          {pts[0].axisLabel}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="axis">
          {pts[pts.length - 1].axisLabel}
        </text>
        <path d={path} className="line" />
        {pts.map((p, i) => (
          <g key={i} onClick={() => setSel(i)}>
            <circle cx={x(p.t)} cy={y(p.v)} r={14} className="hit" />
            <circle cx={x(p.t)} cy={y(p.v)} r={i === sel ? 5.5 : 4} className={i === sel ? 'dot selected' : 'dot'} />
          </g>
        ))}
      </svg>
    </div>
  )
}
