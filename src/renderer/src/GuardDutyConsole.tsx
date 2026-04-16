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

const SEVERITY_ORDER: GuardDutySeverity[] = ['critical', 'high', 'medium', 'low']

function severityBadgeClass(severity: GuardDutySeverity): string {
  return `gd-severity gd-severity--${severity}`
}

function formatTimestamp(value: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function SeveritySummary({ report }: { report: GuardDutyReport }) {
  return (
    <div className="gd-severity-summary">
      {SEVERITY_ORDER.map((sev) => (
        <div key={sev} className={`gd-severity-card gd-severity-card--${sev}`}>
          <span className="gd-severity-count">{report.severityCounts[sev]}</span>
          <span className="gd-severity-label">{sev}</span>
        </div>
      ))}
    </div>
  )
}

function CategoryBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a)
  if (sorted.length === 0) return null

  return (
    <div className="gd-category-breakdown">
      <h4>Threat Categories</h4>
      <div className="gd-category-bars">
        {sorted.map(([category, count]) => {
          const max = sorted[0][1]
          return (
            <div key={category} className="gd-category-row">
              <span className="gd-category-label">{category}</span>
              <div className="gd-category-track">
                <div
                  className="gd-category-fill"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="gd-category-count">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TopTargets({ targets }: { targets: GuardDutyReport['topTargetedResources'] }) {
  if (targets.length === 0) return null

  return (
    <div className="gd-top-targets">
      <h4>Top Targeted Resources</h4>
      <table className="gd-targets-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Findings</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => (
            <tr key={t.resourceId}>
              <td className="gd-resource-id">{t.resourceId}</td>
              <td>{t.findingCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FindingRow({
  finding,
  selected,
  onToggle,
  onExpand,
  expanded
}: {
  finding: GuardDutyFinding
  selected: boolean
  onToggle: () => void
  onExpand: () => void
  expanded: boolean
}) {
  return (
    <>
      <tr className={`gd-finding-row ${expanded ? 'gd-finding-row--expanded' : ''}`}>
        <td>
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </td>
        <td>
          <span className={severityBadgeClass(finding.severity)}>{finding.severity}</span>
        </td>
        <td>
          <button className="gd-finding-title-btn" onClick={onExpand} type="button">
            {finding.title}
          </button>
        </td>
        <td className="gd-finding-category">{finding.category}</td>
        <td className="gd-finding-resource">{finding.resourceId}</td>
        <td className="gd-finding-count">{finding.count}</td>
        <td className="gd-finding-time">{formatTimestamp(finding.lastSeenAt)}</td>
      </tr>
      {expanded && (
        <tr className="gd-finding-detail-row">
          <td colSpan={7}>
            <div className="gd-finding-detail">
              <div className="gd-detail-section">
                <strong>Type:</strong> {finding.type}
              </div>
              <div className="gd-detail-section">
                <strong>Description:</strong> {finding.description}
              </div>
              <div className="gd-detail-section">
                <strong>Resource:</strong> {finding.resourceType} / {finding.resourceId}
              </div>
              <div className="gd-detail-section">
                <strong>First seen:</strong> {formatTimestamp(finding.firstSeenAt)} |{' '}
                <strong>Last seen:</strong> {formatTimestamp(finding.lastSeenAt)}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

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
  const [severityFilter, setSeverityFilter] = useState<'all' | GuardDutySeverity>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const freshness = useFreshnessState()

  async function loadReport() {
    setLoading(true)
    setError('')
    try {
      const result = await getGuardDutyReport(connection)
      setReport(result)
      setSelectedIds(new Set())
      freshness.markRefreshed()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [connection.profile, connection.region, refreshNonce])

  function handleRefresh() {
    invalidatePageCache('guardduty')
    loadReport()
  }

  async function handleArchiveSelected() {
    if (selectedIds.size === 0) return
    setArchiving(true)
    try {
      await archiveGuardDutyFindings(connection, Array.from(selectedIds))
      invalidatePageCache('guardduty')
      await loadReport()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchiving(false)
    }
  }

  const filteredFindings = useMemo(() => {
    if (!report) return []
    return report.findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
      return true
    })
  }, [report, severityFilter, categoryFilter])

  const categories = useMemo(() => {
    if (!report) return []
    return Object.keys(report.categoryBreakdown).sort()
  }, [report])

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
      <div className="gd-console">
        <div className="gd-not-enabled">
          GuardDuty is not enabled in <strong>{connection.region}</strong>.
          Enable it in the AWS Console to see threat detection findings.
        </div>
      </div>
    )
  }

  return (
    <div className="gd-console">
      <div className="gd-header">
        <h2>GuardDuty Findings</h2>
        <div className="gd-header-actions">
          <FreshnessIndicator state={freshness} />
          <button
            className="btn btn-secondary"
            onClick={handleArchiveSelected}
            disabled={selectedIds.size === 0 || archiving}
            type="button"
          >
            {archiving ? 'Archiving...' : `Archive (${selectedIds.size})`}
          </button>
          <button className="btn btn-primary" onClick={handleRefresh} disabled={loading} type="button">
            {loading ? 'Scanning...' : 'Refresh'}
          </button>
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="gd-warnings">
          {report.warnings.map((w, i) => (
            <div key={i} className="gd-warning">{w}</div>
          ))}
        </div>
      )}

      <SeveritySummary report={report} />

      <div className="gd-insights-row">
        <CategoryBreakdown breakdown={report.categoryBreakdown} />
        <TopTargets targets={report.topTargetedResources} />
      </div>

      <div className="gd-filters">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as 'all' | GuardDutySeverity)}
        >
          <option value="all">All severities</option>
          {SEVERITY_ORDER.map((s) => (
            <option key={s} value={s}>{s} ({report.severityCounts[s]})</option>
          ))}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c} ({report.categoryBreakdown[c]})</option>
          ))}
        </select>
        <span className="gd-filter-count">
          {filteredFindings.length} finding{filteredFindings.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filteredFindings.length === 0 ? (
        <div className="gd-empty-findings">No findings match the current filters.</div>
      ) : (
        <table className="gd-findings-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredFindings.length && filteredFindings.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(filteredFindings.map((f) => f.id)))
                    } else {
                      setSelectedIds(new Set())
                    }
                  }}
                />
              </th>
              <th>Severity</th>
              <th>Title</th>
              <th>Category</th>
              <th>Resource</th>
              <th>Count</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                selected={selectedIds.has(finding.id)}
                onToggle={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(finding.id)) next.delete(finding.id)
                    else next.add(finding.id)
                    return next
                  })
                }}
                expanded={expandedId === finding.id}
                onExpand={() =>
                  setExpandedId(expandedId === finding.id ? null : finding.id)
                }
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
