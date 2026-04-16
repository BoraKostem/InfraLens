/**
 * Azure Resource Groups — extracted from azureSdk.ts.
 */

import { fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type { AzureResourceGroupSummary, AzureResourceGroupResourceSummary } from '@shared/types'

export async function listAzureResourceGroups(subscriptionId: string): Promise<AzureResourceGroupSummary[]> {
  const trimmed = subscriptionId.trim()
  if (!trimmed) return []

  const response = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    managedBy?: string
    tags?: Record<string, string>
    properties?: { provisioningState?: string }
  }>(`/subscriptions/${encodeURIComponent(trimmed)}/resourcegroups`, '2021-04-01')

  const groups: AzureResourceGroupSummary[] = []
  for (const entry of response) {
    const id = entry.id?.trim() || ''
    const name = entry.name?.trim() || ''
    if (!id || !name) continue
    groups.push({
      id,
      name,
      location: entry.location?.trim() || '',
      provisioningState: entry.properties?.provisioningState?.trim() || '',
      managedBy: entry.managedBy?.trim() || '',
      tags: entry.tags ?? {}
    })
  }

  return groups.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listAzureResourceGroupResources(
  subscriptionId: string,
  resourceGroupName: string
): Promise<AzureResourceGroupResourceSummary[]> {
  const trimmedSub = subscriptionId.trim()
  const trimmedRg = resourceGroupName.trim()
  if (!trimmedSub || !trimmedRg) return []

  const response = await fetchAzureArmCollection<{
    id?: string
    name?: string
    type?: string
    kind?: string
    location?: string
    tags?: Record<string, string>
    properties?: { provisioningState?: string }
  }>(
    `/subscriptions/${encodeURIComponent(trimmedSub)}/resourceGroups/${encodeURIComponent(trimmedRg)}/resources`,
    '2021-04-01'
  )

  const resources: AzureResourceGroupResourceSummary[] = []
  for (const entry of response) {
    const id = entry.id?.trim() || ''
    const name = entry.name?.trim() || ''
    if (!id || !name) continue
    resources.push({
      id,
      name,
      type: entry.type?.trim() || '',
      location: entry.location?.trim() || '',
      resourceGroup: extractResourceGroup(id) || trimmedRg,
      kind: entry.kind?.trim() || '',
      provisioningState: entry.properties?.provisioningState?.trim() || '',
      tags: entry.tags ?? {}
    })
  }

  return resources.sort((left, right) => left.name.localeCompare(right.name))
}
