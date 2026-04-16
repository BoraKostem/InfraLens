/**
 * Azure Log Analytics — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection, getAzureCredential } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureLogAnalyticsWorkspaceSummary,
  AzureLogAnalyticsQueryResult,
  AzureLogAnalyticsSavedSearch,
  AzureLogAnalyticsLinkedService
} from '@shared/types'

const enc = encodeURIComponent

async function getAzureLogAnalyticsToken(): Promise<string> {
  const token = await getAzureCredential().getToken('https://api.loganalytics.io/.default')
  if (!token?.token) {
    throw new Error('Azure credential chain did not return a Log Analytics access token.')
  }
  return token.token
}

export async function listAzureLogAnalyticsWorkspaces(subscriptionId: string, location: string): Promise<AzureLogAnalyticsWorkspaceSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.OperationalInsights/workspaces`,
    '2023-09-01'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return raw
    .filter((w) => !loc || String(w.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((w) => {
      const props = (w.properties ?? {}) as Record<string, unknown>
      const sku = (props.sku ?? {}) as Record<string, unknown>
      const capping = (props.workspaceCapping ?? {}) as Record<string, unknown>
      const features = (props.features ?? {}) as Record<string, unknown>
      return {
        id: String(w.id ?? ''),
        name: String(w.name ?? ''),
        resourceGroup: extractResourceGroup(String(w.id ?? '')),
        location: String(w.location ?? ''),
        skuName: String(sku.name ?? ''),
        retentionInDays: Number(props.retentionInDays ?? 30),
        dailyQuotaGb: Number(capping.dailyQuotaGb ?? -1),
        workspaceId: String(props.workspaceId ?? ''),
        customerId: String(props.customerId ?? ''),
        provisioningState: String(props.provisioningState ?? ''),
        publicNetworkAccessForIngestion: String(props.publicNetworkAccessForIngestion ?? features.enableDataExport ?? ''),
        publicNetworkAccessForQuery: String(props.publicNetworkAccessForQuery ?? ''),
        tagCount: Object.keys((w.tags as Record<string, string>) ?? {}).length
      }
    })
}

export async function queryAzureLogAnalytics(workspaceId: string, query: string, timespan = 'PT12H'): Promise<AzureLogAnalyticsQueryResult> {
  const token = await getAzureLogAnalyticsToken()
  const response = await fetch(`https://api.loganalytics.io/v1/workspaces/${encodeURIComponent(workspaceId)}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, timespan })
  })
  if (!response.ok) {
    const body = await response.text()
    return { tables: [], error: `Query failed (${response.status}): ${body}` }
  }
  const json = await response.json() as Record<string, unknown>
  const tables = Array.isArray(json.tables) ? (json.tables as Record<string, unknown>[]).map((t) => ({
    name: String(t.name ?? ''),
    columns: Array.isArray(t.columns) ? (t.columns as Record<string, unknown>[]).map((c) => ({ name: String(c.name ?? ''), type: String(c.type ?? '') })) : [],
    rows: Array.isArray(t.rows) ? (t.rows as unknown[][]) : []
  })) : []
  return { tables, statistics: json.statistics as AzureLogAnalyticsQueryResult['statistics'] }
}

export async function listAzureLogAnalyticsSavedSearches(subscriptionId: string, resourceGroup: string, workspaceName: string): Promise<AzureLogAnalyticsSavedSearch[]> {
  const raw = await fetchAzureArmJson<{ value?: Record<string, unknown>[] }>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.OperationalInsights/workspaces/${enc(workspaceName)}/savedSearches`,
    '2020-08-01'
  )
  return (raw.value ?? []).map((s) => {
    const props = (s.properties ?? {}) as Record<string, unknown>
    return {
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      category: String(props.category ?? ''),
      displayName: String(props.displayName ?? ''),
      query: String(props.query ?? ''),
      functionAlias: String(props.functionAlias ?? ''),
      functionParameters: String(props.functionParameters ?? '')
    }
  })
}

export async function listAzureLogAnalyticsLinkedServices(subscriptionId: string, resourceGroup: string, workspaceName: string): Promise<AzureLogAnalyticsLinkedService[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.OperationalInsights/workspaces/${enc(workspaceName)}/linkedServices`,
    '2020-08-01'
  )
  return raw.map((ls) => {
    const props = (ls.properties ?? {}) as Record<string, unknown>
    return {
      id: String(ls.id ?? ''),
      name: String(ls.name ?? ''),
      resourceId: String(props.resourceId ?? ''),
      provisioningState: String(props.provisioningState ?? '')
    }
  })
}
