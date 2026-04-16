/**
 * Azure Managed Disks & Snapshots — extracted from azureSdk.ts.
 */

import { fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type { AzureManagedDiskSummary, AzureDiskSnapshotSummary } from '@shared/types'

const enc = encodeURIComponent

export async function listAzureManagedDisks(subscriptionId: string, location: string): Promise<AzureManagedDiskSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Compute/disks`,
    '2024-03-02'
  )
  const all: AzureManagedDiskSummary[] = raw.map((d) => ({
    id: String(d.id ?? ''),
    name: String(d.name ?? ''),
    resourceGroup: extractResourceGroup(String(d.id ?? '')),
    location: String(d.location ?? ''),
    skuName: String((d.sku as Record<string, unknown>)?.name ?? ''),
    diskSizeGb: Number((d.properties as Record<string, unknown>)?.diskSizeGB ?? 0),
    diskState: String((d.properties as Record<string, unknown>)?.diskState ?? ''),
    osType: String((d.properties as Record<string, unknown>)?.osType ?? ''),
    timeCreated: String((d.properties as Record<string, unknown>)?.timeCreated ?? ''),
    managedBy: String(d.managedBy ?? ''),
    zones: Array.isArray(d.zones) ? (d.zones as string[]) : [],
    networkAccessPolicy: String((d.properties as Record<string, unknown>)?.networkAccessPolicy ?? ''),
    provisioningState: String((d.properties as Record<string, unknown>)?.provisioningState ?? ''),
    tagCount: Object.keys((d.tags as Record<string, string>) ?? {}).length
  }))
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return loc ? all.filter((d) => d.location.toLowerCase().replace(/\s/g, '') === loc) : all
}

export async function listAzureDiskSnapshots(subscriptionId: string, location: string): Promise<AzureDiskSnapshotSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Compute/snapshots`,
    '2024-03-02'
  )
  const all: AzureDiskSnapshotSummary[] = raw.map((s) => {
    const props = (s.properties ?? {}) as Record<string, unknown>
    return {
      id: String(s.id ?? ''),
      name: String(s.name ?? ''),
      resourceGroup: extractResourceGroup(String(s.id ?? '')),
      location: String(s.location ?? ''),
      skuName: String((s.sku as Record<string, unknown>)?.name ?? ''),
      diskSizeGb: Number(props.diskSizeGB ?? 0),
      timeCreated: String(props.timeCreated ?? ''),
      sourceResourceId: String((props.creationData as Record<string, unknown>)?.sourceResourceId ?? ''),
      incremental: Boolean(props.incremental),
      provisioningState: String(props.provisioningState ?? ''),
      tagCount: Object.keys((s.tags as Record<string, string>) ?? {}).length
    }
  })
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return loc ? all.filter((s) => s.location.toLowerCase().replace(/\s/g, '') === loc) : all
}
