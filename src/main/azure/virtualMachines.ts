/**
 * Azure Virtual Machines — extracted from azureSdk.ts.
 */

import {
  getAzureAccessToken,
  fetchAzureArmJson,
  fetchAzureArmCollection,
  mapWithConcurrency
} from './client'
import { extractResourceGroup, extractResourceName, extractPowerState, extractProvisioningState } from './shared'
import { logWarn } from '../observability'
import type {
  AzureVirtualMachineSummary,
  AzureVirtualMachineDetail,
  AzureVmAction,
  AzureVmActionResult
} from '@shared/types'

async function resolveAzureVmNetworkSummary(
  nicIds: string[]
): Promise<{ privateIp: string; publicIp: string; hasPublicIp: boolean; subnetName: string }> {
  if (nicIds.length === 0) {
    return { privateIp: '', publicIp: '', hasPublicIp: false, subnetName: '' }
  }

  try {
    const nic = await fetchAzureArmJson<{
      properties?: {
        ipConfigurations?: Array<{
          properties?: {
            privateIPAddress?: string
            subnet?: { id?: string }
            publicIPAddress?: { id?: string }
          }
        }>
      }
    }>(nicIds[0], '2024-05-01')
    const ipConfiguration = nic.properties?.ipConfigurations?.[0]
    const privateIp = ipConfiguration?.properties?.privateIPAddress?.trim() || ''
    const subnetName = extractResourceName(ipConfiguration?.properties?.subnet?.id ?? '')
    const publicIpResourceId = ipConfiguration?.properties?.publicIPAddress?.id?.trim() || ''

    if (!publicIpResourceId) {
      return { privateIp, publicIp: '', hasPublicIp: false, subnetName }
    }

    const publicIp = await fetchAzureArmJson<{ properties?: { ipAddress?: string } }>(publicIpResourceId, '2024-05-01')
    return {
      privateIp,
      publicIp: publicIp.properties?.ipAddress?.trim() || '',
      hasPublicIp: Boolean(publicIp.properties?.ipAddress?.trim()),
      subnetName
    }
  } catch (error) {
    logWarn('azureSdk.resolveAzureVmNetworkSummary', 'Failed to enrich Azure VM networking posture.', { nicCount: nicIds.length }, error)
    return { privateIp: '', publicIp: '', hasPublicIp: false, subnetName: '' }
  }
}

export async function listAzureVirtualMachines(subscriptionId: string, location: string): Promise<AzureVirtualMachineSummary[]> {
  const subPath = `/subscriptions/${subscriptionId.trim()}`
  const networkApiVersion = '2023-11-01'

  // Fetch VMs, NICs, and public IPs in three parallel bulk calls instead of
  // N+1 per-VM requests.  Power state is resolved via a lightweight batch of
  // instanceView calls with higher concurrency (no NIC/IP overhead per VM).
  const [allVms, allNics, allPublicIps] = await Promise.all([
    fetchAzureArmCollection<{
      id?: string
      name?: string
      location?: string
      tags?: Record<string, string>
      properties?: {
        provisioningState?: string
        storageProfile?: { osDisk?: { osType?: string } }
        hardwareProfile?: { vmSize?: string }
        diagnosticsProfile?: { bootDiagnostics?: { enabled?: boolean } }
        networkProfile?: { networkInterfaces?: Array<{ id?: string }> }
      }
      identity?: { type?: string }
    }>(`${subPath}/providers/Microsoft.Compute/virtualMachines`, '2023-09-01'),
    fetchAzureArmCollection<Record<string, unknown>>(`${subPath}/providers/Microsoft.Network/networkInterfaces`, networkApiVersion),
    fetchAzureArmCollection<Record<string, unknown>>(`${subPath}/providers/Microsoft.Network/publicIPAddresses`, networkApiVersion)
  ])

  // Build a lookup: public IP resource id (lowercase) -> ip address string
  const publicIpById = new Map<string, string>()
  for (const pip of allPublicIps) {
    const id = String(pip.id ?? '').toLowerCase()
    const addr = String(((pip.properties ?? {}) as Record<string, unknown>).ipAddress ?? '')
    if (id && addr) publicIpById.set(id, addr)
  }

  // Build a lookup: VM resource id (lowercase) -> primary NIC network info
  type VmNetInfo = { privateIp: string; publicIp: string; hasPublicIp: boolean; subnetName: string; nicCount: number }
  const vmNetworkByVmId = new Map<string, VmNetInfo>()
  // Group NICs by attached VM
  const nicsByVmId = new Map<string, Array<Record<string, unknown>>>()
  for (const nic of allNics) {
    const props = (nic.properties ?? {}) as Record<string, unknown>
    const vmRef = (props.virtualMachine ?? null) as Record<string, unknown> | null
    if (!vmRef) continue
    const vmId = String(vmRef.id ?? '').toLowerCase()
    if (!vmId) continue
    const list = nicsByVmId.get(vmId) ?? []
    list.push(nic)
    nicsByVmId.set(vmId, list)
  }
  for (const [vmId, nics] of nicsByVmId) {
    const primaryNic = nics.find((n) => {
      const p = (n.properties ?? {}) as Record<string, unknown>
      return p.primary === true
    }) ?? nics[0]
    const nicProps = (primaryNic.properties ?? {}) as Record<string, unknown>
    const ipConfigs = (nicProps.ipConfigurations ?? []) as Array<Record<string, unknown>>
    const primaryIpConfig = ipConfigs[0] ?? {}
    const ipProps = ((primaryIpConfig as Record<string, unknown>).properties ?? {}) as Record<string, unknown>
    const privateIp = String(ipProps.privateIPAddress ?? '')
    const subnetRef = (ipProps.subnet ?? null) as Record<string, unknown> | null
    const subnetName = subnetRef ? extractResourceName(String(subnetRef.id ?? '')) : ''
    const publicIpRef = (ipProps.publicIPAddress ?? null) as Record<string, unknown> | null
    const publicIpId = publicIpRef ? String(publicIpRef.id ?? '').toLowerCase() : ''
    const publicIp = publicIpId ? (publicIpById.get(publicIpId) ?? '') : ''
    vmNetworkByVmId.set(vmId, {
      privateIp,
      publicIp,
      hasPublicIp: Boolean(publicIp),
      subnetName,
      nicCount: nics.length
    })
  }

  const normalizedLocation = location.trim().toLowerCase()
  const filtered = normalizedLocation
    ? allVms.filter((vm) => (vm.location?.trim().toLowerCase() ?? '') === normalizedLocation)
    : allVms

  // Batch-fetch instanceView for power state with high concurrency.
  // NIC and public IP are already resolved from the bulk maps above,
  // so each per-VM call is a single lightweight request.
  const results = await mapWithConcurrency(filtered, 15, async (vm) => {
    const vmIdLower = (vm.id ?? '').toLowerCase()
    const network = vmNetworkByVmId.get(vmIdLower) ?? { privateIp: '', publicIp: '', hasPublicIp: false, subnetName: '', nicCount: 0 }
    const nicIds = (vm.properties?.networkProfile?.networkInterfaces ?? []).map((item) => item.id?.trim() || '').filter(Boolean)

    const instanceView = await fetchAzureArmJson<{
      statuses?: Array<{ code?: string; displayStatus?: string }>
    }>(`${vm.id}/instanceView`, '2023-09-01').catch(() => null)
    const statuses = instanceView?.statuses ?? []

    return {
      id: vm.id?.trim() || '',
      name: vm.name?.trim() || extractResourceName(vm.id ?? ''),
      resourceGroup: extractResourceGroup(vm.id ?? ''),
      location: vm.location?.trim() || '',
      vmSize: vm.properties?.hardwareProfile?.vmSize?.trim() || '',
      powerState: statuses.length > 0
        ? extractPowerState(statuses)
        : (vm.properties?.provisioningState?.trim() || 'Unknown'),
      provisioningState: statuses.length > 0
        ? extractProvisioningState(statuses, vm.properties?.provisioningState ?? '')
        : (vm.properties?.provisioningState?.trim() || 'Unknown'),
      osType: vm.properties?.storageProfile?.osDisk?.osType?.trim() || '',
      identityType: vm.identity?.type?.trim() || 'None',
      privateIp: network.privateIp,
      publicIp: network.publicIp,
      hasPublicIp: network.hasPublicIp,
      subnetName: network.subnetName,
      networkInterfaceCount: nicIds.length || network.nicCount,
      diagnosticsState: vm.properties?.diagnosticsProfile?.bootDiagnostics?.enabled ? 'Boot diagnostics enabled' : 'Boot diagnostics off',
      tagCount: Object.keys(vm.tags ?? {}).length
    } satisfies AzureVirtualMachineSummary
  })

  return results.sort((left, right) => left.name.localeCompare(right.name))
}

export async function describeAzureVirtualMachine(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): Promise<AzureVirtualMachineDetail> {
  const vm = await fetchAzureArmJson<{
    id?: string
    name?: string
    location?: string
    zones?: string[]
    tags?: Record<string, string>
    properties?: {
      provisioningState?: string
      storageProfile?: {
        osDisk?: { osType?: string; name?: string; diskSizeGB?: number; managedDisk?: { storageAccountType?: string } }
        dataDisks?: Array<{ name?: string; diskSizeGB?: number; lun?: number; managedDisk?: { storageAccountType?: string } }>
        imageReference?: { publisher?: string; offer?: string; sku?: string; version?: string }
      }
      hardwareProfile?: { vmSize?: string }
      osProfile?: { computerName?: string; adminUsername?: string }
      diagnosticsProfile?: { bootDiagnostics?: { enabled?: boolean } }
      networkProfile?: { networkInterfaces?: Array<{ id?: string }> }
      instanceView?: { statuses?: Array<{ code?: string; displayStatus?: string }> }
    }
    identity?: { type?: string }
  }>(
    `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Compute/virtualMachines/${encodeURIComponent(vmName)}?$expand=instanceView`,
    '2023-09-01'
  )

  const nicIds = (vm.properties?.networkProfile?.networkInterfaces ?? [])
    .map((item) => item.id?.trim() || '')
    .filter(Boolean)
  const network = await resolveAzureVmNetworkSummary(nicIds)
  const statuses = vm.properties?.instanceView?.statuses ?? []
  const imageRef = vm.properties?.storageProfile?.imageReference
  const imageReference = imageRef
    ? [imageRef.publisher, imageRef.offer, imageRef.sku, imageRef.version].filter(Boolean).join(' / ')
    : ''

  let networkSecurityGroup = ''
  let subnetId = ''
  let vnetName = ''
  if (nicIds[0]) {
    try {
      const nic = await fetchAzureArmJson<{
        properties?: {
          networkSecurityGroup?: { id?: string }
          ipConfigurations?: Array<{ properties?: { subnet?: { id?: string } } }>
        }
      }>(nicIds[0], '2024-05-01')
      networkSecurityGroup = extractResourceName(nic.properties?.networkSecurityGroup?.id ?? '')
      subnetId = nic.properties?.ipConfigurations?.[0]?.properties?.subnet?.id?.trim() || ''
      const vnetMatch = subnetId.match(/\/virtualNetworks\/([^/]+)/i)
      vnetName = vnetMatch?.[1] ?? ''
    } catch {
      // Network enrichment is non-critical
    }
  }

  return {
    id: vm.id?.trim() || '',
    name: vm.name?.trim() || '',
    resourceGroup,
    location: vm.location?.trim() || '',
    vmSize: vm.properties?.hardwareProfile?.vmSize?.trim() || '',
    powerState: extractPowerState(statuses),
    provisioningState: extractProvisioningState(statuses, vm.properties?.provisioningState ?? ''),
    osType: vm.properties?.storageProfile?.osDisk?.osType?.trim() || '',
    osDiskName: vm.properties?.storageProfile?.osDisk?.name?.trim() || '',
    osDiskSizeGiB: vm.properties?.storageProfile?.osDisk?.diskSizeGB ?? 0,
    osDiskType: vm.properties?.storageProfile?.osDisk?.managedDisk?.storageAccountType?.trim() || '',
    dataDisks: (vm.properties?.storageProfile?.dataDisks ?? []).map((disk) => ({
      name: disk.name?.trim() || '',
      sizeGiB: disk.diskSizeGB ?? 0,
      lun: disk.lun ?? 0,
      type: disk.managedDisk?.storageAccountType?.trim() || ''
    })),
    identityType: vm.identity?.type?.trim() || 'None',
    privateIp: network.privateIp,
    publicIp: network.publicIp,
    hasPublicIp: network.hasPublicIp,
    subnetName: network.subnetName,
    subnetId,
    vnetName,
    networkInterfaceCount: nicIds.length,
    networkSecurityGroup,
    diagnosticsState: vm.properties?.diagnosticsProfile?.bootDiagnostics?.enabled ? 'Boot diagnostics enabled' : 'Boot diagnostics off',
    tags: vm.tags ?? {},
    imageReference,
    computerName: vm.properties?.osProfile?.computerName?.trim() || '',
    adminUsername: vm.properties?.osProfile?.adminUsername?.trim() || '',
    availabilityZone: (vm.zones ?? [])[0] || '',
    platform: vm.properties?.storageProfile?.osDisk?.osType?.trim() || ''
  } satisfies AzureVirtualMachineDetail
}

export async function runAzureVmAction(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  action: AzureVmAction
): Promise<AzureVmActionResult> {
  const normalizedSub = subscriptionId.trim()
  const normalizedRg = encodeURIComponent(resourceGroup.trim())
  const normalizedVm = encodeURIComponent(vmName.trim())
  const path = `/subscriptions/${normalizedSub}/resourceGroups/${normalizedRg}/providers/Microsoft.Compute/virtualMachines/${normalizedVm}/${action}`
  const url = `https://management.azure.com${path}?api-version=2023-09-01`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getAzureAccessToken()}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const body = await response.text()
      return { action, vmName, resourceGroup, accepted: false, error: `${response.status}: ${body || response.statusText}` }
    }

    return { action, vmName, resourceGroup, accepted: true }
  } catch (error) {
    return { action, vmName, resourceGroup, accepted: false, error: error instanceof Error ? error.message : String(error) }
  }
}
