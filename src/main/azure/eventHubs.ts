/**
 * Azure Event Hub — extracted from azureSdk.ts.
 */

import { fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureEventHubNamespaceSummary,
  AzureEventHubSummary,
  AzureEventHubConsumerGroupSummary
} from '@shared/types'

export async function listAzureEventHubNamespaces(subscriptionId: string, location: string): Promise<AzureEventHubNamespaceSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.EventHub/namespaces`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2024-01-01')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map((r): AzureEventHubNamespaceSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const sku = (r.sku ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      resourceGroup: extractResourceGroup(String(r.id ?? '')),
      location: String(r.location ?? ''),
      skuName: String(sku.name ?? ''),
      skuTier: String(sku.tier ?? ''),
      skuCapacity: Number(sku.capacity ?? 0),
      isAutoInflateEnabled: Boolean(props.isAutoInflateEnabled),
      maximumThroughputUnits: Number(props.maximumThroughputUnits ?? 0),
      kafkaEnabled: Boolean(props.kafkaEnabled),
      zoneRedundant: Boolean(props.zoneRedundant),
      publicNetworkAccess: String(props.publicNetworkAccess ?? 'Enabled'),
      provisioningState: String(props.provisioningState ?? 'Unknown'),
      status: String(props.status ?? 'Unknown'),
      serviceBusEndpoint: String(props.serviceBusEndpoint ?? ''),
      tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
    }
  })
}

export async function listAzureEventHubs(subscriptionId: string, resourceGroup: string, namespaceName: string): Promise<AzureEventHubSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.EventHub/namespaces/${encodeURIComponent(namespaceName)}/eventhubs`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2024-01-01')
  return raw.map((r): AzureEventHubSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      partitionCount: Number(props.partitionCount ?? 0),
      messageRetentionInDays: Number(props.messageRetentionInDays ?? 0),
      status: String(props.status ?? 'Unknown'),
      createdAt: String(props.createdAt ?? ''),
      updatedAt: String(props.updatedAt ?? ''),
      partitionIds: Array.isArray(props.partitionIds) ? (props.partitionIds as string[]) : []
    }
  })
}

export async function listAzureEventHubConsumerGroups(subscriptionId: string, resourceGroup: string, namespaceName: string, eventHubName: string): Promise<AzureEventHubConsumerGroupSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.EventHub/namespaces/${encodeURIComponent(namespaceName)}/eventhubs/${encodeURIComponent(eventHubName)}/consumergroups`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2024-01-01')
  return raw.map((r): AzureEventHubConsumerGroupSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      userMetadata: String(props.userMetadata ?? ''),
      createdAt: String(props.createdAt ?? ''),
      updatedAt: String(props.updatedAt ?? '')
    }
  })
}
