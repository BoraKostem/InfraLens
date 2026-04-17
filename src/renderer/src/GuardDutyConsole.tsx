import { useEffect, useMemo, useState } from 'react'
import './guardduty-console.css'
import { SvcState } from './SvcState'
import { FreshnessIndicator, useFreshnessState } from './freshness'

import type {
  AwsConnection,
  GuardDutyFinding,
  GuardDutyReport,
  GuardDutySeverity
} from '@shared/types'
import { archiveGuardDutyFindings, getGuardDutyReport, invalidatePageCache } from './api'

type MainTab = 'findings' | 'categories' | 'targets'

const MAIN_TABS: Array<{ id: MainTab; label: string }> = [
  { id: 'findings', label: 'Findings' },
  { id: 'categories', label: 'Threat categories' },
  { id: 'targets', label: 'Top targets' }
]

const SEVERITY_ORDER: GuardDutySeverity[] = ['critical', 'high', 'medium', 'low']

const SEVERITY_STYLE: Record<GuardDutySeverity, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'rgba(220, 38, 38, 0.18)', fg: '#ff6b5a', label: 'Critical' },
  high: { bg: 'rgba(239, 68, 68, 0.16)', fg: '#ff8b72', label: 'High' },
  medium: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24', label: 'Medium' },
  low: { bg: 'rgba(234, 179, 8, 0.14)', fg: '#facc15', label: 'Low' }
}

function SeverityBadge({ severity }: { severity: GuardDutySeverity }) {
  const style = SEVERITY_STYLE[severity]
  return (
    <span
      className="eks-badge"
      style={{ background: style.bg, color: style.fg, fontWeight: 600, fontSize: '0.7rem' }}
    >
      {style.label}
    </span>
  )
}

function formatTimestamp(value: string): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function truncate(value: string, max = 60): string {
  if (!value) return '-'
  return value.length <= max ? value : value.slice(0, max - 3) + '...'
}

/* ── Sub-tabs ─────────────────────────────────────────── */

function FindingsTab({
  findings,
  severityCounts,
  categories,
  onArchive,
  archiving
}: {
  findings: GuardDutyFinding[]
  severityCounts: GuardDutyReport['severityCounts']
  categories: string[]
  onArchive: (ids: string[]) => Promise<void>
  archiving: boolean
}) {
  const [severityFilter, setSeverityFilter] = useState<'all' | GuardDutySeverity>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
      return true
    })
  }, [findings, severityFilter, categoryFilter])

  async function handleArchive() {
    if (selected.size === 0) return
    await onArchive(Array.from(selected))
    setSelected(new Set())
  }

  return (
    <section className="panel stack gd-findings-panel">
      <div className="panel-header gd-findings-header">
        <h3>Active findings</h3>
        <div className="gd-findings-toolbar">
          <label className="field">
            <span>Severity</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'all' | GuardDutySeverity)}
            >
              <option value="all">All</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_STYLE[s].label} ({severityCounts[s]})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="svc-btn"
            disabled={selected.size === 0 || archiving}
            onClick={handleArchive}
          >
            {archiving ? 'Archiving\u2026' : `Archive selected (${selected.size})`}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <SvcState variant="empty" resourceName="findings" message="No findings match the current filters." />
      ) : (
        <div className="table-scroller">
          <table className="svc-table gd-findings-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((f) => f.id)))
                      else setSelected(new Set())
                    }}
                  />
                </th>
                <th>Severity</th>
                <th>Title</th>
                <th>Category</th>
                <th>Resource</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((finding) => {
                const isSelected = selected.has(finding.id)
                const isExpanded = expanded === finding.id
                return (
                  <>
                    <tr
                      key={finding.id}
                      className={isSelected ? 'selected' : ''}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(finding.id)) next.delete(finding.id)
                              else next.add(finding.id)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td><SeverityBadge severity={finding.severity} /></td>
                      <td>
                        <button
                          type="button"
                          className="gd-finding-title-btn"
                          onClick={() => setExpanded(isExpanded ? null : finding.id)}
                        >
                          {finding.title}
                        </button>
                      </td>
                      <td className="gd-muted-cell">{finding.category}</td>
                      <td className="gd-resource-cell" title={finding.resourceId}>
                        {truncate(finding.resourceId, 40)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{finding.count}</td>
                      <td className="gd-muted-cell">{formatTimestamp(finding.lastSeenAt)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${finding.id}-detail`} className="gd-detail-row">
                        <td colSpan={7}>
                          <div className="gd-detail-content">
                            <div><span className="gd-detail-label">Type</span><code>{finding.type}</code></div>
                            <div><span className="gd-detail-label">Description</span>{finding.description}</div>
                            <div>
                              <span className="gd-detail-label">Resource</span>
                              <code>{finding.resourceType} / {finding.resourceId}</code>
                            </div>
                            <div>
                              <span className="gd-detail-label">First seen</span>{formatTimestamp(finding.firstSeenAt)}
                              <span className="gd-detail-separator">|</span>
                              <span className="gd-detail-label">Last seen</span>{formatTimestamp(finding.lastSeenAt)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CategoriesTab({ breakdown }: { breakdown: Record<string, number> }) {
  const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a)

  if (sorted.length === 0) {
    return <SvcState variant="empty" resourceName="threat categories" />
  }

  const max = sorted[0][1]

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Threat categories</h3>
      </div>
      <div className="gd-bars">
        {sorted.map(([category, count]) => (
          <div key={category} className="gd-bar-row">
            <span className="gd-bar-label">{category}</span>
            <div className="spd-domain-bar-track">
              <div
                className="spd-domain-bar-fill"
                style={{ width: `${(count / max) * 100}%`, backgroundColor: '#f59a3d' }}
              />
            </div>
            <strong className="gd-bar-count">{count}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function TargetsTab({ targets }: { targets: GuardDutyReport['topTargetedResources'] }) {
  if (targets.length === 0) {
    return <SvcState variant="empty" resourceName="targeted resources" />
  }

  return (
    <section className="panel stack">
      <div className="panel-header">
        <h3>Top targeted resources</h3>
      </div>
      <div className="table-scroller">
        <table className="svc-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th style={{ textAlign: 'right' }}>Findings</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.resourceId}>
                <td><code>{t.resourceId}</code></td>
                <td style={{ textAlign: 'right' }}>{t.findingCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ── Main Console ─────────────────────────────────────── */

export function GuardDutyConsole({
  connection,
  refreshNonce = 0
}: {
  connection: AwsConnection
  refreshNonce?: number
}) {
  const [report, setReport] = useState<GuardDutyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [tab, setTab] = useState<MainTab>('findings')
  const freshness = useFreshnessState()

  async function loadReport() {
    setLoading(true)
    setError('')
    freshness.beginRefresh()
    try {
      const result = await getGuardDutyReport(connection)
      setReport(result)
      freshness.completeRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      freshness.failRefresh()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReport()
  }, [connection.profile, connection.region, refreshNonce])

  function handleRefresh() {
    invalidatePageCache('guardduty')
    void loadReport()
  }

  async function handleArchive(ids: string[]) {
    setArchiving(true)
    try {
      await archiveGuardDutyFindings(connection, ids)
      invalidatePageCache('guardduty')
      await loadReport()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  if (loading && !report) {
    return <SvcState variant="loading" resourceName="GuardDuty" />
  }

  if (error && !report) {
    return <SvcState variant="error" resourceName="GuardDuty" error={error} />
  }

  if (!report) {
    return <SvcState variant="empty" resourceName="GuardDuty" />
  }

  if (!report.detector) {
    return (
      <div className="svc-console stack">
        <section className="iam-shell-hero">
          <div className="iam-shell-hero-copy">
            <div className="eyebrow">Threat detection</div>
            <h2>GuardDuty</h2>
            <p>GuardDuty is not enabled in <strong>{connection.region}</strong>. Enable it in the AWS Console to start detecting threats.</p>
          </div>
        </section>
        <div className="error-banner">
          GuardDuty detector not configured. Enable GuardDuty from the AWS Console or via the CLI:
          <pre style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'rgba(9, 14, 22, 0.7)', fontSize: '0.78rem' }}>
            aws guardduty create-detector --enable --region {connection.region}
          </pre>
        </div>
      </div>
    )
  }

  const categories = Object.keys(report.categoryBreakdown).sort()
  const totalActive = report.findings.length

  return (
    <div className="svc-console stack gd-console">
      {/* Hero */}
      <section className="iam-shell-hero">
        <div className="iam-shell-hero-copy">
          <div className="eyebrow">Threat detection</div>
          <h2>GuardDuty</h2>
          <p>
            Active findings from AWS GuardDuty threat intelligence. Review by severity,
            investigate details, or archive suppressed findings.
          </p>
          <div className="iam-shell-meta-strip">
            <div className="iam-shell-meta-pill">
              <span>Profile</span><strong>{connection.profile || 'session'}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Region</span><strong>{connection.region}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Detector</span><strong>{`${report.detector.detectorId.slice(0, 12)}…`}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Status</span><strong>{report.detector.status}</strong>
            </div>
          </div>
        </div>
        <div className="iam-shell-hero-stats">
          <div className="iam-shell-stat-card iam-shell-stat-card-accent">
            <span>Active findings</span>
            <strong>{totalActive}</strong>
            <small>Across all severities</small>
          </div>
          <div className="iam-shell-stat-card" style={{ borderColor: 'rgba(220, 38, 38, 0.28)' }}>
            <span>Critical</span>
            <strong style={{ color: '#ff6b5a' }}>{report.severityCounts.critical}</strong>
            <small>Require immediate action</small>
          </div>
          <div className="iam-shell-stat-card" style={{ borderColor: 'rgba(239, 68, 68, 0.28)' }}>
            <span>High</span>
            <strong style={{ color: '#ff8b72' }}>{report.severityCounts.high}</strong>
            <small>High-severity threats</small>
          </div>
          <div className="iam-shell-stat-card" style={{ borderColor: 'rgba(245, 158, 11, 0.28)' }}>
            <span>Medium</span>
            <strong style={{ color: '#fbbf24' }}>{report.severityCounts.medium}</strong>
            <small>Suspicious activity</small>
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
            <FreshnessIndicator freshness={freshness.freshness} />
            <button
              type="button"
              className="svc-btn"
              onClick={handleRefresh}
              disabled={loading}
            >
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

      {tab === 'findings' && (
        <FindingsTab
          findings={report.findings}
          severityCounts={report.severityCounts}
          categories={categories}
          onArchive={handleArchive}
          archiving={archiving}
        />
      )}
      {tab === 'categories' && <CategoriesTab breakdown={report.categoryBreakdown} />}
      {tab === 'targets' && <TargetsTab targets={report.topTargetedResources} />}
    </div>
  )
}
