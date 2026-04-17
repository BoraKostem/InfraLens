/**
 * BigQuery wrappers — dataset, table, table detail listings and ad-hoc query
 * execution. Extracted verbatim from gcpSdk.ts as part of the monolith
 * decomposition. Note: this is distinct from the billing-export BigQuery
 * helpers in ./shared.ts which power billing overviews.
 */

import type {
  GcpBigQueryDatasetSummary,
  GcpBigQueryQueryResult,
  GcpBigQuerySchemaFieldSummary,
  GcpBigQueryTableDetail,
  GcpBigQueryTableSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asBoolean,
  asString,
  buildBigQueryApiUrl,
  buildGcpSdkError,
  sleep
} from './shared'

function normalizeBigQuerySchemaField(entry: unknown): GcpBigQuerySchemaFieldSummary | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const name = asString(record.name)
  if (!name) return null

  const subFields = Array.isArray(record.fields)
    ? record.fields.map((child: unknown) => normalizeBigQuerySchemaField(child)).filter((f): f is GcpBigQuerySchemaFieldSummary => f !== null)
    : []

  return {
    name,
    type: asString(record.type),
    mode: asString(record.mode),
    description: asString(record.description),
    fields: subFields
  }
}

export async function listGcpBigQueryDatasetsExported(projectId: string): Promise<GcpBigQueryDatasetSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const summaries: GcpBigQueryDatasetSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildBigQueryApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/datasets`, {
          all: 'true',
          maxResults: 1000,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.datasets) ? response.datasets : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const reference = record.datasetReference && typeof record.datasetReference === 'object'
          ? record.datasetReference as Record<string, unknown>
          : {}
        const datasetId = asString(reference.datasetId)
        if (!datasetId) continue

        summaries.push({
          datasetId,
          projectId: asString(reference.projectId) || normalizedProjectId,
          location: asString(record.location),
          friendlyName: asString(record.friendlyName),
          description: asString((record as Record<string, unknown>).description),
          creationTime: asString(record.creationTime),
          lastModifiedTime: asString(record.lastModifiedTime),
          tableCount: 0
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return summaries
  } catch (error) {
    throw buildGcpSdkError(`listing BigQuery datasets for project "${normalizedProjectId}"`, error, 'bigquery.googleapis.com')
  }
}

export async function listGcpBigQueryTables(projectId: string, datasetId: string): Promise<GcpBigQueryTableSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedDatasetId = datasetId.trim()
  if (!normalizedProjectId || !normalizedDatasetId) return []

  try {
    const tables: GcpBigQueryTableSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildBigQueryApiUrl(
          `projects/${encodeURIComponent(normalizedProjectId)}/datasets/${encodeURIComponent(normalizedDatasetId)}/tables`,
          { maxResults: 1000, pageToken: pageToken || undefined }
        )
      })

      for (const entry of Array.isArray(response.tables) ? response.tables : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const reference = record.tableReference && typeof record.tableReference === 'object'
          ? record.tableReference as Record<string, unknown>
          : {}
        const tableId = asString(reference.tableId)
        if (!tableId) continue

        tables.push({
          tableId,
          datasetId: normalizedDatasetId,
          projectId: normalizedProjectId,
          type: asString(record.type),
          creationTime: asString(record.creationTime),
          expirationTime: asString(record.expirationTime),
          rowCount: asString((record as Record<string, unknown>).numRows),
          sizeBytes: asString((record as Record<string, unknown>).numBytes),
          description: asString((record as Record<string, unknown>).description)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return tables
  } catch (error) {
    throw buildGcpSdkError(`listing BigQuery tables for dataset "${normalizedDatasetId}"`, error, 'bigquery.googleapis.com')
  }
}

export async function getGcpBigQueryTableDetail(projectId: string, datasetId: string, tableId: string): Promise<GcpBigQueryTableDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedDatasetId = datasetId.trim()
  const normalizedTableId = tableId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildBigQueryApiUrl(
        `projects/${encodeURIComponent(normalizedProjectId)}/datasets/${encodeURIComponent(normalizedDatasetId)}/tables/${encodeURIComponent(normalizedTableId)}`
      )
    })

    const schema = response.schema && typeof response.schema === 'object' ? response.schema as Record<string, unknown> : {}
    const fields = (Array.isArray(schema.fields) ? schema.fields : [])
      .map((entry: unknown) => normalizeBigQuerySchemaField(entry))
      .filter((field): field is GcpBigQuerySchemaFieldSummary => field !== null)

    return {
      tableId: normalizedTableId,
      datasetId: normalizedDatasetId,
      projectId: normalizedProjectId,
      type: asString(response.type),
      schema: fields,
      rowCount: asString(response.numRows),
      sizeBytes: asString(response.numBytes),
      creationTime: asString(response.creationTime),
      lastModifiedTime: asString(response.lastModifiedTime),
      description: asString((response as Record<string, unknown>).description),
      location: asString(response.location)
    }
  } catch (error) {
    throw buildGcpSdkError(`getting BigQuery table detail for "${normalizedTableId}"`, error, 'bigquery.googleapis.com')
  }
}

export async function runGcpBigQueryQuery(projectId: string, queryText: string, maxResults = 100): Promise<GcpBigQueryQueryResult> {
  const normalizedProjectId = projectId.trim()

  try {
    const initial = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildBigQueryApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/queries`),
      method: 'POST',
      data: {
        query: queryText,
        useLegacySql: false,
        timeoutMs: 20000,
        maxResults
      }
    })

    let response = initial
    let attempts = 0
    const jobReference = initial.jobReference && typeof initial.jobReference === 'object'
      ? initial.jobReference as Record<string, unknown>
      : {}
    const jobId = asString(jobReference.jobId)

    while (!asBoolean(response.jobComplete) && jobId && attempts < 12) {
      attempts += 1
      await sleep(500)
      response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildBigQueryApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/queries/${encodeURIComponent(jobId)}`, {
          maxResults
        })
      })
    }

    const schemaObj = response.schema && typeof response.schema === 'object' ? response.schema as Record<string, unknown> : {}
    const schemaFields = Array.isArray(schemaObj.fields) ? schemaObj.fields : []
    const columns = schemaFields.map((field: unknown) => {
      if (field && typeof field === 'object') return asString((field as Record<string, unknown>).name)
      return ''
    })

    const rawRows = Array.isArray(response.rows) ? response.rows : []
    const rows = rawRows.map((row: unknown) => {
      if (!row || typeof row !== 'object') return []
      const values = Array.isArray((row as Record<string, unknown>).f) ? (row as Record<string, unknown>).f as unknown[] : []
      return values.map((cell: unknown) => {
        if (!cell || typeof cell !== 'object') return ''
        return asString((cell as Record<string, unknown>).v)
      })
    })

    return {
      columns,
      rows,
      totalRows: asString(response.totalRows),
      jobComplete: asBoolean(response.jobComplete),
      cacheHit: asBoolean(response.cacheHit)
    }
  } catch (error) {
    throw buildGcpSdkError(`running BigQuery query for project "${normalizedProjectId}"`, error, 'bigquery.googleapis.com')
  }
}
