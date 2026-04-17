/**
 * GCP Cloud Monitoring Metrics — extends the existing monitoring surface in
 * gcpSdk.ts with alert policy CRUD, notification channels, uptime check
 * management, aggregated metric queries, monitoring dashboards, and Cloud
 * Logging integration.
 *
 * Depends on: gcp/client.ts (requestGcp, paginationGuard, classifyGcpError)
 */

import { classifyGcpError, paginationGuard, requestGcp } from './client'
import { buildGcpSdkError } from './shared'
import type {
  GcpMonitoringAlertPolicySummary,
  GcpMonitoringMetricDescriptorSummary,
  GcpMonitoringNotificationChannelSummary,
  GcpMonitoringGroupSummary,
  GcpMonitoringDashboardSummary,
  GcpMonitoringDashboardDetail,
  GcpMonitoringAggregatedMetric,
  GcpMonitoringAggregatedPoint,
  GcpMonitoringTimeSeriesPoint,
  GcpMonitoringTimeSeriesResult,
  GcpMonitoringUptimeCheckSummary,
  GcpLogEntry,
  GcpLogEntriesResult,
  GcpMonitoringServiceSummary,
  GcpMonitoringSloSummary
} from '@shared/types'

// ── Helpers ─────────────────────────────────────────────────────────────────────

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const parsed = parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const MONITORING_API = 'monitoring.googleapis.com'
const LOGGING_API = 'logging.googleapis.com'

function monitoringUrl(pathname: string, query: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`https://monitoring.googleapis.com/v3/${pathname.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function monitoringV1Url(pathname: string, query: Record<string, string | number | undefined> = {}): string {
  const url = new URL(`https://monitoring.googleapis.com/v1/${pathname.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

// ── Alert Policy Management ─────────────────────────────────────────────────────

/**
 * Enables or disables an existing alert policy.
 * Requires: monitoring.alertPolicies.update
 */
export async function toggleGcpAlertPolicy(
  projectId: string,
  policyName: string,
  enabled: boolean
): Promise<void> {
  const pid = projectId.trim()
  try {
    // Get current policy first
    const policy = await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(policyName)
    })

    // Patch with new enabled state
    await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(policyName),
      method: 'PATCH',
      data: { ...policy, enabled },
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    throw classifyGcpError(`${enabled ? 'enabling' : 'disabling'} alert policy "${policyName}"`, error, MONITORING_API)
  }
}

/**
 * Deletes an alert policy.
 * Requires: monitoring.alertPolicies.delete
 */
export async function deleteGcpAlertPolicy(
  projectId: string,
  policyName: string
): Promise<void> {
  const pid = projectId.trim()
  try {
    await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(policyName),
      method: 'DELETE'
    })
  } catch (error) {
    throw classifyGcpError(`deleting alert policy "${policyName}"`, error, MONITORING_API)
  }
}

/**
 * Creates a simple metric-threshold alert policy. This covers the most common
 * use case: "alert me when metric X crosses threshold Y for duration Z."
 *
 * Requires: monitoring.alertPolicies.create
 */
export async function createGcpAlertPolicy(
  projectId: string,
  displayName: string,
  metricType: string,
  threshold: number,
  comparison: 'COMPARISON_GT' | 'COMPARISON_LT' | 'COMPARISON_GE' | 'COMPARISON_LE',
  durationSeconds: number,
  notificationChannelNames: string[]
): Promise<{ name: string }> {
  const pid = projectId.trim()
  try {
    const result = await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(`projects/${encodeURIComponent(pid)}/alertPolicies`),
      method: 'POST',
      data: {
        displayName,
        combiner: 'OR',
        enabled: true,
        conditions: [{
          displayName: `${displayName} condition`,
          conditionThreshold: {
            filter: `metric.type="${metricType}" AND resource.type="*"`,
            comparison,
            thresholdValue: threshold,
            duration: `${durationSeconds}s`,
            aggregations: [{
              alignmentPeriod: '60s',
              perSeriesAligner: 'ALIGN_MEAN'
            }]
          }
        }],
        notificationChannels: notificationChannelNames.filter(Boolean)
      }
    })

    return { name: asString(result.name) }
  } catch (error) {
    throw classifyGcpError(`creating alert policy "${displayName}" for project "${pid}"`, error, MONITORING_API)
  }
}

// ── Notification Channels ───────────────────────────────────────────────────────

/**
 * Lists all notification channels in a project (email, SMS, PagerDuty, Slack, etc.).
 * Requires: monitoring.notificationChannels.list
 */
export async function listGcpNotificationChannels(
  projectId: string
): Promise<GcpMonitoringNotificationChannelSummary[]> {
  const pid = projectId.trim()
  if (!pid) return []

  try {
    const channels: GcpMonitoringNotificationChannelSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{
        notificationChannels?: Array<Record<string, unknown>>
        nextPageToken?: string
      }>(pid, {
        url: monitoringUrl(`projects/${encodeURIComponent(pid)}/notificationChannels`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.notificationChannels ?? []) {
        const name = asString(entry.name)
        if (!name) continue

        const labels = toRecord(entry.labels)

        channels.push({
          name,
          displayName: asString(entry.displayName),
          type: asString(entry.type),
          enabled: entry.enabled !== false, // default to true if not set
          description: asString(entry.description),
          labels: Object.fromEntries(
            Object.entries(labels).map(([k, v]) => [k, String(v ?? '')])
          ),
          verificationStatus: asString(entry.verificationStatus) || 'VERIFICATION_STATUS_UNSPECIFIED',
          creationTime: asString((toRecord(entry.creationRecord)).mutateTime),
          mutationTime: asString((toRecord(entry.mutationRecord)).mutateTime)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return channels.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw classifyGcpError(`listing notification channels for project "${pid}"`, error, MONITORING_API)
  }
}

// ── Uptime Check Management ─────────────────────────────────────────────────────

/**
 * Creates an HTTP/HTTPS uptime check.
 * Requires: monitoring.uptimeCheckConfigs.create
 */
export async function createGcpUptimeCheck(
  projectId: string,
  displayName: string,
  host: string,
  path: string,
  useSsl: boolean,
  periodSeconds: number
): Promise<{ name: string }> {
  const pid = projectId.trim()
  try {
    const result = await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(`projects/${encodeURIComponent(pid)}/uptimeCheckConfigs`),
      method: 'POST',
      data: {
        displayName,
        monitoredResource: {
          type: 'uptime_url',
          labels: { host, project_id: pid }
        },
        httpCheck: {
          path: path || '/',
          port: useSsl ? 443 : 80,
          useSsl,
          requestMethod: 'GET'
        },
        period: `${periodSeconds}s`,
        timeout: '10s',
        selectedRegions: ['USA', 'EUROPE', 'ASIA_PACIFIC']
      }
    })

    return { name: asString(result.name) }
  } catch (error) {
    throw classifyGcpError(`creating uptime check "${displayName}" for project "${pid}"`, error, MONITORING_API)
  }
}

/**
 * Deletes an uptime check configuration.
 * Requires: monitoring.uptimeCheckConfigs.delete
 */
export async function deleteGcpUptimeCheck(
  projectId: string,
  uptimeCheckName: string
): Promise<void> {
  const pid = projectId.trim()
  try {
    await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringUrl(uptimeCheckName),
      method: 'DELETE'
    })
  } catch (error) {
    throw classifyGcpError(`deleting uptime check "${uptimeCheckName}"`, error, MONITORING_API)
  }
}

// ── Aggregated Metric Queries ───────────────────────────────────────────────────

/**
 * Queries a metric with a specific aggregation (mean, max, min, sum, count, percentile99).
 * Returns per-resource time series with aligned points.
 *
 * This is the GCP equivalent of AWS CloudWatch's getMetricStatistics with
 * different aggregation methods.
 *
 * Requires: monitoring.timeSeries.list
 */
export async function queryGcpAggregatedMetric(
  projectId: string,
  metricType: string,
  intervalMinutes: number,
  alignmentPeriodSeconds: number,
  aggregation: 'ALIGN_MEAN' | 'ALIGN_MAX' | 'ALIGN_MIN' | 'ALIGN_SUM' | 'ALIGN_COUNT' | 'ALIGN_PERCENTILE_99',
  resourceFilter?: string
): Promise<GcpMonitoringAggregatedMetric> {
  const pid = projectId.trim()
  if (!pid || !metricType) {
    return { metricType: '', timeSeries: [], alignmentPeriod: '', aggregation: '' }
  }

  try {
    const now = new Date()
    const startTime = new Date(now.getTime() - intervalMinutes * 60 * 1000)

    let filter = `metric.type="${metricType}"`
    if (resourceFilter) {
      filter += ` AND ${resourceFilter}`
    }

    const url = new URL(monitoringUrl(`projects/${encodeURIComponent(pid)}/timeSeries`))
    url.searchParams.set('filter', filter)
    url.searchParams.set('interval.startTime', startTime.toISOString())
    url.searchParams.set('interval.endTime', now.toISOString())
    url.searchParams.set('aggregation.alignmentPeriod', `${alignmentPeriodSeconds}s`)
    url.searchParams.set('aggregation.perSeriesAligner', aggregation)
    url.searchParams.set('pageSize', '100')

    const response = await requestGcp<Record<string, unknown>>(pid, {
      url: url.toString()
    })

    const timeSeries: GcpMonitoringAggregatedMetric['timeSeries'] = []
    for (const entry of (Array.isArray(response.timeSeries) ? response.timeSeries : []) as Array<Record<string, unknown>>) {
      const metricObj = toRecord(entry.metric)
      const resourceObj = toRecord(entry.resource)
      const metricLabels = toRecord(metricObj.labels)
      const resourceLabels = toRecord(resourceObj.labels)
      const rawPoints = Array.isArray(entry.points) ? entry.points as Array<Record<string, unknown>> : []

      const points: GcpMonitoringAggregatedPoint[] = rawPoints.map((p) => {
        const interval = toRecord(p.interval)
        const value = toRecord(p.value)
        return {
          timestamp: asString(interval.endTime),
          value: normalizeNumber(value.int64Value ?? value.doubleValue ?? value.value ?? 0)
        }
      }).filter((p) => p.timestamp !== '')

      timeSeries.push({
        metricType: asString(metricObj.type),
        resourceType: asString(resourceObj.type),
        resourceLabels: Object.fromEntries(
          Object.entries(resourceLabels).map(([k, v]) => [k, String(v ?? '')])
        ),
        metricLabels: Object.fromEntries(
          Object.entries(metricLabels).map(([k, v]) => [k, String(v ?? '')])
        ),
        points: points.reverse() // Monitoring API returns newest first; we want chronological
      })
    }

    return {
      metricType,
      timeSeries,
      alignmentPeriod: `${alignmentPeriodSeconds}s`,
      aggregation
    }
  } catch (error) {
    throw classifyGcpError(`querying aggregated metric "${metricType}" for project "${pid}"`, error, MONITORING_API)
  }
}

// ── Monitoring Groups ───────────────────────────────────────────────────────────

/**
 * Lists resource groups defined in the project. Groups organize monitored
 * resources by tags, names, regions, etc.
 *
 * Requires: monitoring.groups.list
 */
export async function listGcpMonitoringGroups(
  projectId: string
): Promise<GcpMonitoringGroupSummary[]> {
  const pid = projectId.trim()
  if (!pid) return []

  try {
    const groups: GcpMonitoringGroupSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{
        group?: Array<Record<string, unknown>>
        nextPageToken?: string
      }>(pid, {
        url: monitoringUrl(`projects/${encodeURIComponent(pid)}/groups`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.group ?? []) {
        const name = asString(entry.name)
        if (!name) continue

        groups.push({
          name,
          displayName: asString(entry.displayName),
          filter: asString(entry.filter),
          parentName: asString(entry.parentName),
          isCluster: asBoolean(entry.isCluster)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return groups.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw classifyGcpError(`listing monitoring groups for project "${pid}"`, error, MONITORING_API)
  }
}

// ── Monitoring Dashboards ───────────────────────────────────────────────────────

/**
 * Lists all Cloud Monitoring dashboards in a project.
 * Requires: monitoring.dashboards.list — uses v1 API
 */
export async function listGcpMonitoringDashboards(
  projectId: string
): Promise<GcpMonitoringDashboardSummary[]> {
  const pid = projectId.trim()
  if (!pid) return []

  try {
    const dashboards: GcpMonitoringDashboardSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{
        dashboards?: Array<Record<string, unknown>>
        nextPageToken?: string
      }>(pid, {
        url: monitoringV1Url(`projects/${encodeURIComponent(pid)}/dashboards`, {
          pageSize: 100,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.dashboards ?? []) {
        const name = asString(entry.name)
        if (!name) continue

        // Count widgets
        const mosaicLayout = toRecord(entry.mosaicLayout)
        const gridLayout = toRecord(entry.gridLayout)
        const rowLayout = toRecord(entry.rowLayout)
        const tiles = Array.isArray(mosaicLayout.tiles) ? mosaicLayout.tiles.length : 0
        const columns = Array.isArray(gridLayout.columns) ? gridLayout.columns.length : 0
        const rows = Array.isArray(rowLayout.rows) ? rowLayout.rows.length : 0
        const widgetCount = tiles || columns || rows || 0

        dashboards.push({
          name,
          displayName: asString(entry.displayName) || name.split('/').pop() || name,
          etag: asString(entry.etag),
          widgetCount
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return dashboards.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw classifyGcpError(`listing monitoring dashboards for project "${pid}"`, error, MONITORING_API)
  }
}

/**
 * Gets a specific dashboard detail with widget definitions.
 * Requires: monitoring.dashboards.get — uses v1 API
 */
export async function getGcpMonitoringDashboard(
  projectId: string,
  dashboardName: string
): Promise<GcpMonitoringDashboardDetail> {
  const pid = projectId.trim()
  try {
    const result = await requestGcp<Record<string, unknown>>(pid, {
      url: monitoringV1Url(dashboardName)
    })

    // Extract widgets from the layout
    const widgets: GcpMonitoringDashboardDetail['widgets'] = []
    const mosaicLayout = toRecord(result.mosaicLayout)
    const tiles = Array.isArray(mosaicLayout.tiles) ? mosaicLayout.tiles as Array<Record<string, unknown>> : []

    for (const tile of tiles) {
      const widget = toRecord(tile.widget)
      const title = asString(widget.title)

      // Determine widget type
      let widgetType = 'unknown'
      if (widget.xyChart) widgetType = 'xy-chart'
      else if (widget.scorecard) widgetType = 'scorecard'
      else if (widget.text) widgetType = 'text'
      else if (widget.pieChart) widgetType = 'pie-chart'
      else if (widget.timeSeriesTable) widgetType = 'table'
      else if (widget.alertChart) widgetType = 'alert-chart'
      else if (widget.collapsibleGroup) widgetType = 'collapsible-group'
      else if (widget.logsPanel) widgetType = 'logs-panel'
      else if (widget.incidentList) widgetType = 'incident-list'

      // Extract metric types from chart data sets
      const metricTypes: string[] = []
      const xyChart = toRecord(widget.xyChart)
      const dataSets = Array.isArray(xyChart.dataSets) ? xyChart.dataSets as Array<Record<string, unknown>> : []
      for (const ds of dataSets) {
        const tsQuery = toRecord(ds.timeSeriesQuery)
        const tsFilter = toRecord(tsQuery.timeSeriesFilter)
        const filter = asString(tsFilter.filter)
        const metricMatch = filter.match(/metric\.type\s*=\s*"([^"]+)"/)
        if (metricMatch?.[1]) metricTypes.push(metricMatch[1])
      }

      widgets.push({
        title: title || `Widget ${widgets.length + 1}`,
        widgetType,
        metricTypes
      })
    }

    return {
      name: asString(result.name),
      displayName: asString(result.displayName),
      etag: asString(result.etag),
      widgets
    }
  } catch (error) {
    throw classifyGcpError(`loading dashboard "${dashboardName}"`, error, MONITORING_API)
  }
}

// ── Cloud Logging Integration ───────────────────────────────────────────────────

/**
 * Queries Cloud Logging entries using a log filter expression. This is
 * GCP's equivalent of AWS CloudWatch Logs Insights.
 *
 * Requires: logging.logEntries.list — API: logging.googleapis.com
 */
export async function listGcpLogEntries(
  projectId: string,
  filter: string,
  orderBy: 'timestamp asc' | 'timestamp desc' = 'timestamp desc',
  pageSize = 100,
  pageToken?: string
): Promise<GcpLogEntriesResult> {
  const pid = projectId.trim()
  if (!pid) {
    return { entries: [], nextPageToken: '' }
  }

  try {
    const response = await requestGcp<{
      entries?: Array<Record<string, unknown>>
      nextPageToken?: string
    }>(pid, {
      url: 'https://logging.googleapis.com/v2/entries:list',
      method: 'POST',
      data: {
        resourceNames: [`projects/${pid}`],
        filter: filter || undefined,
        orderBy,
        pageSize: Math.min(pageSize, 500),
        ...(pageToken ? { pageToken } : {})
      }
    })

    const entries: GcpLogEntry[] = (response.entries ?? []).map((entry) => {
      const payload = toRecord(entry.jsonPayload ?? entry.protoPayload)
      const resource = toRecord(entry.resource)
      const resourceLabels = toRecord(resource.labels)
      const httpRequest = toRecord(entry.httpRequest)

      return {
        logName: asString(entry.logName),
        timestamp: asString(entry.timestamp),
        severity: asString(entry.severity) || 'DEFAULT',
        insertId: asString(entry.insertId),
        resourceType: asString(resource.type),
        resourceLabels: Object.fromEntries(
          Object.entries(resourceLabels).map(([k, v]) => [k, String(v ?? '')])
        ),
        textPayload: asString(entry.textPayload),
        jsonPayloadSummary: entry.jsonPayload
          ? JSON.stringify(entry.jsonPayload).slice(0, 500)
          : entry.protoPayload
            ? JSON.stringify(entry.protoPayload).slice(0, 500)
            : '',
        httpMethod: asString(httpRequest.requestMethod),
        httpStatus: normalizeNumber(httpRequest.status),
        httpUrl: asString(httpRequest.requestUrl),
        trace: asString(entry.trace),
        spanId: asString(entry.spanId)
      }
    })

    return {
      entries,
      nextPageToken: asString(response.nextPageToken)
    }
  } catch (error) {
    throw classifyGcpError(`listing log entries for project "${pid}"`, error, LOGGING_API)
  }
}

// ── Monitored Services & SLOs ───────────────────────────────────────────────────

/**
 * Lists Cloud Monitoring managed services (App Engine, Cloud Endpoints, Istio, etc.).
 * Requires: monitoring.services.list
 */
export async function listGcpMonitoringServices(
  projectId: string
): Promise<GcpMonitoringServiceSummary[]> {
  const pid = projectId.trim()
  if (!pid) return []

  try {
    const services: GcpMonitoringServiceSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{
        services?: Array<Record<string, unknown>>
        nextPageToken?: string
      }>(pid, {
        url: monitoringUrl(`projects/${encodeURIComponent(pid)}/services`, {
          pageSize: 200,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.services ?? []) {
        const name = asString(entry.name)
        if (!name) continue

        // Determine service type
        let serviceType = 'custom'
        if (entry.appEngine) serviceType = 'app-engine'
        else if (entry.cloudEndpoints) serviceType = 'cloud-endpoints'
        else if (entry.clusterIstio) serviceType = 'istio'
        else if (entry.meshIstio) serviceType = 'mesh-istio'
        else if (entry.istioCanonicalService) serviceType = 'istio-canonical'
        else if (entry.cloudRun) serviceType = 'cloud-run'
        else if (entry.gkeNamespace) serviceType = 'gke-namespace'
        else if (entry.gkeWorkload) serviceType = 'gke-workload'
        else if (entry.gkeService) serviceType = 'gke-service'

        const telemetry = toRecord(entry.telemetry)

        services.push({
          name,
          displayName: asString(entry.displayName) || name.split('/').pop() || name,
          serviceType,
          telemetryResourceName: asString(telemetry.resourceName)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return services.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw classifyGcpError(`listing monitoring services for project "${pid}"`, error, MONITORING_API)
  }
}

/**
 * Lists SLOs (Service Level Objectives) for a given service.
 * Requires: monitoring.services.list (for service SLOs)
 */
export async function listGcpMonitoringSlos(
  projectId: string,
  serviceName: string
): Promise<GcpMonitoringSloSummary[]> {
  const pid = projectId.trim()
  if (!pid || !serviceName) return []

  try {
    const slos: GcpMonitoringSloSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{
        serviceLevelObjectives?: Array<Record<string, unknown>>
        nextPageToken?: string
      }>(pid, {
        url: monitoringUrl(`${serviceName}/serviceLevelObjectives`, {
          pageSize: 200,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.serviceLevelObjectives ?? []) {
        const name = asString(entry.name)
        if (!name) continue

        const sli = toRecord(entry.serviceLevelIndicator)
        let sliType = 'unknown'
        if (sli.basicSli) sliType = 'basic'
        else if (sli.requestBased) sliType = 'request-based'
        else if (sli.windowsBased) sliType = 'windows-based'

        slos.push({
          name,
          displayName: asString(entry.displayName) || name.split('/').pop() || name,
          goal: normalizeNumber(entry.goal),
          rollingPeriodDays: asString(entry.rollingPeriod)
            ? Math.round(normalizeNumber(asString(entry.rollingPeriod).replace('s', '')) / 86400)
            : 0,
          calendarPeriod: asString(entry.calendarPeriod),
          sliType
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return slos.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw classifyGcpError(`listing SLOs for service "${serviceName}"`, error, MONITORING_API)
  }
}

// ── Extracted from gcpSdk.ts ────────────────────────────────────────────────────
// Core Cloud Monitoring surface (alert policies, uptime checks, metric
// descriptors, time-series queries) moved here as part of the gcpSdk.ts
// decomposition.

function buildMonitoringApiUrl(pathname: string, query: Record<string, number | string | undefined> = {}): string {
  const url = new URL(`https://monitoring.googleapis.com/v3/${pathname.replace(/^\/+/, '')}`)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') {
      continue
    }

    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => asString(entry)).filter((entry) => entry.length > 0)
}

export async function listGcpMonitoringAlertPolicies(projectId: string): Promise<GcpMonitoringAlertPolicySummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const policies: GcpMonitoringAlertPolicySummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildMonitoringApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/alertPolicies`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.alertPolicies) ? response.alertPolicies : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(record.name)
        if (!name) continue

        const conditions = Array.isArray(record.conditions) ? record.conditions : []
        const channels = Array.isArray(record.notificationChannels) ? record.notificationChannels : []

        policies.push({
          name,
          displayName: asString(record.displayName),
          enabled: asBoolean(record.enabled),
          conditionCount: conditions.length,
          notificationChannelCount: channels.length,
          combiner: asString(record.combiner),
          creationTime: asString((record.creationRecord && typeof record.creationRecord === 'object' ? record.creationRecord as Record<string, unknown> : {}).mutateTime),
          mutationTime: asString((record.mutationRecord && typeof record.mutationRecord === 'object' ? record.mutationRecord as Record<string, unknown> : {}).mutateTime)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return policies
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Monitoring alert policies for project "${normalizedProjectId}"`, error, 'monitoring.googleapis.com')
  }
}

export async function listGcpMonitoringUptimeChecks(projectId: string): Promise<GcpMonitoringUptimeCheckSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const checks: GcpMonitoringUptimeCheckSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildMonitoringApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/uptimeCheckConfigs`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.uptimeCheckConfigs) ? response.uptimeCheckConfigs : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(record.name)
        if (!name) continue

        const monitoredResource = record.monitoredResource && typeof record.monitoredResource === 'object'
          ? asString((record.monitoredResource as Record<string, unknown>).type)
          : ''
        const httpCheck = record.httpCheck && typeof record.httpCheck === 'object' ? record.httpCheck as Record<string, unknown> : null
        const tcpCheck = record.tcpCheck && typeof record.tcpCheck === 'object' ? record.tcpCheck : null
        const protocol = httpCheck ? (asBoolean(httpCheck.useSsl) ? 'HTTPS' : 'HTTP') : tcpCheck ? 'TCP' : 'UNKNOWN'

        checks.push({
          name,
          displayName: asString(record.displayName),
          monitoredResource,
          protocol,
          period: asString(record.period),
          timeout: asString(record.timeout),
          selectedRegions: asStringArray(record.selectedRegions),
          isInternal: asBoolean(record.isInternal)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return checks
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Monitoring uptime checks for project "${normalizedProjectId}"`, error, 'monitoring.googleapis.com')
  }
}

export async function listGcpMonitoringMetricDescriptors(projectId: string, filter?: string): Promise<GcpMonitoringMetricDescriptorSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const descriptors: GcpMonitoringMetricDescriptorSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildMonitoringApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/metricDescriptors`, {
          pageSize: 500,
          filter: filter || undefined,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.metricDescriptors) ? response.metricDescriptors : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const type = asString(record.type)
        if (!type) continue

        descriptors.push({
          type,
          displayName: asString(record.displayName),
          description: asString(record.description),
          metricKind: asString(record.metricKind),
          valueType: asString(record.valueType),
          unit: asString(record.unit),
          launchStage: asString(record.launchStage)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return descriptors
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Monitoring metric descriptors for project "${normalizedProjectId}"`, error, 'monitoring.googleapis.com')
  }
}

export async function queryGcpMonitoringTimeSeries(
  projectId: string,
  metricType: string,
  intervalMinutes: number
): Promise<GcpMonitoringTimeSeriesResult[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const now = new Date()
    const startTime = new Date(now.getTime() - intervalMinutes * 60 * 1000)
    const filter = `metric.type="${metricType}"`

    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildMonitoringApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/timeSeries`, {
        filter,
        'interval.startTime': startTime.toISOString(),
        'interval.endTime': now.toISOString(),
        pageSize: 100
      })
    })

    const results: GcpMonitoringTimeSeriesResult[] = []
    for (const entry of Array.isArray(response.timeSeries) ? response.timeSeries : []) {
      const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const metricObj = record.metric && typeof record.metric === 'object' ? record.metric as Record<string, unknown> : {}
      const resourceObj = record.resource && typeof record.resource === 'object' ? record.resource as Record<string, unknown> : {}
      const rawPoints = Array.isArray(record.points) ? record.points : []

      const points = rawPoints.map((point: unknown) => {
        if (!point || typeof point !== 'object') return null
        const p = point as Record<string, unknown>
        const interval = p.interval && typeof p.interval === 'object' ? p.interval as Record<string, unknown> : {}
        const value = p.value && typeof p.value === 'object' ? p.value as Record<string, unknown> : {}
        const numericValue = normalizeNumber(value.int64Value ?? value.doubleValue ?? value.value ?? 0)
        return {
          timestamp: asString(interval.endTime),
          value: numericValue
        }
      }).filter((p): p is GcpMonitoringTimeSeriesPoint => p !== null)

      results.push({
        metric: asString(metricObj.type),
        resource: asString(resourceObj.type),
        points
      })
    }

    return results
  } catch (error) {
    throw buildGcpSdkError(`querying Cloud Monitoring time series for project "${normalizedProjectId}"`, error, 'monitoring.googleapis.com')
  }
}
