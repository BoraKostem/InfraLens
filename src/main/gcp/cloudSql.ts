/**
 * Cloud SQL wrappers — instance listing, detail, database and user listing,
 * operations. Extracted verbatim from gcpSdk.ts as part of the monolith
 * decomposition.
 */

import { google } from 'googleapis'

import type {
  GcpSqlDatabaseSummary,
  GcpSqlInstanceDetail,
  GcpSqlInstanceSummary,
  GcpSqlOperationSummary
} from '@shared/types'

import { getGcpAuth, requestGcp } from './client'
import {
  buildGcpSdkError,
  filterSqlInstancesByLocation,
  normalizeScopedSqlDatabase,
  normalizeSqlDatabase,
  normalizeSqlInstance,
  normalizeSqlInstanceDetail,
  normalizeSqlOperation,
  normalizeSqlUser
} from './shared'
import type { GcpSqlScopedDatabaseSummary, GcpSqlUserSummary } from './shared'

export async function listGcpSqlInstances(projectId: string, location: string): Promise<GcpSqlInstanceSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const sqladmin = google.sqladmin({ version: 'v1beta4', auth })
    const response = await sqladmin.instances.list({ project: normalizedProjectId, maxResults: 500 })
    const instances = ((response.data.items as unknown[]) ?? [])
      .map((entry) => normalizeSqlInstance(entry))
      .filter((entry): entry is GcpSqlInstanceSummary => entry !== null)

    return filterSqlInstancesByLocation(instances, location)
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud SQL instances for project "${normalizedProjectId}"`, error, 'sqladmin.googleapis.com')
  }
}

export async function listGcpSqlDatabasesForInstances(projectId: string, instanceNames: string[] = []): Promise<GcpSqlScopedDatabaseSummary[]> {
  const normalizedProjectId = projectId.trim()
  const targets = [...new Set(instanceNames.map((value) => value.trim()).filter(Boolean))]
  if (!normalizedProjectId || targets.length === 0) {
    return []
  }

  try {
    const items: GcpSqlScopedDatabaseSummary[] = []

    for (const instanceName of targets) {
      const response = await requestGcp<{ items?: unknown[] }>(normalizedProjectId, {
        url: `https://sqladmin.googleapis.com/sql/v1beta4/projects/${encodeURIComponent(normalizedProjectId)}/instances/${encodeURIComponent(instanceName)}/databases`
      })

      items.push(
        ...(response.items ?? [])
          .map((entry) => normalizeScopedSqlDatabase(entry, instanceName))
          .filter((entry): entry is GcpSqlScopedDatabaseSummary => entry !== null)
      )
    }

    return items.sort((left, right) => left.instance.localeCompare(right.instance) || left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud SQL databases for project "${normalizedProjectId}"`, error, 'sqladmin.googleapis.com')
  }
}

export async function listGcpSqlUsers(projectId: string, instanceNames: string[] = []): Promise<GcpSqlUserSummary[]> {
  const normalizedProjectId = projectId.trim()
  const targets = [...new Set(instanceNames.map((value) => value.trim()).filter(Boolean))]
  if (!normalizedProjectId || targets.length === 0) {
    return []
  }

  try {
    const items: GcpSqlUserSummary[] = []

    for (const instanceName of targets) {
      const response = await requestGcp<{ items?: unknown[] }>(normalizedProjectId, {
        url: `https://sqladmin.googleapis.com/sql/v1beta4/projects/${encodeURIComponent(normalizedProjectId)}/instances/${encodeURIComponent(instanceName)}/users`
      })

      items.push(
        ...(response.items ?? [])
          .map((entry) => normalizeSqlUser(entry, instanceName))
          .filter((entry): entry is GcpSqlUserSummary => entry !== null)
      )
    }

    return items.sort((left, right) => left.instance.localeCompare(right.instance) || left.name.localeCompare(right.name) || left.host.localeCompare(right.host))
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud SQL users for project "${normalizedProjectId}"`, error, 'sqladmin.googleapis.com')
  }
}

export async function getGcpSqlInstanceDetail(projectId: string, instanceName: string): Promise<GcpSqlInstanceDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedInstanceName) {
    throw new Error('Project and instance name are required to load Cloud SQL instance detail.')
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const sqladmin = google.sqladmin({ version: 'v1beta4', auth })
    const response = await sqladmin.instances.get({
      project: normalizedProjectId,
      instance: normalizedInstanceName
    })
    const detail = normalizeSqlInstanceDetail(response.data)

    if (!detail) {
      throw new Error(`Cloud SQL instance "${normalizedInstanceName}" was not found in project "${normalizedProjectId}".`)
    }

    return detail
  } catch (error) {
    throw buildGcpSdkError(`loading Cloud SQL instance detail for "${normalizedInstanceName}"`, error, 'sqladmin.googleapis.com')
  }
}

export async function listGcpSqlDatabases(projectId: string, instanceName: string): Promise<GcpSqlDatabaseSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedInstanceName) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const sqladmin = google.sqladmin({ version: 'v1beta4', auth })
    const response = await sqladmin.databases.list({
      project: normalizedProjectId,
      instance: normalizedInstanceName
    })

    return ((response.data.items as unknown[]) ?? [])
      .map((entry) => normalizeSqlDatabase(entry))
      .filter((entry): entry is GcpSqlDatabaseSummary => entry !== null)
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud SQL databases for "${normalizedInstanceName}"`, error, 'sqladmin.googleapis.com')
  }
}

export async function listGcpSqlOperations(projectId: string, instanceName: string): Promise<GcpSqlOperationSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedInstanceName = instanceName.trim()

  if (!normalizedProjectId || !normalizedInstanceName) {
    return []
  }

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const sqladmin = google.sqladmin({ version: 'v1beta4', auth })
    const response = await sqladmin.operations.list({
      project: normalizedProjectId,
      instance: normalizedInstanceName,
      maxResults: 20
    })

    return ((response.data.items as unknown[]) ?? [])
      .map((entry) => normalizeSqlOperation(entry))
      .filter((entry): entry is GcpSqlOperationSummary => entry !== null)
      .sort((left, right) => right.insertTime.localeCompare(left.insertTime))
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud SQL operations for "${normalizedInstanceName}"`, error, 'sqladmin.googleapis.com')
  }
}
