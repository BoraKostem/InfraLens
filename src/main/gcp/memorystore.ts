/**
 * Memorystore (Redis) wrappers — instance listing and detail. Extracted
 * verbatim from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpMemorystoreInstanceDetail,
  GcpMemorystoreInstanceSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asBoolean,
  asString,
  buildGcpSdkError,
  normalizeNumber,
  toRecord
} from './shared'

function buildMemorystoreApiUrl(pathname: string, query: Record<string, number | string | undefined> = {}): string {
  const url = new URL(`https://redis.googleapis.com/v1/${pathname.replace(/^\/+/, '')}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function normalizeMemorystoreInstance(entry: unknown): GcpMemorystoreInstanceSummary | null {
  const record = toRecord(entry)
  if (!record) return null

  const fullName = asString(record.name)
  const parts = fullName.split('/')
  const instanceId = parts[parts.length - 1] || ''

  return {
    name: fullName,
    instanceId,
    displayName: asString(record.displayName) || instanceId,
    state: asString(record.state),
    tier: asString(record.tier),
    memorySizeGb: normalizeNumber(record.memorySizeGb),
    host: asString(record.host),
    port: normalizeNumber(record.port),
    redisVersion: asString(record.redisVersion),
    createTime: asString(record.createTime),
    currentLocationId: asString(record.currentLocationId),
    connectMode: asString(record.connectMode),
    authEnabled: asBoolean(record.authEnabled),
    transitEncryptionMode: asString(record.transitEncryptionMode),
    replicaCount: normalizeNumber(record.replicaCount),
    readEndpoint: asString(record.readEndpoint),
    readEndpointPort: normalizeNumber(record.readEndpointPort),
    locationId: asString(record.locationId),
    alternativeLocationId: asString(record.alternativeLocationId),
    labels: record.labels && typeof record.labels === 'object' && !Array.isArray(record.labels)
      ? (record.labels as Record<string, string>)
      : {}
  }
}

export async function listGcpMemorystoreInstances(projectId: string, location: string): Promise<GcpMemorystoreInstanceSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  const loc = location.trim() || '-'

  try {
    const instances: GcpMemorystoreInstanceSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ instances?: unknown[]; nextPageToken?: string }>(normalizedProjectId, {
        url: buildMemorystoreApiUrl(
          `projects/${encodeURIComponent(normalizedProjectId)}/locations/${encodeURIComponent(loc)}/instances`,
          { pageSize: 500, pageToken: pageToken || undefined }
        )
      })

      for (const entry of response.instances ?? []) {
        const instance = normalizeMemorystoreInstance(entry)
        if (instance) instances.push(instance)
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return instances.sort((a, b) => a.displayName.localeCompare(b.displayName))
  } catch (error) {
    throw buildGcpSdkError(`listing Memorystore instances for project "${normalizedProjectId}"`, error, 'redis.googleapis.com')
  }
}

export async function getGcpMemorystoreInstanceDetail(projectId: string, instanceName: string): Promise<GcpMemorystoreInstanceDetail> {
  const normalizedProjectId = projectId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildMemorystoreApiUrl(instanceName)
    })

    const record = response
    const fullName = asString(record.name)
    const parts = fullName.split('/')
    const instanceId = parts[parts.length - 1] || ''

    const persistenceRaw = toRecord(record.persistenceConfig)
    const maintenancePolicyRaw = toRecord(record.maintenancePolicy)
    const maintenanceScheduleRaw = toRecord(record.maintenanceSchedule)

    return {
      name: fullName,
      instanceId,
      displayName: asString(record.displayName) || instanceId,
      state: asString(record.state),
      tier: asString(record.tier),
      memorySizeGb: normalizeNumber(record.memorySizeGb),
      host: asString(record.host),
      port: normalizeNumber(record.port),
      redisVersion: asString(record.redisVersion),
      createTime: asString(record.createTime),
      currentLocationId: asString(record.currentLocationId),
      connectMode: asString(record.connectMode),
      authEnabled: asBoolean(record.authEnabled),
      transitEncryptionMode: asString(record.transitEncryptionMode),
      replicaCount: normalizeNumber(record.replicaCount),
      readEndpoint: asString(record.readEndpoint),
      readEndpointPort: normalizeNumber(record.readEndpointPort),
      locationId: asString(record.locationId),
      alternativeLocationId: asString(record.alternativeLocationId),
      labels: record.labels && typeof record.labels === 'object' && !Array.isArray(record.labels)
        ? (record.labels as Record<string, string>)
        : {},
      redisConfigs: record.redisConfigs && typeof record.redisConfigs === 'object' && !Array.isArray(record.redisConfigs)
        ? (record.redisConfigs as Record<string, string>)
        : {},
      persistenceConfig: {
        persistenceMode: persistenceRaw ? asString(persistenceRaw.persistenceMode) : '',
        rdbSnapshotPeriod: persistenceRaw ? asString(persistenceRaw.rdbSnapshotPeriod) : '',
        rdbSnapshotStartTime: persistenceRaw ? asString(persistenceRaw.rdbSnapshotStartTime) : ''
      },
      maintenancePolicy: maintenancePolicyRaw
        ? {
            weeklyMaintenanceWindow: Array.isArray(maintenancePolicyRaw.weeklyMaintenanceWindow)
              ? (maintenancePolicyRaw.weeklyMaintenanceWindow as Array<Record<string, unknown>>).map((w) => ({
                  day: asString(w.day),
                  startTime: asString((toRecord(w.startTime) ?? {}).hours) + ':' + asString((toRecord(w.startTime) ?? {}).minutes || '00'),
                  duration: asString(w.duration)
                }))
              : []
          }
        : null,
      maintenanceSchedule: maintenanceScheduleRaw
        ? {
            startTime: asString(maintenanceScheduleRaw.startTime),
            endTime: asString(maintenanceScheduleRaw.endTime),
            scheduleDeadlineTime: asString(maintenanceScheduleRaw.scheduleDeadlineTime)
          }
        : null,
      nodes: Array.isArray(record.nodes)
        ? (record.nodes as Array<Record<string, unknown>>).map((n) => ({
            id: asString(n.id),
            zone: asString(n.zone)
          }))
        : [],
      authorizedNetwork: asString(record.authorizedNetwork),
      reservedIpRange: asString(record.reservedIpRange)
    }
  } catch (error) {
    throw buildGcpSdkError(`getting Memorystore instance detail for "${instanceName}"`, error, 'redis.googleapis.com')
  }
}
