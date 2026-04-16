/**
 * Cloud Logging location-scoped query wrapper. Extracted verbatim from
 * gcpSdk.ts as part of the monolith decomposition. Note: monitoring.ts has
 * a separate `listGcpLogEntries` variant keyed on a direct filter string;
 * this module exports the terraform-insights-facing variant and is exported
 * from the barrel under the original name.
 */

import { google } from 'googleapis'

import type { GcpLogEntrySummary, GcpLogQueryResult } from '@shared/types'

import { getGcpAuth } from './client'
import {
  buildGcpLogFilter,
  buildGcpSdkError,
  normalizeLogEntry,
  toFacetCounts
} from './shared'

export async function listGcpLogEntries(projectId: string, location: string, query: string, windowHours = 24): Promise<GcpLogQueryResult> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return {
      query: '',
      entries: [],
      severityCounts: [],
      resourceTypeCounts: []
    }
  }

  const appliedFilter = buildGcpLogFilter(location, query, windowHours)

  try {
    const auth = getGcpAuth(normalizedProjectId)
    const logging = google.logging({ version: 'v2' as never, auth: auth as never })
    const response = await logging.entries.list({
      requestBody: {
        resourceNames: [`projects/${normalizedProjectId}`],
        orderBy: 'timestamp desc',
        pageSize: 100,
        filter: appliedFilter
      }
    } as never)

    const entries = ((response.data.entries as unknown[]) ?? [])
      .map((entry) => normalizeLogEntry(entry))
      .filter((entry): entry is GcpLogEntrySummary => entry !== null)

    return {
      query: appliedFilter,
      entries,
      severityCounts: toFacetCounts(entries.map((entry) => entry.severity)),
      resourceTypeCounts: toFacetCounts(entries.map((entry) => entry.resourceType))
    }
  } catch (error) {
    throw buildGcpSdkError(`querying Cloud Logging entries for project "${normalizedProjectId}"`, error, 'logging.googleapis.com')
  }
}
