/**
 * Azure VMSS — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractPowerState } from './shared'
import type {
  AzureVmssSummary,
  AzureVmssInstanceSummary,
  AzureVmssActionResult
} from '@shared/types'

function mapVmss(raw: Record<string, unknown>): AzureVmssSummary {
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const sku = (raw.sku ?? {}) as Record<string, unknown>
  const upgradePolicy = (props.upgradePolicy ?? {}) as Record<string, unknown>
  const identity = (raw.identity ?? {}) as Record<string, unknown>
  const tags = (raw.tags ?? {}) as Record<string, unknown>
  const zones = (raw.zones ?? []) as string[]

  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    resourceGroup: extractResourceGroup(String(raw.id ?? '')),
    location: String(raw.location ?? ''),
    skuName: String(sku.name ?? ''),
    skuCapacity: Number(sku.capacity ?? 0),
    provisioningState: String(props.provisioningState ?? ''),
    orchestrationMode: String(props.orchestrationMode ?? ''),
    upgradePolicy: String(upgradePolicy.mode ?? ''),
    platformFaultDomainCount: Number(props.platformFaultDomainCount ?? 0),
    overprovision: Boolean(props.overprovision),
    singlePlacementGroup: Boolean(props.singlePlacementGroup),
    identityType: String(identity.type ?? 'None'),
    tagCount: Object.keys(tags).length,
    zones
  }
}

function mapVmssInstance(raw: Record<string, unknown>): AzureVmssInstanceSummary {
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const instanceView = (props.instanceView ?? {}) as Record<string, unknown>
  const statuses = (instanceView.statuses ?? []) as Array<{ code?: string; displayStatus?: string }>
  const protectionPolicy = (props.protectionPolicy ?? {}) as Record<string, unknown>
  const hardwareProfile = (props.hardwareProfile ?? {}) as Record<string, unknown>

  return {
    instanceId: String(raw.instanceId ?? raw.name ?? ''),
    name: String(raw.name ?? ''),
    provisioningState: String(props.provisioningState ?? ''),
    powerState: extractPowerState(statuses),
    latestModelApplied: Boolean(props.latestModelApplied),
    vmSize: String(hardwareProfile.vmSize ?? (raw.sku as Record<string, unknown>)?.name ?? ''),
    protectionFromScaleIn: Boolean(protectionPolicy.protectFromScaleIn),
    zone: String((raw.zones as string[] | undefined)?.[0] ?? '')
  }
}

export async function listAzureVmss(subscriptionId: string, location: string): Promise<AzureVmssSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Compute/virtualMachineScaleSets`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2024-03-01')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map(mapVmss)
}

export async function listAzureVmssInstances(subscriptionId: string, resourceGroup: string, vmssName: string): Promise<AzureVmssInstanceSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachineScaleSets/${encodeURIComponent(vmssName)}/virtualMachines?$expand=instanceView`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2024-03-01')
  return raw.map(mapVmssInstance)
}

export async function updateAzureVmssCapacity(subscriptionId: string, resourceGroup: string, vmssName: string, capacity: number): Promise<AzureVmssActionResult> {
  try {
    const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachineScaleSets/${encodeURIComponent(vmssName)}`
    await fetchAzureArmJson(path, '2024-03-01', {
      method: 'PATCH',
      body: JSON.stringify({ sku: { capacity } })
    })
    return { action: 'updateCapacity', vmssName, resourceGroup, accepted: true }
  } catch (err) {
    return { action: 'updateCapacity', vmssName, resourceGroup, accepted: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAzureVmssInstanceAction(
  subscriptionId: string,
  resourceGroup: string,
  vmssName: string,
  instanceId: string,
  action: 'start' | 'powerOff' | 'restart' | 'deallocate'
): Promise<AzureVmssActionResult> {
  try {
    const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachineScaleSets/${encodeURIComponent(vmssName)}/virtualMachines/${encodeURIComponent(instanceId)}/${action}`
    await fetchAzureArmJson(path, '2024-03-01', { method: 'POST' })
    return { action, vmssName, resourceGroup, accepted: true }
  } catch (err) {
    return { action, vmssName, resourceGroup, accepted: false, error: err instanceof Error ? err.message : String(err) }
  }
}
