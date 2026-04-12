/**
 * Azure Monitor / Log Analytics — extends the existing monitoring surface in
 * azureSdk.ts with metric alert rules, scheduled query rules (log alerts),
 * action groups, Azure Monitor metrics queries, diagnostic settings,
 * KQL query templates, enhanced query execution with timeout, CSV export,
 * resource health, and service health events.
 *
 * Uses Azure Monitor REST APIs via fetchAzureArmJson / fetchAzureArmCollection.
 * Depends on: azure/client.ts (fetchAzureArmJson, fetchAzureArmCollection, classifyAzureError, getAzureCredential)
 */

import {
  classifyAzureError,
  fetchAzureArmJson,
  fetchAzureArmCollection,
  getAzureCredential
} from './client'
import {
  getAzureLogAnalyticsHistory,
  addAzureLogAnalyticsHistoryEntry,
  clearAzureLogAnalyticsHistory
} from './monitorStore'
import type {
  AzureMetricAlertRuleSummary,
  AzureScheduledQueryRuleSummary,
  AzureActionGroupSummary,
  AzureMetricQueryResult,
  AzureMetricTimeSeries,
  AzureMetricDataPoint,
  AzureDiagnosticSettingSummary,
  AzureLogAnalyticsQueryTemplate,
  AzureLogAnalyticsQueryWithMeta,
  AzureLogAnalyticsHistoryEntry,
  AzureResourceHealthSummary,
  AzureServiceHealthEvent
} from '@shared/types'

// ── Constants ───────────────────────────────────────────────────────────────────

const MONITOR_API_VERSION = '2024-02-01'
const METRIC_ALERT_API_VERSION = '2018-03-01'
const SCHEDULED_QUERY_API_VERSION = '2024-01-01-preview'
const ACTION_GROUP_API_VERSION = '2023-09-01-preview'
const METRIC_API_VERSION = '2024-02-01'
const DIAGNOSTIC_API_VERSION = '2021-05-01-preview'
const RESOURCE_HEALTH_API_VERSION = '2022-10-01'
const SERVICE_HEALTH_API_VERSION = '2024-02-01'
const LOG_ANALYTICS_SCOPE = 'https://api.loganalytics.io/.default'

// ── Helpers ─────────────────────────────────────────────────────────────────────

function enc(value: string): string {
  return encodeURIComponent(value.trim())
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const parsed = parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 'True'
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function extractResourceGroup(resourceId: string): string {
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i)
  return match?.[1] ?? ''
}

// ── 1. Metric Alert Rules ───────────────────────────────────────────────────────

/**
 * Lists all metric-based alert rules in a subscription.
 * Uses Microsoft.Insights/metricAlerts (2018-03-01).
 *
 * @requires Reader role on the subscription
 */
export async function listAzureMetricAlertRules(
  subscriptionId: string
): Promise<AzureMetricAlertRuleSummary[]> {
  if (!subscriptionId.trim()) throw new Error('subscriptionId is required')

  try {
    const raw = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Insights/metricAlerts`,
      METRIC_ALERT_API_VERSION
    )

    return raw.map((r): AzureMetricAlertRuleSummary => {
      const props = toRecord(r.properties)
      const criteria = toRecord(props.criteria)
      const allCriteria = toArray(criteria.allOf)

      return {
        id: asString(r.id),
        name: asString(r.name),
        resourceGroup: extractResourceGroup(asString(r.id)),
        location: asString(r.location) || 'global',
        description: asString(props.description),
        severity: asNumber(props.severity),
        enabled: asBool(props.enabled),
        evaluationFrequency: asString(props.evaluationFrequency),
        windowSize: asString(props.windowSize),
        targetResourceType: asString(props.targetResourceType),
        targetResourceRegion: asString(props.targetResourceRegion),
        scopes: toArray(props.scopes).map((s) => asString(s)),
        criteriaCount: allCriteria.length,
        actionGroupIds: toArray(props.actions).map((a) => asString(toRecord(a).actionGroupId)),
        lastUpdated: asString(props.lastUpdatedTime) || asString(props.lastModifiedTime)
      }
    })
  } catch (error) {
    throw classifyAzureError('listing metric alert rules', error)
  }
}

// ── 2. Scheduled Query Rules (Log Alerts) ───────────────────────────────────────

/**
 * Lists all scheduled query rules (log-based alerts) in a subscription.
 * Uses Microsoft.Insights/scheduledQueryRules (2024-01-01-preview).
 *
 * @requires Reader role on the subscription
 */
export async function listAzureScheduledQueryRules(
  subscriptionId: string
): Promise<AzureScheduledQueryRuleSummary[]> {
  if (!subscriptionId.trim()) throw new Error('subscriptionId is required')

  try {
    const raw = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Insights/scheduledQueryRules`,
      SCHEDULED_QUERY_API_VERSION
    )

    return raw.map((r): AzureScheduledQueryRuleSummary => {
      const props = toRecord(r.properties)
      const criteria = toRecord(props.criteria)
      const allCriteria = toArray(criteria.allOf)
      const actions = toRecord(props.actions)

      return {
        id: asString(r.id),
        name: asString(r.name),
        resourceGroup: extractResourceGroup(asString(r.id)),
        location: asString(r.location),
        description: asString(props.description),
        severity: asNumber(props.severity),
        enabled: asBool(props.enabled),
        evaluationFrequency: asString(props.evaluationFrequency),
        windowSize: asString(props.windowSize),
        scopes: toArray(props.scopes).map((s) => asString(s)),
        criteriaCount: allCriteria.length,
        actionGroupIds: toArray(actions.actionGroups).map((a) => asString(a)),
        muteActionsDuration: asString(props.muteActionsDuration),
        autoMitigate: asBool(props.autoMitigate),
        targetResourceTypes: toArray(props.targetResourceTypes).map((t) => asString(t)),
        kind: asString(r.kind),
        lastUpdated: asString(props.lastModifiedDateTime) || asString(props.lastUpdatedTime)
      }
    })
  } catch (error) {
    throw classifyAzureError('listing scheduled query rules', error)
  }
}

// ── 3. Action Groups ────────────────────────────────────────────────────────────

/**
 * Lists all action groups in a subscription.
 * Uses Microsoft.Insights/actionGroups (2023-09-01-preview).
 *
 * @requires Reader role on the subscription
 */
export async function listAzureActionGroups(
  subscriptionId: string
): Promise<AzureActionGroupSummary[]> {
  if (!subscriptionId.trim()) throw new Error('subscriptionId is required')

  try {
    const raw = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Insights/actionGroups`,
      ACTION_GROUP_API_VERSION
    )

    return raw.map((r): AzureActionGroupSummary => {
      const props = toRecord(r.properties)

      const emailReceivers = toArray(props.emailReceivers)
      const smsReceivers = toArray(props.smsReceivers)
      const webhookReceivers = toArray(props.webhookReceivers)
      const azureAppPushReceivers = toArray(props.azureAppPushReceivers)
      const automationRunbookReceivers = toArray(props.automationRunbookReceivers)
      const logicAppReceivers = toArray(props.logicAppReceivers)
      const azureFunctionReceivers = toArray(props.azureFunctionReceivers)
      const armRoleReceivers = toArray(props.armRoleReceivers)

      return {
        id: asString(r.id),
        name: asString(r.name),
        resourceGroup: extractResourceGroup(asString(r.id)),
        location: asString(r.location) || 'global',
        groupShortName: asString(props.groupShortName),
        enabled: asBool(props.enabled),
        emailReceiverCount: emailReceivers.length,
        smsReceiverCount: smsReceivers.length,
        webhookReceiverCount: webhookReceivers.length,
        azureAppPushReceiverCount: azureAppPushReceivers.length,
        automationRunbookReceiverCount: automationRunbookReceivers.length,
        logicAppReceiverCount: logicAppReceivers.length,
        azureFunctionReceiverCount: azureFunctionReceivers.length,
        armRoleReceiverCount: armRoleReceivers.length,
        totalReceiverCount:
          emailReceivers.length +
          smsReceivers.length +
          webhookReceivers.length +
          azureAppPushReceivers.length +
          automationRunbookReceivers.length +
          logicAppReceivers.length +
          azureFunctionReceivers.length +
          armRoleReceivers.length
      }
    })
  } catch (error) {
    throw classifyAzureError('listing action groups', error)
  }
}

// ── 4. Azure Monitor Metrics ────────────────────────────────────────────────────

/**
 * Queries Azure Monitor metrics for a specific resource.
 * Uses the Metrics API (2024-02-01) to fetch time-series data.
 *
 * @param resourceId  Full ARM resource ID
 * @param metricNames Comma-separated metric names (e.g. "Percentage CPU,Network In Total")
 * @param timespan    ISO 8601 timespan (e.g. "PT1H", "PT24H", "P7D")
 * @param interval    Aggregation interval (e.g. "PT5M", "PT1H", "P1D")
 * @param aggregation Aggregation type (e.g. "Average", "Total", "Maximum", "Minimum", "Count")
 *
 * @requires Reader role on the target resource
 */
export async function queryAzureMetrics(
  resourceId: string,
  metricNames: string,
  timespan = 'PT24H',
  interval = 'PT1H',
  aggregation = 'Average'
): Promise<AzureMetricQueryResult> {
  if (!resourceId.trim()) throw new Error('resourceId is required')
  if (!metricNames.trim()) throw new Error('metricNames is required')

  try {
    const now = new Date()
    const durationMs = parseIsoDurationMs(timespan)
    const startTime = new Date(now.getTime() - durationMs)

    const timespanParam = `${startTime.toISOString()}/${now.toISOString()}`

    const path =
      `${resourceId.trim()}/providers/Microsoft.Insights/metrics` +
      `?api-version=${METRIC_API_VERSION}` +
      `&metricnames=${encodeURIComponent(metricNames.trim())}` +
      `&timespan=${encodeURIComponent(timespanParam)}` +
      `&interval=${encodeURIComponent(interval.trim())}` +
      `&aggregation=${encodeURIComponent(aggregation.trim())}`

    // fetchAzureArmJson handles absolute URLs when they start with / or https://
    // but this path starts with /subscriptions/... so it's relative to management.azure.com
    const response = await fetchAzureArmJson<Record<string, unknown>>(path, METRIC_API_VERSION)

    const metrics = toArray(response.value)
    const timeSeries: AzureMetricTimeSeries[] = metrics.map((metric) => {
      const m = toRecord(metric)
      const nameObj = toRecord(m.name)
      const unit = asString(m.unit)
      const series = toArray(m.timeseries)

      const dataPoints: AzureMetricDataPoint[] = []
      for (const ts of series) {
        const tsObj = toRecord(ts)
        const data = toArray(tsObj.data)
        for (const point of data) {
          const p = toRecord(point)
          dataPoints.push({
            timestamp: asString(p.timeStamp),
            average: p.average !== undefined ? asNumber(p.average) : undefined,
            total: p.total !== undefined ? asNumber(p.total) : undefined,
            maximum: p.maximum !== undefined ? asNumber(p.maximum) : undefined,
            minimum: p.minimum !== undefined ? asNumber(p.minimum) : undefined,
            count: p.count !== undefined ? asNumber(p.count) : undefined
          })
        }
      }

      return {
        metricName: asString(nameObj.value),
        displayName: asString(nameObj.localizedValue),
        unit,
        dataPoints: dataPoints.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      }
    })

    return {
      resourceId: resourceId.trim(),
      timespan: timespanParam,
      interval: interval.trim(),
      aggregation: aggregation.trim(),
      metrics: timeSeries
    }
  } catch (error) {
    throw classifyAzureError('querying Azure Monitor metrics', error)
  }
}

/**
 * Parses a subset of ISO 8601 durations into milliseconds.
 * Supports: PT{n}M (minutes), PT{n}H (hours), P{n}D (days), P{n}W (weeks).
 */
function parseIsoDurationMs(duration: string): number {
  const match = duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if (!match) return 24 * 60 * 60 * 1000 // default: 24 hours

  const weeks = parseInt(match[1] || '0', 10)
  const days = parseInt(match[2] || '0', 10)
  const hours = parseInt(match[3] || '0', 10)
  const minutes = parseInt(match[4] || '0', 10)
  const seconds = parseInt(match[5] || '0', 10)

  return (
    (weeks * 7 * 24 * 60 * 60 +
      days * 24 * 60 * 60 +
      hours * 60 * 60 +
      minutes * 60 +
      seconds) *
    1000
  )
}

// ── 5. Diagnostic Settings ──────────────────────────────────────────────────────

/**
 * Lists diagnostic settings for a specific Azure resource.
 * Uses Microsoft.Insights/diagnosticSettings (2021-05-01-preview).
 *
 * @param resourceId Full ARM resource ID of the target resource
 *
 * @requires Reader role on the target resource
 */
export async function listAzureDiagnosticSettings(
  resourceId: string
): Promise<AzureDiagnosticSettingSummary[]> {
  if (!resourceId.trim()) throw new Error('resourceId is required')

  try {
    const response = await fetchAzureArmJson<{ value?: Record<string, unknown>[] }>(
      `${resourceId.trim()}/providers/Microsoft.Insights/diagnosticSettings`,
      DIAGNOSTIC_API_VERSION
    )

    return (response.value ?? []).map((ds): AzureDiagnosticSettingSummary => {
      const props = toRecord(ds.properties)
      const logs = toArray(props.logs)
      const metrics = toArray(props.metrics)

      const enabledLogCategories = logs
        .filter((l) => asBool(toRecord(l).enabled))
        .map((l) => asString(toRecord(l).category || toRecord(l).categoryGroup))
        .filter(Boolean)

      const enabledMetricCategories = metrics
        .filter((m) => asBool(toRecord(m).enabled))
        .map((m) => asString(toRecord(m).category))
        .filter(Boolean)

      return {
        id: asString(ds.id),
        name: asString(ds.name),
        storageAccountId: asString(props.storageAccountId),
        workspaceId: asString(props.workspaceId),
        eventHubAuthorizationRuleId: asString(props.eventHubAuthorizationRuleId),
        eventHubName: asString(props.eventHubName),
        logAnalyticsDestinationType: asString(props.logAnalyticsDestinationType),
        enabledLogCategories,
        enabledMetricCategories,
        totalLogCategories: logs.length,
        totalMetricCategories: metrics.length
      }
    })
  } catch (error) {
    throw classifyAzureError('listing diagnostic settings', error)
  }
}

// ── 6. Log Analytics Query Templates ────────────────────────────────────────────

/**
 * Returns a curated set of common KQL query templates for Log Analytics.
 * These are not fetched from Azure — they're built-in templates for quick access.
 */
export function getAzureLogAnalyticsQueryTemplates(): AzureLogAnalyticsQueryTemplate[] {
  return [
    {
      id: 'error-events',
      name: 'Error Events (Last 24h)',
      category: 'Diagnostics',
      description: 'Shows all error-level events from the last 24 hours, grouped by source.',
      query: `Event
| where TimeGenerated > ago(24h)
| where EventLevelName == "Error"
| summarize Count = count() by Source, Computer
| order by Count desc
| take 50`,
      timespan: 'P1D'
    },
    {
      id: 'heartbeat-missing',
      name: 'Missing Heartbeats',
      category: 'Infrastructure',
      description: 'Identifies machines that have not sent a heartbeat in the last 30 minutes.',
      query: `Heartbeat
| summarize LastHeartbeat = max(TimeGenerated) by Computer, OSType
| where LastHeartbeat < ago(30m)
| order by LastHeartbeat asc`,
      timespan: 'PT1H'
    },
    {
      id: 'perf-cpu-top',
      name: 'Top CPU Consumers',
      category: 'Performance',
      description: 'Shows the top 20 machines by average CPU utilization in the last hour.',
      query: `Perf
| where TimeGenerated > ago(1h)
| where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
| summarize AvgCPU = avg(CounterValue) by Computer
| order by AvgCPU desc
| take 20`,
      timespan: 'PT1H'
    },
    {
      id: 'perf-memory-pressure',
      name: 'Memory Pressure',
      category: 'Performance',
      description: 'Machines with less than 10% available memory in the last hour.',
      query: `Perf
| where TimeGenerated > ago(1h)
| where ObjectName == "Memory" and CounterName == "% Available Memory"
| summarize AvgAvailPct = avg(CounterValue) by Computer
| where AvgAvailPct < 10
| order by AvgAvailPct asc`,
      timespan: 'PT1H'
    },
    {
      id: 'perf-disk-io',
      name: 'Disk I/O Bottlenecks',
      category: 'Performance',
      description: 'Identifies disks with high average read/write latency in the last 4 hours.',
      query: `Perf
| where TimeGenerated > ago(4h)
| where ObjectName == "LogicalDisk" and (CounterName == "Avg. Disk sec/Read" or CounterName == "Avg. Disk sec/Write")
| summarize AvgLatency = avg(CounterValue) by Computer, InstanceName, CounterName
| where AvgLatency > 0.02
| order by AvgLatency desc
| take 30`,
      timespan: 'PT4H'
    },
    {
      id: 'security-sign-in-failures',
      name: 'Sign-In Failures',
      category: 'Security',
      description: 'Failed sign-in attempts from Azure AD logs in the last 24 hours.',
      query: `SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != "0"
| summarize FailureCount = count() by UserPrincipalName, IPAddress, ResultDescription
| order by FailureCount desc
| take 50`,
      timespan: 'P1D'
    },
    {
      id: 'security-threat-intel',
      name: 'Threat Intelligence Matches',
      category: 'Security',
      description: 'Network connections matching threat intelligence indicators.',
      query: `ThreatIntelligenceIndicator
| where TimeGenerated > ago(7d)
| where Active == true
| join kind=inner (
    CommonSecurityLog
    | where TimeGenerated > ago(7d)
) on $left.NetworkIP == $right.DestinationIP
| summarize HitCount = count() by NetworkIP, ThreatType, Description
| order by HitCount desc
| take 25`,
      timespan: 'P7D'
    },
    {
      id: 'container-restarts',
      name: 'Container Restarts',
      category: 'Containers',
      description: 'Kubernetes containers that have restarted in the last 6 hours.',
      query: `KubePodInventory
| where TimeGenerated > ago(6h)
| where ContainerRestartCount > 0
| summarize MaxRestarts = max(ContainerRestartCount) by Name, Namespace, ClusterName
| order by MaxRestarts desc
| take 30`,
      timespan: 'PT6H'
    },
    {
      id: 'container-oom-kills',
      name: 'OOM Killed Containers',
      category: 'Containers',
      description: 'Containers terminated due to out-of-memory in the last 24 hours.',
      query: `KubeEvents
| where TimeGenerated > ago(24h)
| where Reason == "OOMKilling"
| summarize Count = count() by Name, Namespace, ClusterName
| order by Count desc`,
      timespan: 'P1D'
    },
    {
      id: 'app-exceptions',
      name: 'Application Exceptions',
      category: 'Application',
      description: 'Top exceptions from Application Insights in the last 24 hours.',
      query: `AppExceptions
| where TimeGenerated > ago(24h)
| summarize Count = count() by ExceptionType = tostring(Properties["ExceptionType"]), ProblemId
| order by Count desc
| take 30`,
      timespan: 'P1D'
    },
    {
      id: 'app-slow-requests',
      name: 'Slow HTTP Requests',
      category: 'Application',
      description: 'HTTP requests taking longer than 5 seconds in the last hour.',
      query: `AppRequests
| where TimeGenerated > ago(1h)
| where DurationMs > 5000
| summarize Count = count(), AvgDuration = avg(DurationMs), P95Duration = percentile(DurationMs, 95) by Name, ResultCode
| order by Count desc
| take 20`,
      timespan: 'PT1H'
    },
    {
      id: 'network-flow-summary',
      name: 'Network Flow Summary',
      category: 'Networking',
      description: 'Summary of network flows from NSG flow logs in the last hour.',
      query: `AzureNetworkAnalytics_CL
| where TimeGenerated > ago(1h)
| summarize FlowCount = count(), TotalBytes = sum(TotalBytes_d) by SrcIP_s, DestIP_s, DestPort_d, FlowDirection_s
| order by FlowCount desc
| take 50`,
      timespan: 'PT1H'
    }
  ]
}

// ── 7. Enhanced Log Analytics Query with Timeout ────────────────────────────────

/**
 * Executes a KQL query against a Log Analytics workspace with timeout support,
 * query metadata, and automatic history tracking.
 *
 * @param workspaceId   Log Analytics workspace GUID
 * @param query         KQL query string
 * @param timespan      ISO 8601 timespan (default: "PT12H")
 * @param timeoutSeconds Maximum query execution time in seconds (default: 120, max: 600)
 *
 * @requires Log Analytics Reader role on the workspace
 */
export async function queryAzureLogAnalyticsWithTimeout(
  workspaceId: string,
  query: string,
  timespan = 'PT12H',
  timeoutSeconds = 120
): Promise<AzureLogAnalyticsQueryWithMeta> {
  if (!workspaceId.trim()) throw new Error('workspaceId is required')
  if (!query.trim()) throw new Error('query is required')

  const clampedTimeout = Math.min(Math.max(timeoutSeconds, 10), 600)
  const startMs = Date.now()

  try {
    const token = await getLogAnalyticsToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), clampedTimeout * 1000)

    try {
      const response = await fetch(
        `https://api.loganalytics.io/v1/workspaces/${encodeURIComponent(workspaceId.trim())}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: `wait=${clampedTimeout}`
          },
          body: JSON.stringify({ query: query.trim(), timespan }),
          signal: controller.signal
        }
      )

      clearTimeout(timer)
      const elapsedMs = Date.now() - startMs

      if (!response.ok) {
        const body = await response.text()
        const errorMessage = `Query failed (${response.status}): ${body}`

        // Track in history as failed
        addAzureLogAnalyticsHistoryEntry(workspaceId.trim(), query.trim(), false, elapsedMs, errorMessage)

        return {
          tables: [],
          statistics: undefined,
          error: errorMessage,
          executionTimeMs: elapsedMs,
          rowCount: 0,
          truncated: false,
          visualizationHint: 'table'
        }
      }

      const json = (await response.json()) as Record<string, unknown>
      const tables = toArray(json.tables).map((t) => {
        const table = toRecord(t)
        return {
          name: asString(table.name),
          columns: toArray(table.columns).map((c) => {
            const col = toRecord(c)
            return { name: asString(col.name), type: asString(col.type) }
          }),
          rows: toArray(table.rows) as unknown[][]
        }
      })

      const stats = toRecord(json.statistics)
      const queryStats = toRecord(stats.query)
      const executionTime = queryStats.executionTime as number | undefined

      const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0)
      const hint = inferVisualizationHint(query.trim(), tables)

      // Track in history as successful
      addAzureLogAnalyticsHistoryEntry(workspaceId.trim(), query.trim(), true, elapsedMs)

      return {
        tables,
        statistics: executionTime !== undefined ? { query: { executionTime } } : undefined,
        error: undefined,
        executionTimeMs: elapsedMs,
        rowCount: totalRows,
        truncated: totalRows >= 10000,
        visualizationHint: hint
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    const elapsedMs = Date.now() - startMs

    if (error instanceof DOMException && error.name === 'AbortError') {
      const msg = `Query timed out after ${clampedTimeout} seconds.`
      addAzureLogAnalyticsHistoryEntry(workspaceId.trim(), query.trim(), false, elapsedMs, msg)
      return {
        tables: [],
        statistics: undefined,
        error: msg,
        executionTimeMs: elapsedMs,
        rowCount: 0,
        truncated: false,
        visualizationHint: 'table'
      }
    }

    throw classifyAzureError('querying Log Analytics', error)
  }
}

/**
 * Gets a Log Analytics data-plane access token.
 */
async function getLogAnalyticsToken(): Promise<string> {
  const result = await getAzureCredential().getToken(LOG_ANALYTICS_SCOPE)
  if (!result?.token) {
    throw new Error('Azure credential chain did not return a Log Analytics access token.')
  }
  return result.token
}

/**
 * Infers a visualization hint based on KQL query patterns and result shape.
 */
function inferVisualizationHint(
  query: string,
  tables: Array<{ columns: Array<{ name: string; type: string }>; rows: unknown[][] }>
): 'table' | 'timechart' | 'barchart' | 'piechart' | 'scalar' {
  const normalized = query.toLowerCase()

  // Explicit render instructions in KQL
  if (normalized.includes('render timechart')) return 'timechart'
  if (normalized.includes('render barchart') || normalized.includes('render columnchart')) return 'barchart'
  if (normalized.includes('render piechart')) return 'piechart'

  // Single-value result → scalar
  if (tables.length === 1 && tables[0].rows.length === 1 && tables[0].columns.length === 1) {
    return 'scalar'
  }

  // Time-based summarization → timechart
  if (
    normalized.includes('summarize') &&
    (normalized.includes('bin(timegenerated') || normalized.includes('bin(timestamp'))
  ) {
    return 'timechart'
  }

  // Count-based grouping → barchart
  if (normalized.includes('summarize') && normalized.includes('count()') && !normalized.includes('bin(')) {
    return 'barchart'
  }

  return 'table'
}

// ── 8. CSV Export ───────────────────────────────────────────────────────────────

/**
 * Converts Log Analytics query result tables to CSV format.
 * Returns a single CSV string containing all tables concatenated (separated by headers).
 */
export function exportAzureLogAnalyticsResultCsv(
  tables: Array<{
    name: string
    columns: Array<{ name: string; type: string }>
    rows: unknown[][]
  }>
): string {
  if (!tables.length) return ''

  const lines: string[] = []

  for (const table of tables) {
    if (tables.length > 1) {
      lines.push(`# Table: ${table.name}`)
    }

    // Header row
    lines.push(table.columns.map((c) => escapeCsvField(c.name)).join(','))

    // Data rows
    for (const row of table.rows) {
      lines.push(
        table.columns.map((_, i) => {
          const value = i < row.length ? row[i] : ''
          return escapeCsvField(value == null ? '' : String(value))
        }).join(',')
      )
    }

    if (tables.length > 1) {
      lines.push('') // blank line between tables
    }
  }

  return lines.join('\n')
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

// ── 9. Query History ────────────────────────────────────────────────────────────

/**
 * Returns query history entries for a specific Log Analytics workspace.
 * Delegates to the persistent store in monitorStore.ts.
 */
export function getAzureLogAnalyticsQueryHistory(
  workspaceId: string
): AzureLogAnalyticsHistoryEntry[] {
  return getAzureLogAnalyticsHistory(workspaceId.trim())
}

/**
 * Clears query history for a specific workspace (or all workspaces if no ID).
 */
export function clearAzureLogAnalyticsQueryHistory(workspaceId?: string): void {
  clearAzureLogAnalyticsHistory(workspaceId?.trim())
}

// ── 10. Resource Health ─────────────────────────────────────────────────────────

/**
 * Lists resource health availability statuses for all resources in a subscription.
 * Uses Microsoft.ResourceHealth/availabilityStatuses (2022-10-01).
 *
 * @requires Reader role on the subscription
 */
export async function listAzureResourceHealth(
  subscriptionId: string
): Promise<AzureResourceHealthSummary[]> {
  if (!subscriptionId.trim()) throw new Error('subscriptionId is required')

  try {
    const raw = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.ResourceHealth/availabilityStatuses`,
      RESOURCE_HEALTH_API_VERSION
    )

    return raw.map((r): AzureResourceHealthSummary => {
      const props = toRecord(r.properties)

      // The resource ID is embedded in the availabilityStatus ID
      // Format: /subscriptions/.../providers/.../resources/.../providers/Microsoft.ResourceHealth/availabilityStatuses/current
      const statusId = asString(r.id)
      const targetResourceId = statusId.replace(
        /\/providers\/Microsoft\.ResourceHealth\/availabilityStatuses\/current$/i,
        ''
      )

      return {
        id: statusId,
        targetResourceId,
        resourceGroup: extractResourceGroup(targetResourceId),
        availabilityState: asString(props.availabilityState),
        title: asString(props.title),
        summary: asString(props.summary),
        reasonType: asString(props.reasonType),
        reasonChronicity: asString(props.reasonChronicity),
        occurredTime: asString(props.occurredTime),
        reportedTime: asString(props.reportedTime),
        resolutionETA: asString(props.resolutionETA),
        category: asString(props.category)
      }
    })
  } catch (error) {
    throw classifyAzureError('listing resource health', error)
  }
}

// ── 11. Service Health Events ───────────────────────────────────────────────────

/**
 * Lists Azure Service Health events (service issues, planned maintenance,
 * health advisories) for a subscription.
 * Uses Microsoft.ResourceHealth/events (2024-02-01).
 *
 * @requires Reader role on the subscription
 */
export async function listAzureServiceHealthEvents(
  subscriptionId: string,
  eventType?: 'ServiceIssue' | 'PlannedMaintenance' | 'HealthAdvisory' | 'SecurityAdvisory'
): Promise<AzureServiceHealthEvent[]> {
  if (!subscriptionId.trim()) throw new Error('subscriptionId is required')

  try {
    let path = `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.ResourceHealth/events`
    if (eventType) {
      path += `?$filter=properties/eventType eq '${eventType}'`
    }

    const raw = await fetchAzureArmCollection<Record<string, unknown>>(
      path,
      SERVICE_HEALTH_API_VERSION
    )

    return raw.map((r): AzureServiceHealthEvent => {
      const props = toRecord(r.properties)
      const impact = toArray(props.impact)

      const impactedServices = impact.map((i) => {
        const imp = toRecord(i)
        return {
          serviceName: asString(imp.impactedService),
          impactedRegions: toArray(imp.impactedRegions).map((reg) =>
            asString(toRecord(reg).impactedRegion)
          )
        }
      })

      return {
        id: asString(r.id),
        name: asString(r.name),
        eventType: asString(props.eventType),
        eventSource: asString(props.eventSource),
        status: asString(props.status),
        title: asString(props.title),
        summary: asString(props.summary),
        header: asString(props.header),
        level: asString(props.level),
        impactStartTime: asString(props.impactStartTime),
        impactMitigationTime: asString(props.impactMitigationTime),
        impactedServices,
        lastUpdateTime: asString(props.lastUpdateTime),
        isHIR: asBool(props.isHIR),
        priority: asNumber(props.priority)
      }
    })
  } catch (error) {
    throw classifyAzureError('listing service health events', error)
  }
}
