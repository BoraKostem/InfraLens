import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  AwsConnection,
  CloudTrailEventSummary,
  CloudWatchInvestigationHistoryEntry,
  ServiceId,
  TerraformDriftReport,
  TerraformProject,
  TerraformRunRecord
} from '@shared/types'

import { listCloudWatchInvestigationHistory, lookupCloudTrailEvents } from './api'
import { SvcState } from './SvcState'
import { listRunHistory } from './terraformApi'

type TimelineWindowMode = '30m' | '1h' | 'custom'
type TimelineSource = 'terraform' | 'cloudtrail' | 'cloudwatch' | 'drift'
type TimelineTone = 'info' | 'success' | 'warning' | 'danger'

type TimelineWindow = {
  startIso: string
  endIso: string
  label: string
}

type TimelineItem = {
  id: string
  source: TimelineSource
  tone: TimelineTone
  occurredAt: string
  title: string
  summary: string
  detail: string
  resourceName?: string
  logGroupNames?: string[]
  serviceHint?: ServiceId | ''
}

type TimelineSourceFilter = 'all' | TimelineSource
type TimelineToneFilter = 'all' | TimelineTone

function formatIsoDate(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function toLocalInputValue(date: Date): string {
  const adjusted = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000))
  return adjusted.toISOString().slice(0, 16)
}

function parseLocalInputValue(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveWindow(mode: TimelineWindowMode, customStart: string, customEnd: string): TimelineWindow {
  const now = new Date()
  if (mode === '30m') {
    const start = new Date(now.getTime() - (30 * 60_000))
    return {
      startIso: start.toISOString(),
      endIso: now.toISOString(),
      label: 'Last 30 minutes'
    }
  }

  if (mode === '1h') {
    const start = new Date(now.getTime() - (60 * 60_000))
    return {
      startIso: start.toISOString(),
      endIso: now.toISOString(),
      label: 'Last 1 hour'
    }
  }

  const parsedStart = parseLocalInputValue(customStart) ?? new Date(now.getTime() - (30 * 60_000))
  const parsedEnd = parseLocalInputValue(customEnd) ?? now
  const safeStart = parsedStart.getTime() <= parsedEnd.getTime() ? parsedStart : parsedEnd
  const safeEnd = parsedEnd.getTime() >= parsedStart.getTime() ? parsedEnd : parsedStart

  return {
    startIso: safeStart.toISOString(),
    endIso: safeEnd.toISOString(),
    label: `${formatIsoDate(safeStart.toISOString())} to ${formatIsoDate(safeEnd.toISOString())}`
  }
}

function isWithinWindow(value: string, window: TimelineWindow): boolean {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return false
  return timestamp >= new Date(window.startIso).getTime() && timestamp <= new Date(window.endIso).getTime()
}

function classifyCloudTrailTone(event: CloudTrailEventSummary): TimelineTone {
  const normalized = `${event.eventSource}:${event.eventName}`.toLowerCase()
  if (/delete|detach|remove|destroy|terminate|revoke/.test(normalized)) return 'danger'
  if (/assumerole|attach|put|update|create|passrole|set/.test(normalized)) return 'warning'
  return 'info'
}

function summarizeTerraformRun(record: TerraformRunRecord): { tone: TimelineTone; summary: string } {
  if (record.success === null) {
    return {
      tone: 'info',
      summary: `${record.command} is still running in workspace ${record.workspace}.`
    }
  }

  if (!record.success) {
    return {
      tone: 'danger',
      summary: `${record.command} failed in workspace ${record.workspace}.`
    }
  }

  if (record.command === 'plan' && record.planSummary?.hasDestructiveChanges) {
    return {
      tone: 'warning',
      summary: `plan succeeded with destructive changes in workspace ${record.workspace}.`
    }
  }

  if (record.command === 'apply' || record.command === 'destroy' || record.command === 'import') {
    return {
      tone: 'warning',
      summary: `${record.command} completed successfully in workspace ${record.workspace}.`
    }
  }

  return {
    tone: 'success',
    summary: `${record.command} completed successfully in workspace ${record.workspace}.`
  }
}

function buildTerraformTimelineItems(records: TerraformRunRecord[], window: TimelineWindow): TimelineItem[] {
  return records
    .filter((record) => isWithinWindow(record.finishedAt || record.startedAt, window))
    .map((record) => {
      const outcome = summarizeTerraformRun(record)
      const planSummary = record.planSummary
        ? `${record.planSummary.create} create, ${record.planSummary.update} update, ${record.planSummary.delete} delete, ${record.planSummary.replace} replace`
        : record.stateOperationSummary || 'No structured plan summary captured.'

      return {
        id: `terraform:${record.id}`,
        source: 'terraform',
        tone: outcome.tone,
        occurredAt: record.finishedAt || record.startedAt,
        title: `${record.command.toUpperCase()} • ${record.projectName}`,
        summary: outcome.summary,
        detail: `${planSummary} Region: ${record.region || '-'} • Connection: ${record.connectionLabel || '-'}`
      }
    })
}

function buildCloudTrailTimelineItems(events: CloudTrailEventSummary[]): TimelineItem[] {
  return events
    .filter((event) => !event.readOnly)
    .map((event) => ({
      id: `cloudtrail:${event.eventId}`,
      source: 'cloudtrail',
      tone: classifyCloudTrailTone(event),
      occurredAt: event.eventTime,
      title: `${event.eventName} • ${event.eventSource}`,
      summary: `${event.username || 'Unknown actor'} from ${event.sourceIpAddress || 'unknown IP'} touched ${event.resourceName || event.resourceType || 'an AWS resource'}.`,
      detail: `Region: ${event.awsRegion || '-'} • Resource type: ${event.resourceType || '-'} • Read only: ${event.readOnly ? 'Yes' : 'No'}`,
      resourceName: event.resourceName || undefined
    }))
}

function buildCloudTrailFocusFilter(item: TimelineItem): string {
  const candidates = [
    item.title.split(' • ')[0],
    item.resourceName,
    item.serviceHint
  ].filter(Boolean)
  return candidates.join(' ')
}

function buildCloudWatchTimelineItems(entries: CloudWatchInvestigationHistoryEntry[], window: TimelineWindow): TimelineItem[] {
  return entries
    .filter((entry) => isWithinWindow(entry.occurredAt, window))
    .map((entry) => ({
      id: `cloudwatch:${entry.id}`,
      source: 'cloudwatch',
      tone: entry.severity === 'error' ? 'danger' : entry.severity === 'warning' ? 'warning' : entry.severity === 'success' ? 'success' : 'info',
      occurredAt: entry.occurredAt,
      title: `${entry.kind.replace(/-/g, ' ')} • CloudWatch`,
      summary: entry.title,
      detail: `${entry.detail}${entry.logGroupNames.length > 0 ? ` • Log groups: ${entry.logGroupNames.join(', ')}` : ''}`,
      logGroupNames: entry.logGroupNames,
      serviceHint: entry.serviceHint
    }))
}

function buildDriftTimelineItems(report: TerraformDriftReport | null, window: TimelineWindow): TimelineItem[] {
  if (!report?.history.snapshots.length) return []
  const latest = report.history.snapshots[0]
  if (!isWithinWindow(latest.scannedAt, window)) return []

  const actionableCount = latest.summary.statusCounts.drifted
    + latest.summary.statusCounts.missing_in_aws
    + latest.summary.statusCounts.unmanaged_in_aws

  return [{
    id: `drift:${latest.id}`,
    source: 'drift',
    tone: actionableCount > 0 ? 'warning' : 'success',
    occurredAt: latest.scannedAt,
    title: 'Drift snapshot updated',
    summary: actionableCount > 0
      ? `${actionableCount} actionable drift signals are visible in the latest snapshot.`
      : 'Latest drift snapshot is currently clean.',
    detail: `${latest.summary.statusCounts.drifted} drifted • ${latest.summary.statusCounts.missing_in_aws} missing • ${latest.summary.statusCounts.unmanaged_in_aws} unmanaged • ${latest.summary.statusCounts.in_sync} in sync`
  }]
}

function sourceLabel(source: TimelineSource): string {
  if (source === 'cloudtrail') return 'CloudTrail'
  if (source === 'cloudwatch') return 'CloudWatch'
  if (source === 'drift') return 'Drift'
  return 'Terraform'
}

function headlineForWindow(mode: TimelineWindowMode): string {
  if (mode === '1h') return 'What changed in the last 1 hour?'
  if (mode === 'custom') return 'What changed in this time window?'
  return 'What changed in the last 30 minutes?'
}

export function IncidentTimelineTab({
  project,
  connection,
  driftReport,
  onOpenHistory,
  onOpenDrift,
  onNavigateService,
  onNavigateCloudWatch,
  onNavigateCloudTrail
}: {
  project: TerraformProject
  connection: AwsConnection
  driftReport: TerraformDriftReport | null
  onOpenHistory: () => void
  onOpenDrift: () => void
  onNavigateService?: (serviceId: ServiceId, resourceId?: string) => void
  onNavigateCloudWatch?: (focus: { logGroupNames?: string[]; queryString?: string; sourceLabel?: string; serviceHint?: ServiceId | '' }) => void
  onNavigateCloudTrail?: (focus: { resourceName?: string; startTime?: string; endTime?: string; filter?: string }) => void
}) {
  const [windowMode, setWindowMode] = useState<TimelineWindowMode>('30m')
  const [customStart, setCustomStart] = useState(() => toLocalInputValue(new Date(Date.now() - (30 * 60_000))))
  const [customEnd, setCustomEnd] = useState(() => toLocalInputValue(new Date()))
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState<TimelineSourceFilter>('all')
  const [toneFilter, setToneFilter] = useState<TimelineToneFilter>('all')
  const [query, setQuery] = useState('')

  const activeWindow = useMemo(
    () => resolveWindow(windowMode, customStart, customEnd),
    [customEnd, customStart, windowMode]
  )

  const loadTimeline = useCallback(async () => {
    setLoading(true)
    const nextWarnings: string[] = []

    try {
      const [runHistoryResult, cloudWatchResult, cloudTrailResult] = await Promise.allSettled([
        listRunHistory({ projectId: project.id }),
        listCloudWatchInvestigationHistory({
          profile: connection.profile,
          region: connection.region,
          limit: 100
        }),
        lookupCloudTrailEvents(connection, activeWindow.startIso, activeWindow.endIso)
      ])

      const runHistory = runHistoryResult.status === 'fulfilled'
        ? buildTerraformTimelineItems(runHistoryResult.value, activeWindow)
        : []
      if (runHistoryResult.status === 'rejected') {
        nextWarnings.push(`Terraform history: ${runHistoryResult.reason instanceof Error ? runHistoryResult.reason.message : String(runHistoryResult.reason)}`)
      }

      const cloudWatchHistory = cloudWatchResult.status === 'fulfilled'
        ? buildCloudWatchTimelineItems(cloudWatchResult.value, activeWindow)
        : []
      if (cloudWatchResult.status === 'rejected') {
        nextWarnings.push(`CloudWatch investigation history: ${cloudWatchResult.reason instanceof Error ? cloudWatchResult.reason.message : String(cloudWatchResult.reason)}`)
      }

      const cloudTrailHistory = cloudTrailResult.status === 'fulfilled'
        ? buildCloudTrailTimelineItems(cloudTrailResult.value)
        : []
      if (cloudTrailResult.status === 'rejected') {
        nextWarnings.push(`CloudTrail lookup: ${cloudTrailResult.reason instanceof Error ? cloudTrailResult.reason.message : String(cloudTrailResult.reason)}`)
      }

      const nextItems = [
        ...buildDriftTimelineItems(driftReport, activeWindow),
        ...runHistory,
        ...cloudWatchHistory,
        ...cloudTrailHistory
      ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

      setItems(nextItems)
      setSourceWarnings(nextWarnings)
    } finally {
      setLoading(false)
    }
  }, [activeWindow, connection, driftReport, project.id])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  const summary = useMemo(() => ({
    total: items.length,
    terraform: items.filter((item) => item.source === 'terraform').length,
    cloudtrail: items.filter((item) => item.source === 'cloudtrail').length,
    cloudwatch: items.filter((item) => item.source === 'cloudwatch').length,
    drift: items.filter((item) => item.source === 'drift').length
  }), [items])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
      if (toneFilter !== 'all' && item.tone !== toneFilter) return false
      if (!normalizedQuery) return true

      return [
        item.title,
        item.summary,
        item.detail,
        item.resourceName,
        item.serviceHint
      ].join(' ').toLowerCase().includes(normalizedQuery)
    })
  }, [items, query, sourceFilter, toneFilter])

  return (
    <>
      <div className="tf-section">
        <div className="tf-section-head">
          <div>
            <h3>{headlineForWindow(windowMode)}</h3>
            <div className="tf-section-hint">
              Scoped to the active AWS account/region and the selected Terraform workspace. Terraform signals are workspace-specific; CloudTrail and CloudWatch signals are connection-wide within the same window.
            </div>
          </div>
          <button type="button" className="tf-toolbar-btn accent" onClick={() => void loadTimeline()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Timeline'}
          </button>
        </div>

        <div className="tf-incident-toolbar">
          <div className="tf-incident-window-buttons">
            <button type="button" className={windowMode === '30m' ? 'active' : ''} onClick={() => setWindowMode('30m')}>30m</button>
            <button type="button" className={windowMode === '1h' ? 'active' : ''} onClick={() => setWindowMode('1h')}>1h</button>
            <button type="button" className={windowMode === 'custom' ? 'active' : ''} onClick={() => setWindowMode('custom')}>Custom</button>
          </div>
          {windowMode === 'custom' && (
            <div className="tf-incident-custom-range">
              <label className="tf-history-filter-group">
                <span>Start</span>
                <input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </label>
              <label className="tf-history-filter-group">
                <span>End</span>
                <input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </label>
            </div>
          )}
        </div>

        <div className="tf-incident-filters">
          <label className="tf-history-filter-group">
            <span>Source</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as TimelineSourceFilter)}>
              <option value="all">All sources</option>
              <option value="terraform">Terraform</option>
              <option value="cloudtrail">CloudTrail</option>
              <option value="cloudwatch">CloudWatch</option>
              <option value="drift">Drift</option>
            </select>
          </label>
          <label className="tf-history-filter-group">
            <span>Tone</span>
            <select value={toneFilter} onChange={(event) => setToneFilter(event.target.value as TimelineToneFilter)}>
              <option value="all">All tones</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
            </select>
          </label>
          <label className="tf-history-filter-group tf-resource-search">
            <span>Search</span>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Event, actor, resource, detail"
            />
          </label>
        </div>

        <div className="tf-overview-card-grid">
          <div className="tf-overview-card info">
            <span>Window</span>
            <strong>{activeWindow.label}</strong>
            <span>{summary.total} recent signals</span>
          </div>
          <div className="tf-overview-card success">
            <span>Terraform context</span>
            <strong>{project.currentWorkspace}</strong>
            <span>{project.environment.region || connection.region} • {project.environment.connectionLabel || connection.label}</span>
          </div>
          <div className="tf-overview-card warning">
            <span>CloudTrail writes</span>
            <strong>{summary.cloudtrail}</strong>
            <span>Management-plane write activity in the same window</span>
          </div>
          <div className={`tf-overview-card ${summary.drift > 0 ? 'warning' : 'info'}`}>
            <span>Drift snapshots</span>
            <strong>{summary.drift}</strong>
            <span>{driftReport?.history.latestScanAt ? `Latest: ${formatIsoDate(driftReport.history.latestScanAt)}` : 'No cached drift scan yet'}</span>
          </div>
        </div>

        {sourceWarnings.length > 0 && (
          <div className="tf-incident-warning-list">
            {sourceWarnings.map((warning) => (
              <div key={warning} className="tf-inline-warning">{warning}</div>
            ))}
          </div>
        )}
      </div>

      {loading && items.length === 0 && (
        <div className="tf-section">
          <SvcState variant="loading" resourceName="incident timeline" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="tf-section">
          <SvcState variant="empty" message="No recent change signals were found for the selected window." />
        </div>
      )}

      {items.length > 0 && filteredItems.length === 0 && (
        <div className="tf-section">
          <SvcState variant="no-filter-matches" resourceName="timeline signals" />
        </div>
      )}

      {filteredItems.length > 0 && (
        <div className="tf-section">
          <div className="tf-section-hint">
            Showing {filteredItems.length} of {items.length} signals for this window.
          </div>
          <div className="tf-incident-list">
            {filteredItems.map((item) => (
              <article key={item.id} className={`tf-incident-card ${item.tone}`}>
                <div className="tf-incident-card-head">
                  <div>
                    <div className="tf-incident-badges">
                      <span className={`tf-incident-source ${item.source}`}>{sourceLabel(item.source)}</span>
                      <span className="tf-incident-time">{formatIsoDate(item.occurredAt)}</span>
                    </div>
                    <h4>{item.title}</h4>
                  </div>
                </div>
                <p>{item.summary}</p>
                <div className="tf-incident-detail">{item.detail}</div>
                <div className="tf-incident-actions">
                  {item.source === 'terraform' && (
                    <button type="button" className="tf-toolbar-btn" onClick={onOpenHistory}>Open History</button>
                  )}
                  {item.source === 'drift' && (
                    <button type="button" className="tf-toolbar-btn" onClick={onOpenDrift}>Open Drift</button>
                  )}
                  {item.source === 'cloudtrail' && onNavigateCloudTrail && (
                    <button
                      type="button"
                      className="tf-toolbar-btn"
                      onClick={() => onNavigateCloudTrail({
                        resourceName: item.resourceName,
                        startTime: activeWindow.startIso,
                        endTime: activeWindow.endIso,
                        filter: buildCloudTrailFocusFilter(item)
                      })}
                    >
                      Open CloudTrail
                    </button>
                  )}
                  {item.source === 'cloudtrail' && !onNavigateCloudTrail && onNavigateService && (
                    <button type="button" className="tf-toolbar-btn" onClick={() => onNavigateService('cloudtrail', item.resourceName)}>
                      Open CloudTrail
                    </button>
                  )}
                  {item.source === 'cloudwatch' && (
                    <>
                      {onNavigateCloudWatch ? (
                        <button
                          type="button"
                          className="tf-toolbar-btn"
                          onClick={() => onNavigateCloudWatch({
                            logGroupNames: item.logGroupNames,
                            sourceLabel: item.title,
                            serviceHint: item.serviceHint
                          })}
                        >
                          Open CloudWatch
                        </button>
                      ) : onNavigateService && (
                        <button type="button" className="tf-toolbar-btn" onClick={() => onNavigateService('cloudwatch')}>
                          Open CloudWatch
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
