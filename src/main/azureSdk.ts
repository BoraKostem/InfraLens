import { dialog, BrowserWindow } from 'electron'
import { basename, extname } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { DefaultAzureCredential } from '@azure/identity'

import type {
  AzureAksClusterSummary,
  AzureRbacOverview,
  AzureRoleAssignmentSummary,
  AzureStorageAccountSummary,
  AzureStorageBlobContent,
  AzureStorageBlobSummary,
  AzureStorageContainerSummary,
  AzureSubscriptionSummary,
  AzureVirtualMachineSummary
} from '@shared/types'

import { logWarn } from './observability'

let azureCredential: DefaultAzureCredential | null = null
const azureBlobServiceClientCache = new Map<string, Promise<BlobServiceClient>>()
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

async function fetchAzureArmJson<T>(path: string, apiVersion: string, init?: RequestInit): Promise<T> {
  const url = /^https?:\/\//i.test(path)
    ? path
    : `https://management.azure.com${path}${path.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(apiVersion)}`
  const response: Response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getAzureAccessToken()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
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

function normalizeRegion<T extends { location: string }>(items: T[], location: string): T[] {
  const normalizedLocation = location.trim().toLowerCase()
  if (!normalizedLocation) {
    return items
  }

  return items.filter((item) => item.location.trim().toLowerCase() === normalizedLocation)
}

function guessContentTypeFromKey(key: string): string {
  switch (extname(key.trim()).toLowerCase()) {
    case '.json':
      return 'application/json'
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.ts':
    case '.tsx':
      return 'application/javascript'
    case '.html':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.md':
      return 'text/markdown'
    case '.xml':
      return 'application/xml'
    case '.yaml':
    case '.yml':
      return 'application/yaml'
    case '.csv':
      return 'text/csv'
    case '.txt':
    case '.log':
    case '.sh':
    case '.ps1':
    case '.tf':
    case '.tfvars':
      return 'text/plain'
    case '.sql':
      return 'application/sql'
    default:
      return 'application/octet-stream'
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream | null | undefined): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0)
  }

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

async function getAzureStorageAccountKey(subscriptionId: string, resourceGroup: string, accountName: string): Promise<string> {
  const response = await fetchAzureArmJson<{
    keys?: Array<{
      permissions?: string
      value?: string
    }>
  }>(
    `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(resourceGroup.trim())}/providers/Microsoft.Storage/storageAccounts/${encodeURIComponent(accountName.trim())}/listKeys`,
    '2024-01-01',
    { method: 'POST' }
  )

  const key = response.keys?.find((entry) => entry.value?.trim())?.value?.trim() || ''
  if (!key) {
    throw new Error(`No Azure storage account key was returned for account "${accountName}".`)
  }

  return key
}

async function getAzureBlobServiceClient(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  blobEndpoint = ''
): Promise<BlobServiceClient> {
  const cacheKey = `${subscriptionId.trim()}:${resourceGroup.trim().toLowerCase()}:${accountName.trim().toLowerCase()}`
  const cached = azureBlobServiceClientCache.get(cacheKey)
  if (cached) {
    return await cached
  }

  const pending = (async () => {
    const key = await getAzureStorageAccountKey(subscriptionId, resourceGroup, accountName)
    const endpoint = blobEndpoint.trim() || `https://${accountName.trim()}.blob.core.windows.net`
    const credential = new StorageSharedKeyCredential(accountName.trim(), key)
    return new BlobServiceClient(endpoint, credential)
  })()

  azureBlobServiceClientCache.set(cacheKey, pending)

  try {
    return await pending
  } catch (error) {
    azureBlobServiceClientCache.delete(cacheKey)
    throw error
  }
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

export async function listAzureStorageAccounts(subscriptionId: string, location: string): Promise<AzureStorageAccountSummary[]> {
  const accounts = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    kind?: string
    sku?: { name?: string }
    tags?: Record<string, string>
    properties?: {
      accessTier?: string
      publicNetworkAccess?: string
      minimumTlsVersion?: string
      allowBlobPublicAccess?: boolean
      allowSharedKeyAccess?: boolean
      supportsHttpsTrafficOnly?: boolean
      networkAcls?: {
        defaultAction?: string
      }
      primaryEndpoints?: {
        blob?: string
      }
    }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.Storage/storageAccounts`, '2024-01-01')

  const filteredAccounts = normalizeRegion(
    accounts.map((account) => ({
      id: account.id?.trim() || '',
      name: account.name?.trim() || extractResourceName(account.id ?? ''),
      resourceGroup: extractResourceGroup(account.id ?? ''),
      location: account.location?.trim() || '',
      kind: account.kind?.trim() || '',
      skuName: account.sku?.name?.trim() || '',
      accessTier: account.properties?.accessTier?.trim() || '',
      publicNetworkAccess: account.properties?.publicNetworkAccess?.trim() || 'Enabled',
      defaultNetworkAction: account.properties?.networkAcls?.defaultAction?.trim() || 'Allow',
      minimumTlsVersion: account.properties?.minimumTlsVersion?.trim() || 'TLS1_0',
      allowBlobPublicAccess: account.properties?.allowBlobPublicAccess === true,
      allowSharedKeyAccess: account.properties?.allowSharedKeyAccess !== false,
      httpsOnly: account.properties?.supportsHttpsTrafficOnly !== false,
      primaryBlobEndpoint: account.properties?.primaryEndpoints?.blob?.trim() || '',
      tagCount: Object.keys(account.tags ?? {}).length
    })),
    location
  )

  const results = await Promise.all(filteredAccounts.map(async (account) => {
    try {
      const serviceProperties = await fetchAzureArmJson<{
        properties?: {
          isVersioningEnabled?: boolean
          changeFeed?: { enabled?: boolean }
          deleteRetentionPolicy?: { enabled?: boolean; days?: number }
          containerDeleteRetentionPolicy?: { enabled?: boolean; days?: number }
        }
      }>(
        `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(account.resourceGroup)}/providers/Microsoft.Storage/storageAccounts/${encodeURIComponent(account.name)}/blobServices/default`,
        '2024-01-01'
      )

      const notes: string[] = []
      if (account.publicNetworkAccess.toLowerCase() === 'enabled' && account.defaultNetworkAction.toLowerCase() === 'allow') {
        notes.push('Public network access is enabled with allow-by-default network rules.')
      }
      if (!account.httpsOnly) {
        notes.push('HTTPS-only traffic enforcement is disabled.')
      }
      if (account.allowBlobPublicAccess) {
        notes.push('Blob public access is allowed on this account.')
      }
      if (!account.allowSharedKeyAccess) {
        notes.push('Shared key access is disabled; data-plane mutations may require alternate auth paths.')
      }

      return {
        ...account,
        versioningEnabled: serviceProperties.properties?.isVersioningEnabled === true,
        changeFeedEnabled: serviceProperties.properties?.changeFeed?.enabled === true,
        blobDeleteRetentionDays: serviceProperties.properties?.deleteRetentionPolicy?.enabled
          ? serviceProperties.properties?.deleteRetentionPolicy?.days ?? 0
          : 0,
        containerDeleteRetentionDays: serviceProperties.properties?.containerDeleteRetentionPolicy?.enabled
          ? serviceProperties.properties?.containerDeleteRetentionPolicy?.days ?? 0
          : 0,
        containerCount: 0,
        notes
      } satisfies AzureStorageAccountSummary
    } catch (error) {
      logWarn('azureSdk.listAzureStorageAccounts', 'Failed to load blob service properties for Azure storage account.', { account: account.name }, error)
      return {
        ...account,
        versioningEnabled: false,
        changeFeedEnabled: false,
        blobDeleteRetentionDays: 0,
        containerDeleteRetentionDays: 0,
        containerCount: 0,
        notes: ['Blob service properties were not fully visible for this account.']
      } satisfies AzureStorageAccountSummary
    }
  }))

  return results.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listAzureStorageContainers(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  blobEndpoint = ''
): Promise<AzureStorageContainerSummary[]> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const iterator = serviceClient.listContainers({ includeMetadata: true })
    const basicContainers = []
    for await (const container of iterator) {
      basicContainers.push(container)
    }

    const results = await Promise.all(basicContainers.map(async (container) => {
      const containerClient = serviceClient.getContainerClient(container.name)
      const properties = await containerClient.getProperties()

      return {
        name: container.name,
        publicAccess: properties.blobPublicAccess?.trim() || 'private',
        metadataCount: Object.keys(container.metadata ?? {}).length,
        leaseStatus: properties.leaseStatus?.trim() || 'unlocked',
        lastModified: properties.lastModified?.toISOString() || '',
        hasImmutabilityPolicy: properties.hasImmutabilityPolicy === true,
        hasLegalHold: properties.hasLegalHold === true,
        defaultEncryptionScope: properties.defaultEncryptionScope?.trim() || '',
        denyEncryptionScopeOverride: properties.denyEncryptionScopeOverride === true
      } satisfies AzureStorageContainerSummary
    }))

    return results.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw new Error(`Failed to list Azure storage containers for "${accountName}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function listAzureStorageBlobs(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  prefix = '',
  blobEndpoint = ''
): Promise<AzureStorageBlobSummary[]> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const containerClient = serviceClient.getContainerClient(containerName.trim())
    const iterator = containerClient.listBlobsByHierarchy('/', { prefix: prefix.trim() || undefined })
    const items: AzureStorageBlobSummary[] = []

    for await (const item of iterator) {
      if (item.kind === 'prefix') {
        items.push({
          key: item.name,
          size: 0,
          lastModified: '',
          contentType: '',
          accessTier: '',
          isFolder: true
        })
        continue
      }

      items.push({
        key: item.name,
        size: item.properties.contentLength ?? 0,
        lastModified: item.properties.lastModified?.toISOString() || '',
        contentType: item.properties.contentType?.trim() || guessContentTypeFromKey(item.name),
        accessTier: item.properties.accessTier?.toString().trim() || '',
        isFolder: false
      })
    }

    return items.sort((left, right) => {
      if (left.isFolder !== right.isFolder) {
        return left.isFolder ? -1 : 1
      }

      return left.key.localeCompare(right.key)
    })
  } catch (error) {
    throw new Error(`Failed to list Azure storage blobs for "${accountName}/${containerName}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function getAzureStorageBlobContent(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<AzureStorageBlobContent> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blobClient = serviceClient.getContainerClient(containerName.trim()).getBlobClient(key.trim())
    const [properties, download] = await Promise.all([
      blobClient.getProperties(),
      blobClient.download()
    ])

    return {
      body: (await streamToBuffer(download.readableStreamBody)).toString('utf8'),
      contentType: properties.contentType?.trim() || guessContentTypeFromKey(key)
    }
  } catch (error) {
    throw new Error(`Failed to read Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function putAzureStorageBlobContent(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  content: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blockBlobClient = serviceClient.getContainerClient(containerName.trim()).getBlockBlobClient(key.trim())
    await blockBlobClient.uploadData(Buffer.from(content, 'utf8'), {
      blobHTTPHeaders: {
        blobContentType: guessContentTypeFromKey(key)
      }
    })
  } catch (error) {
    throw new Error(`Failed to write Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function uploadAzureStorageBlob(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  localPath: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const body = await readFile(localPath.trim())
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blockBlobClient = serviceClient.getContainerClient(containerName.trim()).getBlockBlobClient(key.trim())
    await blockBlobClient.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: guessContentTypeFromKey(key || localPath)
      }
    })
  } catch (error) {
    throw new Error(`Failed to upload Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function downloadAzureStorageBlobToPath(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<string> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: basename(key.trim()) || 'download',
    title: 'Save Azure Blob'
  })

  if (result.canceled || !result.filePath) {
    return ''
  }

  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blobClient = serviceClient.getContainerClient(containerName.trim()).getBlobClient(key.trim())
    const download = await blobClient.download()
    await writeFile(result.filePath, await streamToBuffer(download.readableStreamBody))
    return result.filePath
  } catch (error) {
    throw new Error(`Failed to download Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function deleteAzureStorageBlob(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    await serviceClient.getContainerClient(containerName.trim()).deleteBlob(key.trim())
  } catch (error) {
    throw new Error(`Failed to delete Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}
