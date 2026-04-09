import { DefaultAzureCredential } from '@azure/identity'

import type {
  AzureAksClusterSummary,
  AzureRbacOverview,
  AzureRoleAssignmentSummary,
  AzureSubscriptionSummary,
  AzureVirtualMachineSummary
} from '@shared/types'

import { logWarn } from './observability'

let azureCredential: DefaultAzureCredential | null = null
const AZURE_RISKY_ROLE_MARKERS = [
  'owner',
  'contributor',
  'user access administrator',
  'role based access control administrator'
] as const

function getAzureCredential(): DefaultAzureCredential {
  if (!azureCredential) {
    azureCredential = new DefaultAzureCredential()
  }

  return azureCredential
}

function normalizeLocationList(locations: string[]): string[] {
  return [...new Set(
    locations
      .map((value) => value.trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right))
}

async function getAzureAccessToken(): Promise<string> {
  const token = await getAzureCredential().getToken('https://management.azure.com/.default')
  if (!token?.token) {
    throw new Error('Azure credential chain did not return a management-plane access token.')
  }

  return token.token
}

async function fetchAzureArmJson<T>(path: string, apiVersion: string): Promise<T> {
  const url = /^https?:\/\//i.test(path)
    ? path
    : `https://management.azure.com${path}${path.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(apiVersion)}`
  const response: Response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await getAzureAccessToken()}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Azure ARM request failed (${response.status} ${response.statusText}): ${body || path}`)
  }

  return await response.json() as T
}

async function fetchAzureArmCollection<T>(path: string, apiVersion: string): Promise<T[]> {
  const items: T[] = []
  let nextLink: string | null = path

  while (nextLink) {
    const page: { value?: T[]; nextLink?: string } = await fetchAzureArmJson(nextLink, apiVersion)
    items.push(...(page.value ?? []))
    nextLink = page.nextLink ?? null
  }

  return items
}

function extractResourceGroup(resourceId: string): string {
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i)
  return match?.[1] ?? ''
}

function extractResourceName(resourceId: string): string {
  const segments = resourceId.split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

function extractPowerState(statuses: Array<{ code?: string; displayStatus?: string }>): string {
  const match = statuses.find((status) => status.code?.toLowerCase().startsWith('powerstate/'))
  return match?.displayStatus?.trim() || match?.code?.split('/').pop()?.trim() || 'Unknown'
}

function extractProvisioningState(statuses: Array<{ code?: string; displayStatus?: string }>, fallback: string): string {
  const match = statuses.find((status) => status.code?.toLowerCase().startsWith('provisioningstate/'))
  return match?.displayStatus?.trim() || fallback.trim() || 'Unknown'
}

function inferScopeKind(scope: string, subscriptionScope: string): AzureRoleAssignmentSummary['scopeKind'] {
  const normalizedScope = scope.toLowerCase()
  const normalizedSubscriptionScope = subscriptionScope.toLowerCase()

  if (normalizedScope === normalizedSubscriptionScope) {
    return 'subscription'
  }

  if (normalizedScope.includes('/resourcegroups/')) {
    return 'resourceGroup'
  }

  return 'resource'
}

async function listSubscriptionLocations(subscriptionId: string): Promise<string[]> {
  const locations: string[] = []

  try {
    const response = await fetchAzureArmJson<{ value?: Array<{ name?: string; displayName?: string }> }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/locations`,
      '2022-12-01'
    )
    for (const location of response.value ?? []) {
      const label = location.name?.trim() || location.displayName?.trim() || ''
      if (label) {
        locations.push(label)
      }
    }
  } catch (error) {
    logWarn('azureSdk.listSubscriptionLocations', 'Failed to enumerate Azure subscription locations.', { subscriptionId }, error)
  }

  return normalizeLocationList(locations)
}

export async function listAzureSubscriptions(): Promise<AzureSubscriptionSummary[]> {
  const subscriptions: AzureSubscriptionSummary[] = []
  const response = await fetchAzureArmJson<{
    value?: Array<{
      subscriptionId?: string
      displayName?: string
      tenantId?: string
      state?: string
      authorizationSource?: string
      subscriptionPolicies?: {
        spendingLimit?: string
        quotaId?: string
      }
    }>
  }>('/subscriptions', '2020-01-01')

  for (const entry of response.value ?? []) {
    const subscriptionId = entry.subscriptionId?.trim() ?? ''
    if (!subscriptionId) {
      continue
    }

    const locations = await listSubscriptionLocations(subscriptionId)
    subscriptions.push({
      subscriptionId,
      displayName: entry.displayName?.trim() || subscriptionId,
      tenantId: entry.tenantId?.trim() || '',
      state: entry.state?.trim() || '',
      authorizationSource: entry.authorizationSource?.trim() || '',
      spendingLimit: entry.subscriptionPolicies?.spendingLimit?.trim() || '',
      quotaId: entry.subscriptionPolicies?.quotaId?.trim() || '',
      locationCount: locations.length,
      locations,
      managementGroupHints: []
    })
  }

  return subscriptions.sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export async function getAzureRbacOverview(subscriptionId: string): Promise<AzureRbacOverview> {
  const subscriptionScope = `/subscriptions/${subscriptionId.trim()}`
  const [assignments, roleDefinitions] = await Promise.all([
    fetchAzureArmCollection<{
      id?: string
      properties?: {
        principalId?: string
        principalType?: string
        roleDefinitionId?: string
        scope?: string
        condition?: string
      }
    }>(`${subscriptionScope}/providers/Microsoft.Authorization/roleAssignments`, '2022-04-01'),
    fetchAzureArmCollection<{
      id?: string
      properties?: {
        roleName?: string
      }
    }>(`${subscriptionScope}/providers/Microsoft.Authorization/roleDefinitions`, '2022-04-01')
  ])

  const roleNameById = new Map<string, string>()
  for (const definition of roleDefinitions) {
    const definitionId = definition.id?.trim().toLowerCase()
    const roleName = definition.properties?.roleName?.trim()
    if (definitionId && roleName) {
      roleNameById.set(definitionId, roleName)
    }
  }

  const normalizedSubscriptionScope = subscriptionScope.toLowerCase()
  const mappedAssignments: AzureRoleAssignmentSummary[] = assignments.map((assignment) => {
    const roleDefinitionId = assignment.properties?.roleDefinitionId?.trim().toLowerCase() ?? ''
    const roleName = roleNameById.get(roleDefinitionId) ?? roleDefinitionId.split('/').pop() ?? 'Unknown role'
    const scope = assignment.properties?.scope?.trim() || subscriptionScope
    const risky = AZURE_RISKY_ROLE_MARKERS.some((marker) => roleName.toLowerCase().includes(marker))

    return {
      id: assignment.id?.trim() || `${scope}:${assignment.properties?.principalId?.trim() || 'unknown'}`,
      principalId: assignment.properties?.principalId?.trim() || 'unknown',
      principalType: assignment.properties?.principalType?.trim() || 'Unknown',
      roleName,
      scope,
      scopeKind: inferScopeKind(scope, subscriptionScope),
      inherited: scope.toLowerCase() !== normalizedSubscriptionScope,
      risky,
      condition: assignment.properties?.condition?.trim() || ''
    }
  }).sort((left, right) => {
    if (left.risky !== right.risky) {
      return left.risky ? -1 : 1
    }

    return left.roleName.localeCompare(right.roleName)
  })

  return {
    subscriptionId,
    assignmentCount: mappedAssignments.length,
    principalCount: new Set(mappedAssignments.map((assignment) => assignment.principalId)).size,
    roleCount: new Set(mappedAssignments.map((assignment) => assignment.roleName)).size,
    riskyAssignmentCount: mappedAssignments.filter((assignment) => assignment.risky).length,
    inheritedAssignmentCount: mappedAssignments.filter((assignment) => assignment.inherited).length,
    assignments: mappedAssignments,
    notes: mappedAssignments.length === 0
      ? ['No role assignments were visible for the selected subscription scope.']
      : []
  }
}

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
  const allVms = await fetchAzureArmCollection<{
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
      instanceView?: { statuses?: Array<{ code?: string; displayStatus?: string }> }
    }
    identity?: { type?: string }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.Compute/virtualMachines?$expand=instanceView`, '2023-09-01')

  const normalizedLocation = location.trim().toLowerCase()
  const filtered = normalizedLocation
    ? allVms.filter((vm) => (vm.location?.trim().toLowerCase() ?? '') === normalizedLocation)
    : allVms

  const results = await Promise.all(filtered.map(async (vm) => {
    const nicIds = (vm.properties?.networkProfile?.networkInterfaces ?? [])
      .map((item) => item.id?.trim() || '')
      .filter(Boolean)
    const network = await resolveAzureVmNetworkSummary(nicIds)
    const statuses = vm.properties?.instanceView?.statuses ?? []

    return {
      id: vm.id?.trim() || '',
      name: vm.name?.trim() || extractResourceName(vm.id ?? ''),
      resourceGroup: extractResourceGroup(vm.id ?? ''),
      location: vm.location?.trim() || '',
      vmSize: vm.properties?.hardwareProfile?.vmSize?.trim() || '',
      powerState: extractPowerState(statuses),
      provisioningState: extractProvisioningState(statuses, vm.properties?.provisioningState ?? ''),
      osType: vm.properties?.storageProfile?.osDisk?.osType?.trim() || '',
      identityType: vm.identity?.type?.trim() || 'None',
      privateIp: network.privateIp,
      publicIp: network.publicIp,
      hasPublicIp: network.hasPublicIp,
      subnetName: network.subnetName,
      networkInterfaceCount: nicIds.length,
      diagnosticsState: vm.properties?.diagnosticsProfile?.bootDiagnostics?.enabled ? 'Boot diagnostics enabled' : 'Boot diagnostics off',
      tagCount: Object.keys(vm.tags ?? {}).length
    } satisfies AzureVirtualMachineSummary
  }))

  return results.sort((left, right) => left.name.localeCompare(right.name))
}

async function listAksAgentPools(subscriptionId: string, clusterId: string): Promise<{ count: number; nodeCount: number; names: string[] }> {
  const resourceGroup = extractResourceGroup(clusterId)
  const clusterName = extractResourceName(clusterId)

  if (!resourceGroup || !clusterName) {
    return { count: 0, nodeCount: 0, names: [] }
  }

  try {
    const agentPools = await fetchAzureArmCollection<{
      name?: string
      properties?: {
        count?: number
      }
    }>(
      `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}/agentPools`,
      '2024-02-01'
    )

    return {
      count: agentPools.length,
      nodeCount: agentPools.reduce((total, pool) => total + (pool.properties?.count ?? 0), 0),
      names: agentPools.map((pool) => pool.name?.trim() || '').filter(Boolean)
    }
  } catch (error) {
    logWarn('azureSdk.listAksAgentPools', 'Failed to enumerate AKS agent pools.', { subscriptionId, clusterId }, error)
    return { count: 0, nodeCount: 0, names: [] }
  }
}

export async function listAzureAksClusters(subscriptionId: string, location: string): Promise<AzureAksClusterSummary[]> {
  const allClusters = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    properties?: {
      kubernetesVersion?: string
      provisioningState?: string
      powerState?: { code?: string }
      securityProfile?: { workloadIdentity?: { enabled?: boolean } }
      oidcIssuerProfile?: { enabled?: boolean }
      apiServerAccessProfile?: { enablePrivateCluster?: boolean }
      networkProfile?: { networkPlugin?: string }
      addonProfiles?: {
        ingressApplicationGateway?: { enabled?: boolean }
      }
    }
    identity?: { type?: string }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.ContainerService/managedClusters`, '2024-02-01')

  const normalizedLocation = location.trim().toLowerCase()
  const filtered = normalizedLocation
    ? allClusters.filter((cluster) => (cluster.location?.trim().toLowerCase() ?? '') === normalizedLocation)
    : allClusters

  const results = await Promise.all(filtered.map(async (cluster) => {
    const agentPools = await listAksAgentPools(subscriptionId, cluster.id?.trim() || '')

    return {
      id: cluster.id?.trim() || '',
      name: cluster.name?.trim() || extractResourceName(cluster.id ?? ''),
      resourceGroup: extractResourceGroup(cluster.id ?? ''),
      location: cluster.location?.trim() || '',
      kubernetesVersion: cluster.properties?.kubernetesVersion?.trim() || '',
      provisioningState: cluster.properties?.provisioningState?.trim() || '',
      powerState: cluster.properties?.powerState?.code?.trim() || '',
      nodePoolCount: agentPools.count,
      nodeCount: agentPools.nodeCount,
      privateCluster: cluster.properties?.apiServerAccessProfile?.enablePrivateCluster === true,
      identityType: cluster.identity?.type?.trim() || 'None',
      workloadIdentityEnabled: cluster.properties?.securityProfile?.workloadIdentity?.enabled === true,
      oidcIssuerEnabled: cluster.properties?.oidcIssuerProfile?.enabled === true,
      networkPlugin: cluster.properties?.networkProfile?.networkPlugin?.trim() || '',
      ingressProfile: cluster.properties?.addonProfiles?.ingressApplicationGateway?.enabled ? 'App Gateway enabled' : 'Addon not enabled',
      agentPoolNames: agentPools.names,
      notes: agentPools.count === 0 ? ['Agent pool inventory was not visible for this cluster.'] : []
    } satisfies AzureAksClusterSummary
  }))

  return results.sort((left, right) => left.name.localeCompare(right.name))
}
