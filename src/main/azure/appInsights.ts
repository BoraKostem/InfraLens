/**
 * Azure Application Insights — extracted from azureSdk.ts.
 */

import { fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type { AzureAppInsightsSummary } from '@shared/types'

export async function listAzureAppInsightsComponents(subscriptionId: string, location: string): Promise<AzureAppInsightsSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Insights/components`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2020-02-02')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map((r): AzureAppInsightsSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      resourceGroup: extractResourceGroup(String(r.id ?? '')),
      location: String(r.location ?? ''),
      instrumentationKey: String(props.InstrumentationKey ?? ''),
      applicationId: String(props.AppId ?? ''),
      applicationType: String(props.Application_Type ?? ''),
      kind: String(r.kind ?? ''),
      ingestionMode: String(props.IngestionMode ?? ''),
      retentionInDays: Number(props.RetentionInDays ?? 90),
      publicNetworkAccessForIngestion: String(props.publicNetworkAccessForIngestion ?? 'Enabled'),
      publicNetworkAccessForQuery: String(props.publicNetworkAccessForQuery ?? 'Enabled'),
      provisioningState: String(props.provisioningState ?? 'Unknown'),
      connectionString: String(props.ConnectionString ?? ''),
      workspaceResourceId: String(props.WorkspaceResourceId ?? ''),
      tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
    }
  })
}
