/**
 * Azure AKS — extracted from azureSdk.ts.
 */

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractResourceName, getEnvironmentHealthReport } from './shared'
import { logWarn } from '../observability'
import type {
  AzureAksClusterSummary,
  AzureAksClusterDetail,
  AzureAksNodePoolSummary
} from '@shared/types'

const execFileAsync = promisify(execFile)

async function loadAzureCliPath(): Promise<string> {
  try {
    const report = await getEnvironmentHealthReport()
    return report.tools.find((t) => t.id === 'azure-cli' && t.found)?.path.trim() ?? ''
  } catch {
    return ''
  }
}

function isWindowsBatchFile(command: string): boolean {
  if (process.platform !== 'win32') return false
  const ext = extname(command.trim()).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

function resolveKubeconfigPath(kubeconfigPath: string): string {
  const trimmed = kubeconfigPath.trim()
  if (!trimmed) return join(homedir(), '.kube', 'config')
  if (trimmed === '.kube/config' || trimmed === '.kube\\config') return join(homedir(), '.kube', 'config')
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return resolve(homedir(), trimmed.slice(2))
  if (isAbsolute(trimmed)) return trimmed
  return resolve(homedir(), trimmed)
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

export async function describeAzureAksCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<AzureAksClusterDetail> {
  const raw = await fetchAzureArmJson<{
    name?: string
    location?: string
    tags?: Record<string, string>
    identity?: { type?: string }
    properties?: {
      kubernetesVersion?: string
      provisioningState?: string
      powerState?: { code?: string }
      fqdn?: string
      privateFqdn?: string
      dnsPrefix?: string
      nodeResourceGroup?: string
      enableRBAC?: boolean
      createdAt?: string
      securityProfile?: { workloadIdentity?: { enabled?: boolean } }
      oidcIssuerProfile?: { enabled?: boolean; issuerURL?: string }
      apiServerAccessProfile?: { enablePrivateCluster?: boolean }
      networkProfile?: {
        networkPlugin?: string
        networkPolicy?: string
        serviceCidr?: string
        dnsServiceIP?: string
        podCidr?: string
        loadBalancerSku?: string
        outboundType?: string
      }
      addonProfiles?: {
        omsagent?: { enabled?: boolean }
        azurepolicy?: { enabled?: boolean }
        httpApplicationRouting?: { enabled?: boolean }
      }
      agentPoolProfiles?: Array<{
        count?: number
      }>
    }
  }>(
    `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}`,
    '2024-02-01'
  )

  const props = raw.properties
  const netProfile = props?.networkProfile

  const loggingEnabled: string[] = []
  if (props?.addonProfiles?.omsagent?.enabled) loggingEnabled.push('omsagent')
  if (props?.addonProfiles?.azurepolicy?.enabled) loggingEnabled.push('azurepolicy')
  if (props?.addonProfiles?.httpApplicationRouting?.enabled) loggingEnabled.push('httpApplicationRouting')

  const agentPools = props?.agentPoolProfiles ?? []
  const nodeCount = agentPools.reduce((total, pool) => total + (pool.count ?? 0), 0)

  return {
    name: raw.name?.trim() || clusterName,
    resourceGroup,
    location: raw.location?.trim() || '',
    kubernetesVersion: props?.kubernetesVersion?.trim() || '-',
    provisioningState: props?.provisioningState?.trim() || '-',
    powerState: props?.powerState?.code?.trim() || '-',
    fqdn: props?.fqdn?.trim() || '-',
    privateFqdn: props?.privateFqdn?.trim() || '-',
    privateCluster: props?.apiServerAccessProfile?.enablePrivateCluster === true,
    identityType: raw.identity?.type?.trim() || 'None',
    workloadIdentityEnabled: props?.securityProfile?.workloadIdentity?.enabled === true,
    oidcIssuerEnabled: props?.oidcIssuerProfile?.enabled === true,
    oidcIssuerUrl: props?.oidcIssuerProfile?.issuerURL?.trim() || '-',
    networkPlugin: netProfile?.networkPlugin?.trim() || '-',
    networkPolicy: netProfile?.networkPolicy?.trim() || '-',
    serviceCidr: netProfile?.serviceCidr?.trim() || '-',
    dnsServiceIp: netProfile?.dnsServiceIP?.trim() || '-',
    podCidr: netProfile?.podCidr?.trim() || '-',
    loadBalancerSku: netProfile?.loadBalancerSku?.trim() || '-',
    outboundType: netProfile?.outboundType?.trim() || '-',
    nodeResourceGroup: props?.nodeResourceGroup?.trim() || '-',
    dnsPrefix: props?.dnsPrefix?.trim() || '-',
    enableRbac: props?.enableRBAC === true,
    createdAt: props?.createdAt?.trim() || '-',
    nodePoolCount: agentPools.length,
    nodeCount,
    tags: raw.tags ?? {},
    loggingEnabled,
    healthIssues: []
  }
}

export async function listAzureAksNodePools(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<AzureAksNodePoolSummary[]> {
  const pools = await fetchAzureArmCollection<{
    name?: string
    properties?: {
      provisioningState?: string
      mode?: string
      vmSize?: string
      osType?: string
      osSKU?: string
      orchestratorVersion?: string
      count?: number
      minCount?: number
      maxCount?: number
      enableAutoScaling?: boolean
      availabilityZones?: string[]
      maxPods?: number
      osDiskSizeGB?: number
      osDiskType?: string
      powerState?: { code?: string }
      nodeLabels?: Record<string, string>
      nodeTaints?: string[]
    }
  }>(
    `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}/agentPools`,
    '2024-02-01'
  )

  return pools.map((pool) => {
    const props = pool.properties
    const autoScaling = props?.enableAutoScaling === true
    return {
      name: pool.name?.trim() || '-',
      status: props?.provisioningState?.trim() || '-',
      mode: props?.mode?.trim() || 'User',
      vmSize: props?.vmSize?.trim() || '-',
      osType: props?.osType?.trim() || '-',
      osSku: props?.osSKU?.trim() || '-',
      kubernetesVersion: props?.orchestratorVersion?.trim() || '-',
      min: autoScaling ? (props?.minCount ?? '-') : '-',
      desired: props?.count ?? '-',
      max: autoScaling ? (props?.maxCount ?? '-') : '-',
      enableAutoScaling: autoScaling,
      availabilityZones: props?.availabilityZones ?? [],
      maxPods: props?.maxPods ?? 0,
      osDiskSizeGb: props?.osDiskSizeGB ?? 0,
      osDiskType: props?.osDiskType?.trim() || '-',
      powerState: props?.powerState?.code?.trim() || '-',
      nodeLabels: props?.nodeLabels ?? {},
      nodeTaints: props?.nodeTaints ?? []
    } satisfies AzureAksNodePoolSummary
  }).sort((left, right) => left.name.localeCompare(right.name))
}

export async function updateAzureAksNodePoolScaling(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  nodePoolName: string,
  min: number,
  desired: number,
  max: number
): Promise<void> {
  const poolPath = `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}/agentPools/${encodeURIComponent(nodePoolName)}`

  const pool = await fetchAzureArmJson<Record<string, unknown> & {
    properties?: Record<string, unknown> & { enableAutoScaling?: boolean }
  }>(poolPath, '2024-02-01')

  const autoScaling = pool.properties?.enableAutoScaling === true

  const updatedProperties = autoScaling
    ? { ...pool.properties, count: desired, minCount: min, maxCount: max, enableAutoScaling: true }
    : { ...pool.properties, count: desired }

  await fetchAzureArmJson(
    poolPath,
    '2024-02-01',
    { method: 'PUT', body: JSON.stringify({ ...pool, properties: updatedProperties }) }
  )
}

export async function toggleAzureAksNodePoolAutoscaling(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  nodePoolName: string,
  enable: boolean,
  minCount?: number,
  maxCount?: number
): Promise<void> {
  const poolPath = `/subscriptions/${subscriptionId.trim()}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(clusterName)}/agentPools/${encodeURIComponent(nodePoolName)}`

  const pool = await fetchAzureArmJson<Record<string, unknown> & {
    properties?: Record<string, unknown> & { enableAutoScaling?: boolean; count?: number }
  }>(poolPath, '2024-02-01')

  let updatedProperties: Record<string, unknown>
  if (enable) {
    if (minCount == null || maxCount == null) throw new Error('minCount and maxCount are required when enabling autoscaling')
    updatedProperties = { ...pool.properties, enableAutoScaling: true, minCount, maxCount }
  } else {
    updatedProperties = { ...pool.properties, enableAutoScaling: false }
    delete updatedProperties.minCount
    delete updatedProperties.maxCount
  }

  await fetchAzureArmJson(
    poolPath,
    '2024-02-01',
    { method: 'PUT', body: JSON.stringify({ ...pool, properties: updatedProperties }) }
  )
}

export async function addAksToKubeconfig(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  contextName: string,
  kubeconfigPath: string
): Promise<string> {
  const normalizedContextName = contextName.trim()
  const targetKubeconfigPath = resolveKubeconfigPath(kubeconfigPath)
  await mkdir(dirname(targetKubeconfigPath), { recursive: true })

  const cliPath = await loadAzureCliPath()
  const resolved = cliPath || (process.platform === 'win32' ? 'az.cmd' : 'az')
  const fullArgs = [
    'aks', 'get-credentials',
    '-g', resourceGroup,
    '-n', clusterName,
    '--subscription', subscriptionId,
    '--context', normalizedContextName,
    '--file', targetKubeconfigPath,
    '--overwrite-existing'
  ]

  const [command, execArgs] = isWindowsBatchFile(resolved)
    ? ['cmd.exe', ['/d', '/c', resolved, ...fullArgs]]
    : [resolved, fullArgs]

  const { stdout, stderr } = await execFileAsync(command, execArgs, {
    windowsHide: true,
    timeout: 20000,
    env: process.env
  })
  return (stdout || stderr).trim()
}
