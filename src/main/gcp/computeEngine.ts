/**
 * Compute Engine wrappers — instances, machine types, lifecycle actions,
 * serial output. Extracted verbatim from gcpSdk.ts as part of the monolith
 * decomposition.
 */

import { google } from 'googleapis'

import type {
  GcpComputeInstanceAction,
  GcpComputeInstanceDetail,
  GcpComputeInstanceSummary,
  GcpComputeMachineTypeOption,
  GcpComputeOperationResult,
  GcpComputeSerialOutput
} from '@shared/types'

import { getGcpAuth, paginationGuard, requestGcp } from './client'
import {
  asString,
  buildComputeApiUrl,
  buildGcpComputeActionSummary,
  buildGcpComputeDeleteSummary,
  buildGcpComputeLabelSummary,
  buildGcpComputeResizeSummary,
  buildGcpMachineTypeResource,
  buildGcpSdkError,
  filterComputeInstancesByLocation,
  normalizeGcpComputeInstanceDetail,
  normalizeGcpComputeMachineTypeOption,
  normalizeNumber,
  resourceBasename,
  waitForGcpZoneOperation
} from './shared'

export async function listGcpComputeInstances(projectId: string, location: string): Promise<GcpComputeInstanceSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const instances: GcpComputeInstanceSummary[] = []
    let pageToken: string | undefined

    const canPage = paginationGuard()
    do {
      const response = await compute.instances.aggregatedList({ project: normalizedProjectId, maxResults: 500, pageToken })
      for (const scoped of Object.values(response.data.items ?? {})) {
        const scopedRecord = scoped as { instances?: Array<Record<string, unknown>> } | null | undefined
        for (const instance of scopedRecord?.instances ?? []) {
          const name = asString(instance.name)
          if (!name) {
            continue
          }
          instances.push({
            name,
            zone: resourceBasename(asString(instance.zone)),
            status: asString(instance.status),
            machineType: resourceBasename(asString(instance.machineType)),
            internalIp: asString((instance.networkInterfaces as Array<Record<string, unknown>> | undefined)?.[0]?.networkIP),
            externalIp: asString((((instance.networkInterfaces as Array<Record<string, unknown>> | undefined)?.[0]?.accessConfigs as Array<Record<string, unknown>> | undefined)?.[0]?.natIP))
          })
        }
      }
      pageToken = asString(response.data.nextPageToken) || undefined
    } while (pageToken && canPage())

    return filterComputeInstancesByLocation(instances, location)
      .sort((left, right) => left.zone.localeCompare(right.zone) || left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing Compute Engine instances for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function getGcpComputeInstanceDetail(projectId: string, zone: string, instanceName: string): Promise<GcpComputeInstanceDetail | null> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName) {
    return null
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const response = await compute.instances.get({
      project: normalizedProjectId,
      zone: normalizedZone,
      instance: normalizedInstanceName
    })

    return normalizeGcpComputeInstanceDetail(response.data)
  } catch (error) {
    throw buildGcpSdkError(`describing Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpComputeMachineTypes(projectId: string, zone: string): Promise<GcpComputeMachineTypeOption[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()

  if (!normalizedProjectId || !normalizedZone) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const machineTypes: GcpComputeMachineTypeOption[] = []
    let pageToken: string | undefined

    const canPage = paginationGuard()
    do {
      const response = await compute.machineTypes.list({
        project: normalizedProjectId,
        zone: normalizedZone,
        maxResults: 500,
        pageToken
      })

      for (const entry of response.data.items ?? []) {
        const normalized = normalizeGcpComputeMachineTypeOption(entry)
        if (normalized) {
          machineTypes.push(normalized)
        }
      }

      pageToken = asString(response.data.nextPageToken) || undefined
    } while (pageToken && canPage())

    return machineTypes.sort((left, right) =>
      left.guestCpus - right.guestCpus
      || left.memoryMb - right.memoryMb
      || left.name.localeCompare(right.name)
    )
  } catch (error) {
    throw buildGcpSdkError(`listing machine types for zone "${normalizedZone}"`, error, 'compute.googleapis.com')
  }
}

export async function runGcpComputeInstanceAction(
  projectId: string,
  zone: string,
  instanceName: string,
  action: GcpComputeInstanceAction
): Promise<GcpComputeOperationResult> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName) {
    throw new Error('Project, zone, and instance name are required.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    let response

    switch (action) {
      case 'start':
        response = await compute.instances.start({ project: normalizedProjectId, zone: normalizedZone, instance: normalizedInstanceName })
        break
      case 'stop':
        response = await compute.instances.stop({ project: normalizedProjectId, zone: normalizedZone, instance: normalizedInstanceName })
        break
      case 'reset':
        response = await compute.instances.reset({ project: normalizedProjectId, zone: normalizedZone, instance: normalizedInstanceName })
        break
      case 'resume':
        response = await compute.instances.resume({ project: normalizedProjectId, zone: normalizedZone, instance: normalizedInstanceName })
        break
      case 'suspend':
        response = await compute.instances.suspend({ project: normalizedProjectId, zone: normalizedZone, instance: normalizedInstanceName })
        break
      default:
        throw new Error(`Unsupported Compute Engine action: ${action}`)
    }

    const operationName = asString(response.data.name)
    const result = await waitForGcpZoneOperation(normalizedProjectId, normalizedZone, operationName)

    return {
      operationName,
      completed: result.completed,
      status: result.status,
      summary: buildGcpComputeActionSummary(action, normalizedInstanceName, result.completed)
    }
  } catch (error) {
    throw buildGcpSdkError(`running ${action} on Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}

export async function resizeGcpComputeInstance(
  projectId: string,
  zone: string,
  instanceName: string,
  machineType: string
): Promise<GcpComputeOperationResult> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()
  const normalizedMachineType = machineType.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName || !normalizedMachineType) {
    throw new Error('Project, zone, instance name, and machine type are required.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const response = await compute.instances.setMachineType({
      project: normalizedProjectId,
      zone: normalizedZone,
      instance: normalizedInstanceName,
      requestBody: {
        machineType: buildGcpMachineTypeResource(normalizedZone, normalizedMachineType)
      }
    })

    const operationName = asString(response.data.name)
    const result = await waitForGcpZoneOperation(normalizedProjectId, normalizedZone, operationName)

    return {
      operationName,
      completed: result.completed,
      status: result.status,
      summary: buildGcpComputeResizeSummary(normalizedInstanceName, normalizedMachineType, result.completed)
    }
  } catch (error) {
    throw buildGcpSdkError(`resizing Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}

export async function updateGcpComputeInstanceLabels(
  projectId: string,
  zone: string,
  instanceName: string,
  labels: Record<string, string>
): Promise<GcpComputeOperationResult> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName) {
    throw new Error('Project, zone, and instance name are required.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const current = await compute.instances.get({
      project: normalizedProjectId,
      zone: normalizedZone,
      instance: normalizedInstanceName
    })
    const fingerprint = asString(current.data.labelFingerprint)

    if (!fingerprint) {
      throw new Error('The instance label fingerprint is missing. Refresh and retry.')
    }

    const normalizedLabels = Object.fromEntries(
      Object.entries(labels)
        .map(([key, value]) => [key.trim(), value.trim()] as const)
        .filter(([key]) => Boolean(key))
    )

    const response = await compute.instances.setLabels({
      project: normalizedProjectId,
      zone: normalizedZone,
      instance: normalizedInstanceName,
      requestBody: {
        labelFingerprint: fingerprint,
        labels: normalizedLabels
      }
    })

    const operationName = asString(response.data.name)
    const result = await waitForGcpZoneOperation(normalizedProjectId, normalizedZone, operationName)

    return {
      operationName,
      completed: result.completed,
      status: result.status,
      summary: buildGcpComputeLabelSummary(normalizedInstanceName, result.completed)
    }
  } catch (error) {
    throw buildGcpSdkError(`updating labels on Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}

export async function deleteGcpComputeInstance(projectId: string, zone: string, instanceName: string): Promise<GcpComputeOperationResult> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName) {
    throw new Error('Project, zone, and instance name are required.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const compute = google.compute({ version: 'v1', auth })
    const response = await compute.instances.delete({
      project: normalizedProjectId,
      zone: normalizedZone,
      instance: normalizedInstanceName
    })

    const operationName = asString(response.data.name)
    const result = await waitForGcpZoneOperation(normalizedProjectId, normalizedZone, operationName)

    return {
      operationName,
      completed: result.completed,
      status: result.status,
      summary: buildGcpComputeDeleteSummary(normalizedInstanceName, result.completed)
    }
  } catch (error) {
    throw buildGcpSdkError(`deleting Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}

export async function getGcpComputeSerialOutput(
  projectId: string,
  zone: string,
  instanceName: string,
  port = 1,
  start = 0
): Promise<GcpComputeSerialOutput> {
  const normalizedProjectId = projectId.trim()
  const normalizedZone = zone.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedZone || !normalizedInstanceName) {
    return { contents: '', nextStart: 0, port }
  }

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildComputeApiUrl(normalizedProjectId, `zones/${normalizedZone}/instances/${normalizedInstanceName}/serialPort`, {
        port,
        start
      })
    })

    return {
      contents: asString(response.contents),
      nextStart: normalizeNumber(response.next),
      port
    }
  } catch (error) {
    throw buildGcpSdkError(`reading serial output for Compute Engine instance "${normalizedInstanceName}"`, error, 'compute.googleapis.com')
  }
}
