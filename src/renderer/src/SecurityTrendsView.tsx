import { useEffect, useMemo, useState } from 'react'
import './security-trends-view.css'
import { SvcState } from './SvcState'

import type {
  SecurityAlert,
  SecurityScoreDomain,
  SecuritySnapshot,
  SecurityThresholds,
  SecurityTrendRange,
  SecurityTrendReport
} from '@shared/types'
import {
  buildSecurityTrendReport,
  listSecurityScopes,
  updateSecurityThresholds
} from './api'

type MainTab = 'overview' | 'domains' | 'snapshots' | 'thresholds'

const MAIN_TABS: Array<{ id: MainTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'domains', label: 'Domain trends' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'thresholds', label: 'Thresholds & alerts' }
]

const RANGES: Array<{ id: SecurityTrendRange; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '1y', label: '1 year' }
]

const DOMAIN_LABELS: Record<SecurityScoreDomain, string> = {
  iam: 'IAM',
  network: 'Network',
  encryption: 'Encryption',
  logging: 'Logging',
  compliance: 'Compliance'
}

const DOMAIN_COLORS: Record<SecurityScoreDomain, string> = {
  iam: '#f59a3d',
  network: '#4a8fe7',
  encryption: '#5cc58c',
  logging: '#fbbf24',
  compliance: '#b57eff'
}

/* ── Chart primitives ────────────────────────────────── */

type LineChartProps = {
  width: number
  height: number
  snapshots: SecuritySnapshot[]
  valueKey: (s: SecuritySnapshot) => number
  color: string
  fillColor?: string
  yMin?: number
  yMax?: number
  label: string
}

function LineChart({
  width, height, snapshots, valueKey, color, fillColor, yMin = 0, yMax = 100, label
}: LineChartProps) {
  const padding = { top: 24, right: 16, bottom: 28, left: 44 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  if (snapshots.length === 0) {
    return (
      <svg width={width} height={height} className="stv-chart">
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#8fa3ba" fontSize={12}>No data</text>
      </svg>
    )
  }

  const n = snapshots.length
  const xStep = n > 1 ? innerW / (n - 1) : 0
  const yRange = yMax - yMin || 1

  const points = snapshots.map((s, i) => ({
    x: padding.left + i * xStep,
    y: padding.top + innerH - ((valueKey(s) - yMin) / yRange) * innerH,
    value: valueKey(s),
    label: s.capturedAt
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + innerH} L ${points[0].x} ${padding.top + innerH} Z`

  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  const yTicks = ticks.map((v) => ({
    y: padding.top + innerH - ((v - yMin) / yRange) * innerH,
    value: Math.round(v)
  }))

  return (
    <svg width={width} height={height} className="stv-chart">
      <text x={padding.left} y={padding.top - 8} fill="#a6bbcf" fontSize={11} fontWeight={600}>{label}</text>
      {yTicks.map((t) => (
        <g key={t.value}>
          <line x1={padding.left} x2={width - padding.right} y1={t.y} y2={t.y} stroke="rgba(145, 176, 207, 0.12)" />
          <text x={padding.left - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="#8fa3ba">{t.value}</text>
        </g>
      ))}
      {fillColor && <path d={areaD} fill={fillColor} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.label} cx={p.x} cy={p.y} r={3} fill={color}>
          <title>{`${p.label}: ${p.value}`}</title>
        </circle>
      ))}
      {points.length > 0 && (
        <>
          <text x={points[0].x} y={height - 8} fontSize={10} fill="#8fa3ba" textAnchor="start">{points[0].label}</text>
          <text x={points[points.length - 1].x} y={height - 8} fontSize={10} fill="#8fa3ba" textAnchor="end">
            {points[points.length - 1].label}
          </text>
        </>
      )}
    </svg>
  )
}

function StackedAreaChart({ width, height, snapshots }: { width: number; height: number; snapshots: SecuritySnapshot[] }) {
  const padding = { top: 24, right: 16, bottom: 28, left: 44 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  if (snapshots.length === 0) {
    return <svg width={width} height={height}><text x={width / 2} y={height / 2} textAnchor="middle" fill="#8fa3ba" fontSize={12}>No data</text></svg>
  }

  const maxTotal = Math.max(1, ...snapshots.map((s) => s.findingCounts.high + s.findingCounts.medium + s.findingCounts.low))
  const n = snapshots.length
  const xStep = n > 1 ? innerW / (n - 1) : 0

  function series(getValue: (s: SecuritySnapshot) => number, offset: (s: SecuritySnapshot) => number): string {
    const pts = snapshots.map((s, i) => ({
      x: padding.left + i * xStep,
      yTop: padding.top + innerH - ((offset(s) + getValue(s)) / maxTotal) * innerH,
      yBottom: padding.top + innerH - (offset(s) / maxTotal) * innerH
    }))
    const top = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yTop}`).join(' ')
    const bottom = pts.slice().reverse().map((p) => `L ${p.x} ${p.yBottom}`).join(' ')
    return `${top} ${bottom} Z`
  }

  return (
    <svg width={width} height={height} className="stv-chart">
      <text x={padding.left} y={padding.top - 8} fill="#a6bbcf" fontSize={11} fontWeight={600}>Findings by severity</text>
      <path d={series((s) => s.findingCounts.low, (s) => s.findingCounts.high + s.findingCounts.medium)} fill="rgba(234, 179, 8, 0.28)" stroke="#facc15" strokeWidth={1} />
      <path d={series((s) => s.findingCounts.medium, (s) => s.findingCounts.high)} fill="rgba(245, 158, 11, 0.28)" stroke="#fbbf24" strokeWidth={1} />
      <path d={series((s) => s.findingCounts.high, () => 0)} fill="rgba(239, 68, 68, 0.32)" stroke="#ff8b72" strokeWidth={1} />
      <g transform={`translate(${width - 140}, ${padding.top})`}>
        <rect x={0} y={0} width={10} height={10} fill="#ff8b72" />
        <text x={14} y={9} fontSize={10} fill="#dce8f5">High</text>
        <rect x={0} y={14} width={10} height={10} fill="#fbbf24" />
        <text x={14} y={23} fontSize={10} fill="#dce8f5">Medium</text>
        <rect x={0} y={28} width={10} height={10} fill="#facc15" />
        <text x={14} y={37} fontSize={10} fill="#dce8f5">Low</text>
      </g>
    </svg>
  )
}

function DomainBreakdownChart({ width, height, snapshots }: { width: number; height: number; snapshots: SecuritySnapshot[] }) {
  const padding = { top: 24, right: 16, bottom: 28, left: 44 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  if (snapshots.length === 0) {
    return <svg width={width} height={height}><text x={width / 2} y={height / 2} textAnchor="middle" fill="#8fa3ba" fontSize={12}>No data</text></svg>
  }

  const domains: SecurityScoreDomain[] = ['iam', 'network', 'encryption', 'logging', 'compliance']
  const n = snapshots.length
  const xStep = n > 1 ? innerW / (n - 1) : 0

  function pathFor(domain: SecurityScoreDomain): string {
    return snapshots.map((s, i) => {
      const x = padding.left + i * xStep
      const y = padding.top + innerH - (s.domainScores[domain] / 100) * innerH
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
  }

  return (
    <svg width={width} height={height} className="stv-chart">
      <text x={padding.left} y={padding.top - 8} fill="#a6bbcf" fontSize={11} fontWeight={600}>Domain scores over time</text>
      {[0, 50, 100].map((v) => {
        const y = padding.top + innerH - (v / 100) * innerH
        return (
          <g key={v}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(145, 176, 207, 0.12)" />
            <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#8fa3ba">{v}</text>
          </g>
        )
      })}
      {domains.map((d) => (
        <path key={d} d={pathFor(d)} fill="none" stroke={DOMAIN_COLORS[d]} strokeWidth={1.8} />
      ))}
      <g transform={`translate(${width - 110}, ${padding.top})`}>
        {domains.map((d, i) => (
          <g key={d} transform={`translate(0, ${i * 14})`}>
            <rect x={0} y={0} width={10} height={10} fill={DOMAIN_COLORS[d]} />
            <text x={14} y={9} fontSize={10} fill="#dce8f5">{DOMAIN_LABELS[d]}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

/* ── Sub-components ──────────────────────────────────── */

function AlertsPanel({ alerts }: { alerts: SecurityAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="success-banner">
        <strong>All clear.</strong>
        <span style={{ marginLeft: 8 }}>No threshold breaches in the selected range.</span>
      </div>
    )
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Active alerts</h3>
      </div>
      <div className="stv-alert-list">
        {alerts.map((alert) => {
          const style =
            alert.severity === 'high'
              ? { bg: 'rgba(239, 68, 68, 0.16)', fg: '#ff8b72' }
              : alert.severity === 'medium'
                ? { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24' }
                : { bg: 'rgba(234, 179, 8, 0.14)', fg: '#facc15' }
          return (
            <div key={alert.id} className="stv-alert-row">
              <span
                className="eks-badge"
                style={{ background: style.bg, color: style.fg, fontSize: '0.68rem', fontWeight: 700 }}
              >
                {alert.severity.toUpperCase()}
              </span>
              <div className="stv-alert-body">
                <strong>{alert.message}</strong>
                <small>{alert.detail}</small>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ThresholdsEditor({
  thresholds,
  onSave
}: {
  thresholds: SecurityThresholds
  onSave: (update: SecurityThresholds) => Promise<void>
}) {
  const [draft, setDraft] = useState(thresholds)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => { setDraft(thresholds) }, [thresholds])

  async function handleSave() {
    setSaving(true)
    setSavedMsg('')
    try {
      await onSave(draft)
      setSavedMsg('Thresholds saved')
      setTimeout(() => setSavedMsg(''), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Alert thresholds</h3>
        <small style={{ color: '#8fa3ba' }}>
          Alerts fire when a snapshot breaches any of these thresholds.
        </small>
      </div>
      <div className="stv-threshold-body">
        <label className="field">
          <span>Minimum overall score</span>
          <input
            type="number" min={0} max={100}
            value={draft.minOverallScore}
            onChange={(e) => setDraft({ ...draft, minOverallScore: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Max high-severity findings</span>
          <input
            type="number" min={0}
            value={draft.maxHighFindings}
            onChange={(e) => setDraft({ ...draft, maxHighFindings: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Max total findings</span>
          <input
            type="number" min={0}
            value={draft.maxTotalFindings}
            onChange={(e) => setDraft({ ...draft, maxTotalFindings: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Alert on score drop (%)</span>
          <input
            type="number" min={0} max={100}
            value={draft.scoreDropPct}
            onChange={(e) => setDraft({ ...draft, scoreDropPct: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="stv-threshold-actions">
        <button type="button" className="svc-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving\u2026' : 'Save thresholds'}
        </button>
        {savedMsg && <span style={{ color: '#5cc58c', fontSize: '0.8rem', fontWeight: 600 }}>{savedMsg}</span>}
      </div>
    </section>
  )
}

/* ── Main component ──────────────────────────────────── */

export function SecurityTrendsView({ initialScope }: { initialScope?: string } = {}) {
  const [scopes, setScopes] = useState<Array<{ scope: string; scopeLabel: string; snapshotCount: number }>>([])
  const [activeScope, setActiveScope] = useState<string>(initialScope ?? '')
  const [range, setRange] = useState<SecurityTrendRange>('30d')
  const [report, setReport] = useState<SecurityTrendReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<MainTab>('overview')

  useEffect(() => {
    let cancelled = false
    listSecurityScopes()
      .then((s) => {
        if (cancelled) return
        setScopes(s)
        if (!activeScope && s.length > 0) setActiveScope(s[0].scope)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  async function loadReport() {
    if (!activeScope) return
    setLoading(true)
    setError('')
    try {
      const r = await buildSecurityTrendReport(activeScope, range)
      setReport(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeScope) void loadReport()
  }, [activeScope, range])

  async function handleThresholdsSave(update: SecurityThresholds): Promise<void> {
    await updateSecurityThresholds(update)
    await loadReport()
  }

  const scopeLabel = useMemo(() => {
    const found = scopes.find((s) => s.scope === activeScope)
    return found?.scopeLabel ?? activeScope
  }, [scopes, activeScope])

  if (scopes.length === 0 && !loading && !error) {
    return (
      <div className="svc-console stack">
        <section className="iam-shell-hero">
          <div className="iam-shell-hero-copy">
            <div className="eyebrow">Security posture</div>
            <h2>Security Trends &amp; Historical Analysis</h2>
            <p>
              Snapshots are captured automatically each time you open the Security Posture
              Dashboard. Run a posture scan first, then return here to see trends.
            </p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="svc-console stack stv-console">
      {/* Hero */}
      <section className="iam-shell-hero">
        <div className="iam-shell-hero-copy">
          <div className="eyebrow">Security posture</div>
          <h2>Security Trends &amp; Historical Analysis</h2>
          <p>
            Track security posture over time. Daily snapshots capture overall score, findings
            by severity, compliance pass rate, and new vs. remediated counts.
          </p>
          <div className="iam-shell-meta-strip">
            <div className="iam-shell-meta-pill">
              <span>Scope</span><strong>{scopeLabel}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Range</span><strong>{RANGES.find((r) => r.id === range)?.label}</strong>
            </div>
            {report && (
              <>
                <div className="iam-shell-meta-pill">
                  <span>Snapshots</span><strong>{report.summary.snapshotCount}</strong>
                </div>
                <div className="iam-shell-meta-pill">
                  <span>Active alerts</span><strong>{report.alerts.length}</strong>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="iam-shell-hero-stats">
          <div className="iam-shell-stat-card iam-shell-stat-card-accent">
            <span>Current score</span>
            <strong>{report?.summary.currentScore ?? '-'}</strong>
            <small>Most recent snapshot</small>
          </div>
          <div className="iam-shell-stat-card">
            <span>Previous</span>
            <strong>{report?.summary.previousScore ?? '-'}</strong>
            <small>Second-to-last snapshot</small>
          </div>
          <div
            className="iam-shell-stat-card"
            style={{
              borderColor: report?.summary.trendDirection === 'up'
                ? 'rgba(89, 197, 140, 0.28)'
                : report?.summary.trendDirection === 'down'
                  ? 'rgba(239, 68, 68, 0.28)'
                  : 'rgba(145, 176, 207, 0.14)'
            }}
          >
            <span>Trend</span>
            <strong
              style={{
                color: report?.summary.trendDirection === 'up'
                  ? '#5cc58c'
                  : report?.summary.trendDirection === 'down'
                    ? '#ff8b72'
                    : '#edf4fb'
              }}
            >
              {report
                ? `${report.summary.trendDirection === 'up' ? '\u2191' : report.summary.trendDirection === 'down' ? '\u2193' : '\u2192'} ${report.summary.scoreDelta > 0 ? '+' : ''}${report.summary.scoreDelta}`
                : '-'}
            </strong>
            <small>Since previous snapshot</small>
          </div>
          <div className="iam-shell-stat-card">
            <span>Alerts</span>
            <strong style={{ color: (report?.alerts.length ?? 0) > 0 ? '#ff8b72' : '#5cc58c' }}>
              {report?.alerts.length ?? 0}
            </strong>
            <small>Threshold breaches</small>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="iam-shell-toolbar">
        <div className="iam-tab-bar">
          {MAIN_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`svc-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="field" style={{ minWidth: 200 }}>
              <span>Scope</span>
              <select value={activeScope} onChange={(e) => setActiveScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s.scope} value={s.scope}>
                    {s.scopeLabel} ({s.snapshotCount})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Range</span>
              <select value={range} onChange={(e) => setRange(e.target.value as SecurityTrendRange)}>
                {RANGES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="svc-btn" onClick={loadReport} disabled={loading}>
              {loading ? 'Loading\u2026' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && !report ? (
        <SvcState variant="loading" resourceName="security trends" />
      ) : report && report.snapshots.length === 0 ? (
        <section className="panel stack">
          <div className="panel-header">
            <h3>No snapshots in this range</h3>
            <small style={{ color: '#8fa3ba' }}>
              Try a longer time range, or capture a new snapshot from the Security Posture Dashboard.
            </small>
          </div>
        </section>
      ) : report ? (
        <>
          {tab === 'overview' && (
            <>
              <AlertsPanel alerts={report.alerts} />
              <section className="panel stack">
                <div className="panel-header">
                  <h3>Overall score</h3>
                </div>
                <LineChart
                  width={1100} height={240}
                  snapshots={report.snapshots}
                  valueKey={(s) => s.overallScore}
                  color="#f59a3d"
                  fillColor="rgba(245, 154, 61, 0.16)"
                  label="Security score (0-100)"
                />
              </section>
              <section className="panel stack">
                <div className="panel-header">
                  <h3>Findings by severity</h3>
                </div>
                <StackedAreaChart width={1100} height={240} snapshots={report.snapshots} />
              </section>
              <section className="panel stack">
                <div className="panel-header">
                  <h3>Compliance pass rate</h3>
                </div>
                <LineChart
                  width={1100} height={220}
                  snapshots={report.snapshots}
                  valueKey={(s) => s.complianceBenchmarkPassRate}
                  color="#5cc58c"
                  fillColor="rgba(92, 197, 140, 0.14)"
                  label="Compliance benchmark pass rate (%)"
                />
              </section>
            </>
          )}

          {tab === 'domains' && (
            <section className="panel stack">
              <div className="panel-header">
                <h3>Per-domain scores</h3>
              </div>
              <DomainBreakdownChart width={1100} height={260} snapshots={report.snapshots} />
            </section>
          )}

          {tab === 'snapshots' && (
            <section className="panel stack">
              <div className="panel-header">
                <h3>Recent snapshots</h3>
              </div>
              <div className="table-scroller">
                <table className="svc-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th style={{ textAlign: 'right' }}>High</th>
                      <th style={{ textAlign: 'right' }}>Medium</th>
                      <th style={{ textAlign: 'right' }}>Low</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Compliance %</th>
                      <th style={{ textAlign: 'right' }}>New</th>
                      <th style={{ textAlign: 'right' }}>Remediated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.snapshots].reverse().slice(0, 30).map((s) => (
                      <tr key={s.id}>
                        <td>{s.capturedAt}</td>
                        <td style={{ textAlign: 'right' }}><strong>{s.overallScore}</strong></td>
                        <td style={{ textAlign: 'right', color: '#ff8b72' }}>{s.findingCounts.high}</td>
                        <td style={{ textAlign: 'right', color: '#fbbf24' }}>{s.findingCounts.medium}</td>
                        <td style={{ textAlign: 'right', color: '#facc15' }}>{s.findingCounts.low}</td>
                        <td style={{ textAlign: 'right' }}>{s.findingCounts.total}</td>
                        <td style={{ textAlign: 'right' }}>{s.complianceBenchmarkPassRate}%</td>
                        <td style={{ textAlign: 'right', color: '#ff8b72' }}>+{s.newFindings}</td>
                        <td style={{ textAlign: 'right', color: '#5cc58c' }}>-{s.remediatedFindings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'thresholds' && (
            <>
              <AlertsPanel alerts={report.alerts} />
              <ThresholdsEditor thresholds={report.thresholds} onSave={handleThresholdsSave} />
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
