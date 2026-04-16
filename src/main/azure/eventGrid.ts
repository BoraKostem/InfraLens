/**
 * Azure Event Grid — extracted from azureSdk.ts.
 */

import { fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractResourceName } from './shared'
import type {
  AzureEventGridTopicSummary,
  AzureEventGridSystemTopicSummary,
  AzureEventGridEventSubscriptionSummary,
  AzureEventGridDomainSummary,
  AzureEventGridDomainTopicSummary
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureEventGridTopics(subscriptionId: string, location: string): Promise<AzureEventGridTopicSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.EventGrid/topics`,
    '2024-06-01-preview'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return raw
    .filter((t) => !loc || String(t.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((t) => {
      const props = (t.properties ?? {}) as Record<string, unknown>
      return {
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        resourceGroup: extractResourceGroup(String(t.id ?? '')),
        location: String(t.location ?? ''),
        provisioningState: String(props.provisioningState ?? ''),
        endpoint: String(props.endpoint ?? ''),
        inputSchema: String(props.inputSchema ?? ''),
        publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
        tagCount: Object.keys((t.tags as Record<string, string>) ?? {}).length
      }
    })
}

export async function listAzureEventGridSystemTopics(subscriptionId: string, location: string): Promise<AzureEventGridSystemTopicSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.EventGrid/systemTopics`,
    '2024-06-01-preview'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return raw
    .filter((t) => !loc || String(t.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((t) => {
      const props = (t.properties ?? {}) as Record<string, unknown>
      return {
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        resourceGroup: extractResourceGroup(String(t.id ?? '')),
        location: String(t.location ?? ''),
        source: String(props.source ?? ''),
        topicType: String(props.topicType ?? ''),
        provisioningState: String(props.provisioningState ?? ''),
        metricResourceId: String(props.metricResourceId ?? '')
      }
    })
}

export async function listAzureEventGridEventSubscriptions(subscriptionId: string): Promise<AzureEventGridEventSubscriptionSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.EventGrid/eventSubscriptions`,
    '2024-06-01-preview'
  )
  return raw.map((s) => {
    const props = (s.properties ?? {}) as Record<string, unknown>
    const dest = (props.destination ?? {}) as Record<string, unknown>
    const destProps = (dest.properties ?? {}) as Record<string, unknown>
    const retry = (props.retryPolicy ?? {}) as Record<string, unknown>
    return {
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      topicName: extractResourceName(String(props.topic ?? '')),
      destinationType: String(dest.endpointType ?? ''),
      destinationEndpoint: String(destProps.endpointUrl ?? destProps.resourceId ?? ''),
      provisioningState: String(props.provisioningState ?? ''),
      eventDeliverySchema: String(props.eventDeliverySchema ?? ''),
      retryMaxDeliveryAttempts: Number(retry.maxDeliveryAttempts ?? 30),
      eventTimeToLiveInMinutes: Number(retry.eventTimeToLiveInMinutes ?? 1440),
      labels: Array.isArray(props.labels) ? (props.labels as string[]) : []
    }
  })
}

export async function listAzureEventGridDomains(subscriptionId: string, location: string): Promise<AzureEventGridDomainSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.EventGrid/domains`,
    '2024-06-01-preview'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return raw
    .filter((d) => !loc || String(d.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((d) => {
      const props = (d.properties ?? {}) as Record<string, unknown>
      return {
        id: String(d.id ?? ''),
        name: String(d.name ?? ''),
        resourceGroup: extractResourceGroup(String(d.id ?? '')),
        location: String(d.location ?? ''),
        provisioningState: String(props.provisioningState ?? ''),
        endpoint: String(props.endpoint ?? ''),
        inputSchema: String(props.inputSchema ?? ''),
        publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
        tagCount: Object.keys((d.tags as Record<string, string>) ?? {}).length
      }
    })
}

export async function listAzureEventGridDomainTopics(subscriptionId: string, resourceGroup: string, domainName: string): Promise<AzureEventGridDomainTopicSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.EventGrid/domains/${enc(domainName)}/topics`,
    '2024-06-01-preview'
  )
  return raw.map((t) => {
    const props = (t.properties ?? {}) as Record<string, unknown>
    return {
      id: String(t.id ?? ''),
      name: String(t.name ?? ''),
      provisioningState: String(props.provisioningState ?? '')
    }
  })
}
