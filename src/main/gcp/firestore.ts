/**
 * Firestore wrappers — databases, collections, documents, document detail.
 * Extracted verbatim from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpFirestoreCollectionSummary,
  GcpFirestoreDatabaseSummary,
  GcpFirestoreDocumentDetail,
  GcpFirestoreDocumentSummary
} from '@shared/types'

import { requestGcp } from './client'
import { asString, buildGcpSdkError } from './shared'

function buildFirestoreApiUrl(pathname: string, query: Record<string, number | string | undefined> = {}): string {
  const url = new URL(`https://firestore.googleapis.com/v1/${pathname.replace(/^\/+/, '')}`)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') {
      continue
    }

    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

export async function listGcpFirestoreDatabases(projectId: string): Promise<GcpFirestoreDatabaseSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirestoreApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/databases`)
    })

    const databases: GcpFirestoreDatabaseSummary[] = []
    for (const entry of Array.isArray(response.databases) ? response.databases : []) {
      const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const name = asString(record.name)
      if (!name) continue

      databases.push({
        name,
        uid: asString(record.uid),
        locationId: asString(record.locationId),
        type: asString(record.type),
        concurrencyMode: asString(record.concurrencyMode),
        deleteProtectionState: asString(record.deleteProtectionState),
        earliestVersionTime: asString(record.earliestVersionTime)
      })
    }

    return databases
  } catch (error) {
    throw buildGcpSdkError(`listing Firestore databases for project "${normalizedProjectId}"`, error, 'firestore.googleapis.com')
  }
}

export async function listGcpFirestoreCollections(projectId: string, databaseId: string, parentDocumentPath?: string): Promise<GcpFirestoreCollectionSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedDatabaseId = databaseId.trim() || '(default)'

  try {
    const basePath = `projects/${encodeURIComponent(normalizedProjectId)}/databases/${encodeURIComponent(normalizedDatabaseId)}/documents`
    const documentPath = parentDocumentPath?.trim() ? `${basePath}/${parentDocumentPath.trim()}` : basePath

    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirestoreApiUrl(`${documentPath}:listCollectionIds`),
      method: 'POST',
      data: { pageSize: 500 }
    })

    const collectionIds = Array.isArray(response.collectionIds) ? response.collectionIds : []
    return collectionIds
      .map((id: unknown) => asString(id))
      .filter(Boolean)
      .map((collectionId) => ({ collectionId, documentCount: 0 }))
  } catch (error) {
    throw buildGcpSdkError(`listing Firestore collections for project "${normalizedProjectId}"`, error, 'firestore.googleapis.com')
  }
}

export async function listGcpFirestoreDocuments(projectId: string, databaseId: string, collectionId: string, pageSize = 100): Promise<GcpFirestoreDocumentSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedDatabaseId = databaseId.trim() || '(default)'
  const normalizedCollectionId = collectionId.trim()
  if (!normalizedProjectId || !normalizedCollectionId) return []

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirestoreApiUrl(
        `projects/${encodeURIComponent(normalizedProjectId)}/databases/${encodeURIComponent(normalizedDatabaseId)}/documents/${encodeURIComponent(normalizedCollectionId)}`,
        { pageSize }
      )
    })

    const documents: GcpFirestoreDocumentSummary[] = []
    for (const entry of Array.isArray(response.documents) ? response.documents : []) {
      const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const name = asString(record.name)
      if (!name) continue

      const documentId = name.split('/').pop() ?? name
      const fields = record.fields && typeof record.fields === 'object' ? record.fields as Record<string, unknown> : {}

      documents.push({
        name,
        documentId,
        createTime: asString(record.createTime),
        updateTime: asString(record.updateTime),
        fieldCount: Object.keys(fields).length
      })
    }

    return documents
  } catch (error) {
    throw buildGcpSdkError(`listing Firestore documents for collection "${normalizedCollectionId}"`, error, 'firestore.googleapis.com')
  }
}

export async function getGcpFirestoreDocumentDetail(projectId: string, databaseId: string, documentPath: string): Promise<GcpFirestoreDocumentDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedDatabaseId = databaseId.trim() || '(default)'
  const normalizedPath = documentPath.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirestoreApiUrl(
        `projects/${encodeURIComponent(normalizedProjectId)}/databases/${encodeURIComponent(normalizedDatabaseId)}/documents/${normalizedPath}`
      )
    })

    const name = asString(response.name)
    const documentId = name.split('/').pop() ?? name
    const fields = response.fields && typeof response.fields === 'object' ? response.fields as Record<string, unknown> : {}

    return {
      name,
      documentId,
      createTime: asString(response.createTime),
      updateTime: asString(response.updateTime),
      fields
    }
  } catch (error) {
    throw buildGcpSdkError(`getting Firestore document detail for "${normalizedPath}"`, error, 'firestore.googleapis.com')
  }
}
