/**
 * Cloud Projects helpers — project overview, enabled APIs, service account
 * listing. Extracted verbatim from gcpSdk.ts as part of the monolith
 * decomposition.
 */

import type {
  GcpEnabledApiSummary,
  GcpProjectOverview,
  GcpServiceAccountSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asBoolean,
  asString,
  buildGcpProjectCapabilityHints,
  buildGcpSdkError,
  getGcpProjectMetadata,
  titleFromApiName,
  toRecord
} from './shared'

/** Requires: serviceusage.services.list — API: serviceusage.googleapis.com */
export async function listGcpEnabledApis(projectId: string): Promise<GcpEnabledApiSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const services: GcpEnabledApiSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{ services?: Array<Record<string, unknown>>; nextPageToken?: string }>(normalizedProjectId, {
        url: `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(normalizedProjectId)}/services?filter=state:ENABLED&pageSize=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      })

      for (const entry of response.services ?? []) {
        const config = toRecord(entry.config)
        const name = asString(entry.name).replace(/^projects\/[^/]+\/services\//, '')
        if (!name) {
          continue
        }

        services.push({
          name,
          title: asString(config.title) || titleFromApiName(name)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return services.sort((left, right) => left.title.localeCompare(right.title))
  } catch (error) {
    throw buildGcpSdkError(`listing enabled APIs for project "${normalizedProjectId}"`, error, 'serviceusage.googleapis.com')
  }
}

/** Requires: iam.serviceAccounts.list — API: iam.googleapis.com */
export async function listGcpServiceAccounts(projectId: string): Promise<GcpServiceAccountSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const accounts: GcpServiceAccountSummary[] = []
    let pageToken = ''
    const canPage = paginationGuard()

    do {
      const response = await requestGcp<{ accounts?: Array<Record<string, unknown>>; nextPageToken?: string }>(normalizedProjectId, {
        url: `https://iam.googleapis.com/v1/projects/${encodeURIComponent(normalizedProjectId)}/serviceAccounts?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      })

      for (const entry of response.accounts ?? []) {
        const email = asString(entry.email)
        if (!email) {
          continue
        }

        accounts.push({
          email,
          displayName: asString(entry.displayName),
          uniqueId: asString(entry.uniqueId),
          description: asString(entry.description),
          disabled: asBoolean(entry.disabled)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return accounts.sort((left, right) => left.email.localeCompare(right.email))
  } catch (error) {
    throw buildGcpSdkError(`listing service accounts for project "${normalizedProjectId}"`, error, 'iam.googleapis.com')
  }
}

export async function getGcpProjectOverview(projectId: string): Promise<GcpProjectOverview> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return {
      projectId: '',
      projectNumber: '',
      displayName: '',
      lifecycleState: '',
      parentType: '',
      parentId: '',
      createTime: '',
      labels: [],
      enabledApis: [],
      enabledApiCount: 0,
      capabilityHints: [],
      notes: []
    }
  }

  try {
    const [metadata, enabledApis] = await Promise.all([
      getGcpProjectMetadata(normalizedProjectId),
      listGcpEnabledApis(normalizedProjectId)
    ])

    const overview: GcpProjectOverview = {
      projectId: metadata.projectId,
      projectNumber: metadata.projectNumber,
      displayName: metadata.name,
      lifecycleState: metadata.lifecycleState,
      parentType: metadata.parentType,
      parentId: metadata.parentId,
      createTime: metadata.createTime,
      labels: Object.entries(metadata.labels)
        .map(([key, value]) => ({ key, value }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      enabledApis: enabledApis.slice(0, 18),
      enabledApiCount: enabledApis.length,
      capabilityHints: [],
      notes: [
        'Enabled API sampling is trimmed in the UI for readability, but the total count reflects the full list returned by Service Usage.',
        'This slice focuses on project metadata and API posture. Quotas, IAM bindings, and organization policy are not wired yet.'
      ]
    }

    overview.capabilityHints = buildGcpProjectCapabilityHints(overview)
    return overview
  } catch (error) {
    const detail = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    const serviceName = detail.includes('service usage')
      ? 'serviceusage.googleapis.com'
      : 'cloudresourcemanager.googleapis.com'

    throw buildGcpSdkError(`loading project overview for project "${normalizedProjectId}"`, error, serviceName)
  }
}
