import { useEffect, useMemo, useState } from 'react'
import './azure-defender-console.css'
import { SvcState } from './SvcState'

import type {
  AzureDefenderAlert,
  AzureDefenderAlertSeverity,
  AzureDefenderRecommendation,
  AzureDefenderReport
} from '@shared/types'
import { getAzureDefenderReport } from './api'

type MainTab = 'overview' | 'recommendations' | 'alerts' | 'compliance' | 'attack-paths'

const MAIN_TABS: Array<{ id: MainTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'attack-paths', label: 'Attack paths' }
]

const SEVERITY_ORDER: AzureDefenderAlertSeverity[] = ['high', 'medium', 'low', 'informational']

const SEVERITY_STYLE: Record<AzureDefenderAlertSeverity, { bg: string; fg: string; label: string }> = {
  high: { bg: 'rgba(239, 68, 68, 0.16)', fg: '#ff8b72', label: 'High' },
  medium: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24', label: 'Medium' },
  low: { bg: 'rgba(234, 179, 8, 0.14)', fg: '#facc15', label: 'Low' },
  informational: { bg: 'rgba(74, 143, 231, 0.18)', fg: '#7ab5ff', label: 'Info' }
}

function scoreTone(score: number): string {
  if (score >= 80) return '#5cc58c'
  if (score >= 60) return '#facc15'
  if (score >= 40) return '#f59a3d'
  return '#ff8b72'
}

function SeverityBadge({ severity }: { severity: AzureDefenderAlertSeverity }) {
  const s = SEVERITY_STYLE[severity]
  return (
    <span
      className="eks-badge"
      style={{ background: s.bg, color: s.fg, fontWeight: 600, fontSize: '0.7rem' }}
    >
      {s.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'healthy'
      ? { bg: 'rgba(89, 197, 140, 0.2)', fg: '#5cc58c' }
      : status === 'unhealthy'
        ? { bg: 'rgba(239, 68, 68, 0.16)', fg: '#ff8b72' }
        : { bg: 'rgba(148, 163, 184, 0.18)', fg: '#a6bbcf' }
  return (
    <span
      className="eks-badge"
      style={{ background: tone.bg, color: tone.fg, fontWeight: 600, fontSize: '0.7rem' }}
    >
      {status}
    </span>
  )
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 14) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const tone = scoreTone(score)

  return (
    <svg width={size} height={size}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(145, 176, 207, 0.12)" strokeWidth={8}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={tone} strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        fill="#edf4fb"
        style={{ fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif", fontSize: '1.5rem', fontWeight: 700 }}
      >
        {score}%
      </text>
    </svg>
  )
}

function truncateArn(resourceId: string): string {
  if (!resourceId) return '-'
  const parts = resourceId.split('/')
  return parts[parts.length - 1] || resourceId
}

function formatTimestamp(value: string): string {
  if (!value) return '-'
  try { return new Date(value).toLocaleString() } catch { return value }
}

/* ── Tabs ────────────────────────────────────────────── */

function OverviewTab({ report }: { report: AzureDefenderReport }) {
  return (
    <div className="stack adf-overview">
      <section className="panel stack">
        <div className="panel-header">
          <h3>Security controls (lowest scoring)</h3>
          <small style={{ color: '#8fa3ba' }}>
            Controls grouped by secure score contribution. Address these first to improve posture.
          </small>
        </div>
        {report.secureScoreControls.length === 0 ? (
          <SvcState variant="empty" resourceName="secure score controls" />
        ) : (
          <div className="table-scroller">
            <table className="svc-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Score</th>
                  <th style={{ textAlign: 'right' }}>Unhealthy</th>
                  <th style={{ textAlign: 'right' }}>Healthy</th>
                  <th style={{ textAlign: 'right' }}>N/A</th>
                </tr>
              </thead>
              <tbody>
                {report.secureScoreControls.slice(0, 12).map((ctrl) => (
                  <tr key={ctrl.id}>
                    <td>{ctrl.displayName}</td>
                    <td>
                      <div className="adf-bar-cell">
                        <div className="spd-domain-bar-track" style={{ flex: 1 }}>
                          <div
                            className="spd-domain-bar-fill"
                            style={{ width: `${ctrl.percentage}%`, backgroundColor: scoreTone(ctrl.percentage) }}
                          />
                        </div>
                        <strong style={{ minWidth: 40, textAlign: 'right', color: scoreTone(ctrl.percentage) }}>
                          {ctrl.percentage}%
                        </strong>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', color: '#ff8b72' }}>{ctrl.unhealthyResourceCount}</td>
                    <td style={{ textAlign: 'right', color: '#5cc58c' }}>{ctrl.healthyResourceCount}</td>
                    <td style={{ textAlign: 'right', color: '#8fa3ba' }}>{ctrl.notApplicableResourceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function RecommendationsTab({ recommendations }: { recommendations: AzureDefenderRecommendation[] }) {
  const [severityFilter, setSeverityFilter] = useState<'all' | AzureDefenderAlertSeverity>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'unhealthy' | 'healthy'>('unhealthy')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      return true
    })
  }, [recommendations, severityFilter, statusFilter])

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Security recommendations</h3>
        <div className="adf-filter-row">
          <label className="field">
            <span>Severity</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'all' | AzureDefenderAlertSeverity)}
            >
              <option value="all">All</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>{SEVERITY_STYLE[s].label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'unhealthy' | 'healthy')}>
              <option value="unhealthy">Unhealthy</option>
              <option value="healthy">Healthy</option>
              <option value="all">All</option>
            </select>
          </label>
          <span style={{ color: '#8fa3ba', fontSize: '0.78rem', marginLeft: 'auto' }}>
            {filtered.length} recommendation{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      {filtered.length === 0 ? (
        <SvcState variant="empty" resourceName="recommendations" />
      ) : (
        <div className="table-scroller">
          <table className="svc-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Recommendation</th>
                <th>Category</th>
                <th>Status</th>
                <th>Resource</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((r) => (
                <>
                  <tr
                    key={r.id}
                    className={expanded === r.id ? 'selected' : ''}
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><SeverityBadge severity={r.severity} /></td>
                    <td>{r.displayName}</td>
                    <td style={{ color: '#8fa3ba' }}>{r.category}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>
                      {truncateArn(r.resourceId)}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={5} className="adf-detail-cell">
                        <div className="adf-detail-content">
                          {r.description && (
                            <div><span className="adf-detail-label">Description</span>{r.description}</div>
                          )}
                          {r.remediation && (
                            <div><span className="adf-detail-label">Remediation</span>{r.remediation}</div>
                          )}
                          {r.resourceId && (
                            <div>
                              <span className="adf-detail-label">Resource ID</span>
                              <code>{r.resourceId}</code>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AlertsTab({ alerts }: { alerts: AzureDefenderAlert[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (alerts.length === 0) {
    return <SvcState variant="empty" resourceName="security alerts" message="No active security alerts." />
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Security alerts</h3>
      </div>
      <div className="table-scroller">
        <table className="svc-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Alert</th>
              <th>Status</th>
              <th>Compromised entity</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <>
                <tr
                  key={a.id}
                  className={expanded === a.id ? 'selected' : ''}
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td><SeverityBadge severity={a.severity} /></td>
                  <td>{a.alertDisplayName}</td>
                  <td style={{ color: '#8fa3ba' }}>{a.status}</td>
                  <td>{a.compromisedEntity || '-'}</td>
                  <td style={{ color: '#8fa3ba', whiteSpace: 'nowrap' }}>{formatTimestamp(a.timeGenerated)}</td>
                </tr>
                {expanded === a.id && (
                  <tr key={`${a.id}-detail`}>
                    <td colSpan={5} className="adf-detail-cell">
                      <div className="adf-detail-content">
                        <div><span className="adf-detail-label">Description</span>{a.description || '(none)'}</div>
                        {a.intent && <div><span className="adf-detail-label">Intent</span>{a.intent}</div>}
                        <div><span className="adf-detail-label">Vendor</span>{a.vendor}</div>
                        {a.resourceId && (
                          <div><span className="adf-detail-label">Resource</span><code>{a.resourceId}</code></div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ComplianceTab({ standards }: { standards: AzureDefenderReport['complianceStandards'] }) {
  if (standards.length === 0) {
    return (
      <SvcState
        variant="empty"
        resourceName="compliance standards"
        message="No regulatory compliance standards are tracked for this subscription."
      />
    )
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Regulatory compliance</h3>
      </div>
      <div className="adf-compliance-grid">
        {standards.map((s) => (
          <div key={s.id} className="adf-compliance-card">
            <div className="adf-compliance-head">
              <strong>{s.displayName}</strong>
              <span className="eks-badge" style={{ background: 'rgba(74, 143, 231, 0.16)', color: '#7ab5ff', fontSize: '0.65rem' }}>
                {s.state}
              </span>
            </div>
            <div className="adf-compliance-ring"><ScoreRing score={s.compliancePercentage} size={100} /></div>
            <div className="adf-compliance-stats">
              <div><span style={{ color: '#5cc58c' }}>Passed</span><strong>{s.passedControls}</strong></div>
              <div><span style={{ color: '#ff8b72' }}>Failed</span><strong>{s.failedControls}</strong></div>
              <div><span style={{ color: '#8fa3ba' }}>Skipped</span><strong>{s.skippedControls}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AttackPathsTab({ paths }: { paths: AzureDefenderReport['attackPaths'] }) {
  if (paths.length === 0) {
    return (
      <SvcState
        variant="empty"
        resourceName="attack paths"
        message="Attack path analysis requires Defender CSPM. No attack paths detected or the feature isn't enabled."
      />
    )
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Attack paths</h3>
      </div>
      <div className="adf-attack-path-list">
        {paths.map((p) => (
          <div key={p.id} className="adf-attack-path-card">
            <div className="adf-attack-path-head">
              <SeverityBadge severity={p.riskLevel} />
              <strong>{p.displayName}</strong>
            </div>
            {p.description && <p className="adf-attack-path-desc">{p.description}</p>}
            <div className="adf-attack-path-meta">
              {p.entryPoint && (
                <div><span className="adf-detail-label">Entry point</span>{p.entryPoint}</div>
              )}
              <div>
                <span className="adf-detail-label">Target</span>
                <code>{truncateArn(p.targetResourceId)}</code>
              </div>
              <div><span className="adf-detail-label">Steps</span>{p.stepCount}</div>
              {p.riskCategories.length > 0 && (
                <div>
                  <span className="adf-detail-label">Risk categories</span>
                  {p.riskCategories.map((c, i) => (
                    <span key={i} className="eks-badge" style={{ background: 'rgba(245, 154, 61, 0.16)', color: '#ffcf98', fontSize: '0.65rem', marginRight: 4 }}>
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── Main Console ─────────────────────────────────────── */

export function AzureDefenderConsole({
  subscriptionId,
  refreshNonce = 0
}: {
  subscriptionId: string
  refreshNonce?: number
}) {
  const [report, setReport] = useState<AzureDefenderReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<MainTab>('overview')

  async function loadReport() {
    if (!subscriptionId) return
    setLoading(true)
    setError('')
    try {
      const result = await getAzureDefenderReport(subscriptionId)
      setReport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReport()
  }, [subscriptionId, refreshNonce])

  if (!subscriptionId) {
    return (
      <SvcState
        variant="empty"
        resourceName="Defender for Cloud"
        message="Select an Azure subscription to view Defender data."
      />
    )
  }

  if (loading && !report) {
    return <SvcState variant="loading" resourceName="Defender for Cloud" />
  }

  if (error && !report) {
    return <SvcState variant="error" resourceName="Defender for Cloud" error={error} />
  }

  if (!report) {
    return <SvcState variant="empty" resourceName="Defender for Cloud" />
  }

  const secure = report.secureScore
  const unhealthyCount = report.recommendations.filter((r) => r.status === 'unhealthy').length

  return (
    <div className="svc-console stack adf-console azure-rbac-theme">
      {/* Hero */}
      <section className="iam-shell-hero">
        <div className="iam-shell-hero-copy">
          <div className="eyebrow">Cloud security</div>
          <h2>Microsoft Defender for Cloud</h2>
          <p>
            Secure score, security recommendations, alerts, regulatory compliance, and
            attack path analysis for the selected Azure subscription.
          </p>
          <div className="iam-shell-meta-strip">
            <div className="iam-shell-meta-pill">
              <span>Subscription</span><strong>{`${subscriptionId.slice(0, 12)}…`}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Alerts</span><strong>{report.alerts.length}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Recommendations</span><strong>{unhealthyCount}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Generated</span><strong>{new Date(report.generatedAt).toLocaleTimeString()}</strong>
            </div>
          </div>
        </div>
        <div className="iam-shell-hero-stats">
          {secure ? (
            <div className="iam-shell-stat-card iam-shell-stat-card-accent adf-hero-score-card">
              <ScoreRing score={secure.percentage} size={112} />
              <div className="adf-hero-score-copy">
                <span>Secure score</span>
                <strong>{secure.currentScore.toFixed(1)} / {secure.maxScore}</strong>
                <small>{secure.displayName}</small>
              </div>
            </div>
          ) : (
            <div className="iam-shell-stat-card iam-shell-stat-card-accent">
              <span>Secure score</span>
              <strong>N/A</strong>
              <small>Not available for this subscription</small>
            </div>
          )}
          <div className="iam-shell-stat-card" style={{ borderColor: 'rgba(239, 68, 68, 0.28)' }}>
            <span>High alerts</span>
            <strong style={{ color: '#ff8b72' }}>{report.alertsBySeverity.high ?? 0}</strong>
            <small>Active threats</small>
          </div>
          <div className="iam-shell-stat-card" style={{ borderColor: 'rgba(245, 158, 11, 0.28)' }}>
            <span>Medium alerts</span>
            <strong style={{ color: '#fbbf24' }}>{report.alertsBySeverity.medium ?? 0}</strong>
            <small>Suspicious activity</small>
          </div>
          <div className="iam-shell-stat-card">
            <span>Attack paths</span>
            <strong>{report.attackPaths.length}</strong>
            <small>Detected routes</small>
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
          <div style={{ marginLeft: 'auto' }}>
            <button type="button" className="svc-btn" onClick={loadReport} disabled={loading}>
              {loading ? 'Refreshing\u2026' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="error-banner">
          {report.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '0.82rem' }}>{w}</div>
          ))}
        </div>
      )}

      {tab === 'overview' && <OverviewTab report={report} />}
      {tab === 'recommendations' && <RecommendationsTab recommendations={report.recommendations} />}
      {tab === 'alerts' && <AlertsTab alerts={report.alerts} />}
      {tab === 'compliance' && <ComplianceTab standards={report.complianceStandards} />}
      {tab === 'attack-paths' && <AttackPathsTab paths={report.attackPaths} />}
    </div>
  )
}
