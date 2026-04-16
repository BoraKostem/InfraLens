/**
 * Cloud Storage wrappers — bucket listing, object listing, read/write,
 * upload/download/delete. Extracted verbatim from gcpSdk.ts as part of the
 * monolith decomposition.
 */

import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'

import type {
  GcpStorageBucketSummary,
  GcpStorageObjectContent,
  GcpStorageObjectSummary
} from '@shared/types'

import { requestGcp } from './client'
import {
  asBuffer,
  asString,
  buildGcpSdkError,
  buildGcpStorageObjectSummaries,
  buildStorageApiUrl,
  encodeStorageObjectKey,
  filterStorageBucketsByLocation,
  guessContentTypeFromKey,
  normalizeStorageBucket,
  normalizeStorageObjectRecord
} from './shared'
import type { GcpStorageObjectRecord } from './shared'

export async function listGcpStorageBuckets(projectId: string, location: string): Promise<GcpStorageBucketSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const response = await requestGcp<{ items?: unknown[] }>(normalizedProjectId, {
      url: buildStorageApiUrl('/storage/v1/b', {
        project: normalizedProjectId,
        maxResults: 500
      })
    })
    const buckets = (response.items ?? [])
      .map((bucket) => normalizeStorageBucket(bucket))
      .filter((entry): entry is GcpStorageBucketSummary => entry !== null)

    return filterStorageBucketsByLocation(buckets, location)
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Storage buckets for project "${normalizedProjectId}"`, error, 'storage.googleapis.com')
  }
}

export async function listGcpStorageObjects(projectId: string, bucketName: string, prefix = ''): Promise<GcpStorageObjectSummary[]> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedPrefix = prefix.trim()
  if (!normalizedProjectId || !normalizedBucketName) {
    return []
  }

  try {
    const response = await requestGcp<{ items?: unknown[]; prefixes?: string[] }>(normalizedProjectId, {
      url: buildStorageApiUrl(`/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o`, {
        maxResults: 500,
        prefix: normalizedPrefix || undefined,
        delimiter: '/'
      })
    })

    const records = [
      ...(response.items ?? [])
        .map((file) => normalizeStorageObjectRecord(file, normalizedBucketName))
        .filter((entry): entry is GcpStorageObjectRecord => entry !== null),
      ...(response.prefixes ?? []).map((folderPrefix) => ({
        key: folderPrefix,
        size: 0,
        lastModified: '',
        storageClass: ''
      }))
    ]

    return buildGcpStorageObjectSummaries(records, normalizedPrefix)
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Storage objects for bucket "${normalizedBucketName}"`, error, 'storage.googleapis.com')
  }
}

export async function getGcpStorageObjectContent(projectId: string, bucketName: string, key: string): Promise<GcpStorageObjectContent> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedKey = key.trim()
  if (!normalizedProjectId || !normalizedBucketName || !normalizedKey) {
    return { body: '', contentType: guessContentTypeFromKey(normalizedKey) }
  }

  try {
    const objectPath = `/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o/${encodeStorageObjectKey(normalizedKey)}`
    const [metadata, body] = await Promise.all([
      requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildStorageApiUrl(objectPath)
      }),
      requestGcp<string>(normalizedProjectId, {
        url: buildStorageApiUrl(objectPath, { alt: 'media' }),
        responseType: 'text'
      })
    ])

    return {
      body,
      contentType: asString(metadata.contentType) || guessContentTypeFromKey(normalizedKey)
    }
  } catch (error) {
    throw buildGcpSdkError(`reading Cloud Storage object "${normalizedKey}"`, error, 'storage.googleapis.com')
  }
}

export async function putGcpStorageObjectContent(projectId: string, bucketName: string, key: string, content: string): Promise<void> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedKey = key.trim()
  if (!normalizedProjectId || !normalizedBucketName || !normalizedKey) {
    return
  }

  try {
    await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildStorageApiUrl(`/upload/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o`, {
        uploadType: 'media',
        name: normalizedKey
      }),
      method: 'POST',
      headers: {
        'Content-Type': guessContentTypeFromKey(normalizedKey)
      },
      data: content
    })
  } catch (error) {
    throw buildGcpSdkError(`writing Cloud Storage object "${normalizedKey}"`, error, 'storage.googleapis.com')
  }
}

export async function uploadGcpStorageObject(projectId: string, bucketName: string, key: string, localPath: string): Promise<void> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedKey = key.trim()
  const normalizedLocalPath = localPath.trim()
  if (!normalizedProjectId || !normalizedBucketName || !normalizedKey || !normalizedLocalPath) {
    return
  }

  try {
    const fileBody = await readFile(normalizedLocalPath)
    await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildStorageApiUrl(`/upload/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o`, {
        uploadType: 'media',
        name: normalizedKey
      }),
      method: 'POST',
      headers: {
        'Content-Type': guessContentTypeFromKey(normalizedKey || normalizedLocalPath)
      },
      data: fileBody
    })
  } catch (error) {
    throw buildGcpSdkError(`uploading Cloud Storage object "${normalizedKey}"`, error, 'storage.googleapis.com')
  }
}

export async function downloadGcpStorageObjectToPath(projectId: string, bucketName: string, key: string): Promise<string> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedKey = key.trim()
  if (!normalizedProjectId || !normalizedBucketName || !normalizedKey) {
    return ''
  }

  const fileName = path.basename(normalizedKey) || 'download'
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: fileName,
    title: 'Save Cloud Storage Object'
  })

  if (result.canceled || !result.filePath) {
    return ''
  }

  try {
    const body = await requestGcp<ArrayBuffer | Buffer | Uint8Array>(normalizedProjectId, {
      url: buildStorageApiUrl(`/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o/${encodeStorageObjectKey(normalizedKey)}`, {
        alt: 'media'
      }),
      responseType: 'arraybuffer'
    })
    await writeFile(result.filePath, asBuffer(body))
    return result.filePath
  } catch (error) {
    throw buildGcpSdkError(`downloading Cloud Storage object "${normalizedKey}"`, error, 'storage.googleapis.com')
  }
}

export async function deleteGcpStorageObject(projectId: string, bucketName: string, key: string): Promise<void> {
  const normalizedProjectId = projectId.trim()
  const normalizedBucketName = bucketName.trim()
  const normalizedKey = key.trim()
  if (!normalizedProjectId || !normalizedBucketName || !normalizedKey) {
    return
  }

  try {
    await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildStorageApiUrl(`/storage/v1/b/${encodeURIComponent(normalizedBucketName)}/o/${encodeStorageObjectKey(normalizedKey)}`),
      method: 'DELETE'
    })
  } catch (error) {
    throw buildGcpSdkError(`deleting Cloud Storage object "${normalizedKey}"`, error, 'storage.googleapis.com')
  }
}
