/**
 * GKE wrappers — cluster listing, detail, node pools, credentials,
 * operations, scaling. Extracted verbatim from gcpSdk.ts as part of the
 * monolith decomposition.
 */

import { google } from 'googleapis'

import type {
  GcpGkeClusterCredentials,
  GcpGkeClusterDetail,
  GcpGkeClusterSummary,
  GcpGkeNodePoolSummary,
  GcpGkeOperationResult,
  GcpGkeOperationSummary
} from '@shared/types'

import { getGcpAuth, requestGcp } from './client'
import {
  asBoolean,
  asString,
  asStringArray,
  buildContainerApiUrl,
  buildGcpSdkError,
  buildGkeContextName,
  buildGkeKubeconfigYaml,
  filterGkeClustersByLocation,
  formatMaintenanceWindow,
  maskSecret,
  normalizeMaintenanceExclusions,
  normalizeNumber,
  normalizeStringRecord,
  resolveGkeNodePoolTargetSize,
  waitForGkeOperation
} from './shared'

export async function listGcpGkeClusters(projectId: string, location: string): Promise<GcpGkeClusterSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const container = google.container({ version: 'v1' as never, auth: auth as never })
    const response = await container.projects.locations.clusters.list({
      parent: `projects/${normalizedProjectId}/locations/-`
    })
    const items = Array.isArray(response.data.clusters) ? response.data.clusters : []
    const clusters = items
      .map((cluster) => {
        const name = asString(cluster.name)
        if (!name) {
          return null
        }
        return {
          name,
          location: asString(cluster.location),
          status: asString(cluster.status),
          masterVersion: asString(cluster.currentMasterVersion),
          nodeCount: String(cluster.currentNodeCount ?? ''),
          releaseChannel: asString(cluster.releaseChannel?.channel),
          endpoint: asString(cluster.endpoint)
        } satisfies GcpGkeClusterSummary
      })
      .filter((entry): entry is GcpGkeClusterSummary => entry !== null)

    return filterGkeClustersByLocation(clusters, location)
      .sort((left, right) => left.location.localeCompare(right.location) || left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing GKE clusters for project "${normalizedProjectId}"`, error, 'container.googleapis.com')
  }
}

export async function getGcpGkeClusterDetail(projectId: string, location: string, clusterName: string): Promise<GcpGkeClusterDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedLocation = location.trim()
  const normalizedClusterName = clusterName.trim()

  if (!normalizedProjectId || !normalizedLocation || !normalizedClusterName) {
    throw new Error('Project, location, and cluster name are required to load GKE cluster detail.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const container = google.container({ version: 'v1' as never, auth: auth as never })
    const response = await container.projects.locations.clusters.get({
      name: `projects/${normalizedProjectId}/locations/${normalizedLocation}/clusters/${normalizedClusterName}`
    })
    const cluster = response.data

    return {
      name: asString(cluster.name) || normalizedClusterName,
      location: asString(cluster.location) || normalizedLocation,
      status: asString(cluster.status),
      endpoint: asString(cluster.endpoint),
      masterVersion: asString(cluster.currentMasterVersion),
      nodeVersion: asString(cluster.currentNodeVersion),
      releaseChannel: asString(cluster.releaseChannel?.channel),
      autopilotEnabled: asBoolean(cluster.autopilot?.enabled),
      privateClusterEnabled: asBoolean(cluster.privateClusterConfig?.enablePrivateNodes),
      shieldedNodesEnabled: asBoolean(cluster.shieldedNodes?.enabled),
      verticalPodAutoscalingEnabled: asBoolean(cluster.verticalPodAutoscaling?.enabled),
      currentNodeCount: normalizeNumber(cluster.currentNodeCount),
      nodePoolCount: Array.isArray(cluster.nodePools) ? cluster.nodePools.length : 0,
      workloadIdentityPool: asString(cluster.workloadIdentityConfig?.workloadPool),
      network: asString(cluster.network),
      subnetwork: asString(cluster.subnetwork),
      clusterIpv4Cidr: asString(cluster.clusterIpv4Cidr),
      servicesIpv4Cidr: asString(cluster.servicesIpv4Cidr),
      controlPlaneIpv4Cidr: asString(cluster.privateClusterConfig?.masterIpv4CidrBlock),
      loggingService: asString(cluster.loggingService),
      monitoringService: asString(cluster.monitoringService),
      maintenanceWindow: formatMaintenanceWindow(cluster.maintenancePolicy?.window),
      maintenanceExclusions: normalizeMaintenanceExclusions((cluster.maintenancePolicy as { maintenanceExclusions?: unknown } | undefined)?.maintenanceExclusions),
      resourceLabels: normalizeStringRecord(cluster.resourceLabels)
    }
  } catch (error) {
    throw buildGcpSdkError(`loading GKE cluster detail for "${normalizedClusterName}"`, error, 'container.googleapis.com')
  }
}

export async function listGcpGkeNodePools(projectId: string, location: string, clusterName: string): Promise<GcpGkeNodePoolSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedLocation = location.trim()
  const normalizedClusterName = clusterName.trim()

  if (!normalizedProjectId || !normalizedLocation || !normalizedClusterName) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const container = google.container({ version: 'v1' as never, auth: auth as never })
    const response = await container.projects.locations.clusters.nodePools.list({
      parent: `projects/${normalizedProjectId}/locations/${normalizedLocation}/clusters/${normalizedClusterName}`
    })
    const items = Array.isArray(response.data.nodePools) ? response.data.nodePools : []

    const normalizedItems = await Promise.all(items.map(async (pool) => {
        const name = asString(pool.name)
        if (!name) {
          return null
        }

        const autoscalingEnabled = asBoolean(pool.autoscaling?.enabled)
        const minNodeCount = normalizeNumber(pool.autoscaling?.minNodeCount)
        const maxNodeCount = normalizeNumber(pool.autoscaling?.maxNodeCount)
        const fallbackNodeCount = normalizeNumber(pool.initialNodeCount)
        const nodeCount = await resolveGkeNodePoolTargetSize(
          normalizedProjectId,
          asStringArray((pool as { instanceGroupUrls?: unknown }).instanceGroupUrls),
          fallbackNodeCount
        )

        return {
          name,
          status: asString(pool.status),
          version: asString(pool.version),
          nodeCount,
          minNodeCount,
          maxNodeCount,
          machineType: asString(pool.config?.machineType),
          imageType: asString(pool.config?.imageType),
          diskSizeGb: String(pool.config?.diskSizeGb ?? ''),
          autoscaling: autoscalingEnabled ? `${minNodeCount}-${maxNodeCount}` : 'disabled',
          autoUpgradeEnabled: asBoolean(pool.management?.autoUpgrade),
          autoRepairEnabled: asBoolean(pool.management?.autoRepair),
          spotEnabled: asBoolean(pool.config?.spot),
          preemptible: asBoolean(pool.config?.preemptible),
          locations: asStringArray(pool.locations)
        } satisfies GcpGkeNodePoolSummary
      }))

    return normalizedItems
      .filter((entry): entry is GcpGkeNodePoolSummary => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing GKE node pools for "${normalizedClusterName}"`, error, 'container.googleapis.com')
  }
}

export async function getGcpGkeClusterCredentials(
  projectId: string,
  location: string,
  clusterName: string,
  requestedContextName?: string,
  kubeconfigPath = '~/.kube/config'
): Promise<GcpGkeClusterCredentials> {
  const normalizedProjectId = projectId.trim()
  const normalizedLocation = location.trim()
  const normalizedClusterName = clusterName.trim()

  if (!normalizedProjectId || !normalizedLocation || !normalizedClusterName) {
    throw new Error('Project, location, and cluster name are required to load GKE credentials.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()
    const bearerToken = typeof accessToken === 'string'
      ? accessToken
      : asString(accessToken?.token)

    if (!bearerToken) {
      throw new Error('Unable to obtain an access token from the active Google Cloud credentials.')
    }

    const container = google.container({ version: 'v1' as never, auth: auth as never })
    const response = await container.projects.locations.clusters.get({
      name: `projects/${normalizedProjectId}/locations/${normalizedLocation}/clusters/${normalizedClusterName}`
    })
    const cluster = response.data
    const endpoint = asString(cluster.endpoint)
    if (!endpoint) {
      throw new Error(`Cluster "${normalizedClusterName}" did not return an API endpoint.`)
    }

    const certificateAuthorityData = asString(cluster.masterAuth?.clusterCaCertificate)
    const normalizedContextName = requestedContextName?.trim()
    const contextName = normalizedContextName || buildGkeContextName(normalizedProjectId, normalizedLocation, normalizedClusterName)
    const credentialsWithExpiry = client as { credentials?: { expiry_date?: number | null } }
    const expiryDate = credentialsWithExpiry.credentials?.expiry_date
    const tokenExpiresAt = typeof expiryDate === 'number' && Number.isFinite(expiryDate)
      ? new Date(expiryDate).toISOString()
      : ''

    return {
      clusterName: normalizedClusterName,
      location: normalizedLocation,
      endpoint,
      contextName,
      kubeconfigPath: kubeconfigPath.trim() || '~/.kube/config',
      authProvider: 'Application Default Credentials',
      tokenPreview: maskSecret(bearerToken),
      tokenExpiresAt,
      certificateAuthorityData,
      bearerToken,
      kubeconfigYaml: buildGkeKubeconfigYaml(contextName, endpoint, certificateAuthorityData, bearerToken)
    }
  } catch (error) {
    throw buildGcpSdkError(`loading GKE credentials for "${normalizedClusterName}"`, error, 'container.googleapis.com')
  }
}

export async function listGcpGkeOperations(projectId: string, location: string, clusterName: string): Promise<GcpGkeOperationSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedLocation = location.trim()
  const normalizedClusterName = clusterName.trim()

  if (!normalizedProjectId || !normalizedLocation || !normalizedClusterName) {
    return []
  }

  try {
    const response = await requestGcp<{ operations?: unknown[] }>(normalizedProjectId, {
      url: buildContainerApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/locations/${encodeURIComponent(normalizedLocation)}/operations`)
    })

    return (response.operations ?? [])
      .map((entry) => {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const target = asString(record.targetLink)
        const id = asString(record.name)
        if (!id || (!target.includes(`/clusters/${normalizedClusterName}`) && !asString(record.detail).includes(normalizedClusterName))) {
          return null
        }

        return {
          id,
          type: asString(record.operationType) || asString(record.type),
          status: asString(record.status),
          detail: asString(record.detail) || asString(record.statusMessage),
          target,
          location: asString(record.location) || normalizedLocation,
          startedAt: asString(record.startTime),
          endedAt: asString(record.endTime)
        } satisfies GcpGkeOperationSummary
      })
      .filter((entry): entry is GcpGkeOperationSummary => entry !== null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  } catch (error) {
    throw buildGcpSdkError(`listing GKE operations for "${normalizedClusterName}"`, error, 'container.googleapis.com')
  }
}

export async function updateGcpGkeNodePoolScaling(
  projectId: string,
  location: string,
  clusterName: string,
  nodePoolName: string,
  minimum: number,
  desired: number,
  maximum: number
): Promise<GcpGkeOperationResult> {
  const normalizedProjectId = projectId.trim()
  const normalizedLocation = location.trim()
  const normalizedClusterName = clusterName.trim()
  const normalizedNodePoolName = nodePoolName.trim()

  if (!normalizedProjectId || !normalizedLocation || !normalizedClusterName || !normalizedNodePoolName) {
    throw new Error('Project, location, cluster, and node pool are required.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const container = google.container({ version: 'v1' as never, auth: auth as never })
    const nodePools = (((container.projects as any)?.locations as any)?.clusters?.nodePools ?? {}) as Record<string, (...args: unknown[]) => Promise<unknown>>
    const nodePoolPath = `projects/${normalizedProjectId}/locations/${normalizedLocation}/clusters/${normalizedClusterName}/nodePools/${normalizedNodePoolName}`

    const autoscalingResponse = await nodePools.setAutoscaling?.({
      name: nodePoolPath,
      requestBody: {
        autoscaling: {
          enabled: true,
          minNodeCount: minimum,
          maxNodeCount: maximum
        }
      }
    }) as { data?: Record<string, unknown> } | undefined

    const autoscalingOperationName = asString(autoscalingResponse?.data?.name)
    if (autoscalingOperationName) {
      await waitForGkeOperation(normalizedProjectId, normalizedLocation, autoscalingOperationName)
    }

    const sizeResponse = await nodePools.setSize?.({
      name: nodePoolPath,
      requestBody: {
        nodeCount: desired
      }
    }) as { data?: Record<string, unknown> } | undefined

    const operationName = asString(sizeResponse?.data?.name) || autoscalingOperationName
    const result = operationName
      ? await waitForGkeOperation(normalizedProjectId, normalizedLocation, operationName)
      : { completed: true, status: 'DONE' }

    return {
      operationName,
      completed: result.completed,
      status: result.status,
      summary: `Scaled node pool ${normalizedNodePoolName} to min ${minimum}, desired ${desired}, max ${maximum}.`
    }
  } catch (error) {
    throw buildGcpSdkError(`scaling GKE node pool "${normalizedNodePoolName}"`, error, 'container.googleapis.com')
  }
}
