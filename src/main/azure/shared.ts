/**
 * Shared helpers, constants, and local types used across azure/* modules.
 * Extracted from azureSdk.ts — no functional changes.
 */

import { extname } from 'node:path'

import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'

import {
  fetchAzureArmJson,
  fetchAzureArmCollection
} from './client'

import { logWarn } from '../observability'

import type {
  AzureMonitorFacetCount
} from '@shared/types'

// ── Constants ───────────────────────────────────────────────────────────────────

export const AZURE_RISKY_ROLE_MARKERS = [
  'owner',
  'contributor',
  'user access administrator',
  'role based access control administrator'
] as const

// ── Blob Service Client Cache ───────────────────────────────────────────────────

export const azureBlobServiceClientCache = new Map<string, Promise<BlobServiceClient>>()

export async function getAzureStorageAccountKey(subscriptionId: string, resourceGroup: string, accountName: string): Promise<string> {
  const response = await fetchAzureArmJson<{
    keys?: Array<{
      permissions?: string
      value?: string
    }>
  }>(
    `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(resourceGroup.trim())}/providers/Microsoft.Storage/storageAccounts/${encodeURIComponent(accountName.trim())}/listKeys`,
    '2024-01-01',
    { method: 'POST' }
  )

  const key = response.keys?.find((entry) => entry.value?.trim())?.value?.trim() || ''
  if (!key) {
    throw new Error(`No Azure storage account key was returned for account "${accountName}".`)
  }

  return key
}

export async function getAzureBlobServiceClient(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  blobEndpoint = ''
): Promise<BlobServiceClient> {
  const cacheKey = `${subscriptionId.trim()}:${resourceGroup.trim().toLowerCase()}:${accountName.trim().toLowerCase()}`
  const cached = azureBlobServiceClientCache.get(cacheKey)
  if (cached) {
    return await cached
  }

  const pending = (async () => {
    const key = await getAzureStorageAccountKey(subscriptionId, resourceGroup, accountName)
    const endpoint = blobEndpoint.trim() || `https://${accountName.trim()}.blob.core.windows.net`
    const credential = new StorageSharedKeyCredential(accountName.trim(), key)
    return new BlobServiceClient(endpoint, credential)
  })()

  azureBlobServiceClientCache.set(cacheKey, pending)

  try {
    return await pending
  } catch (error) {
    azureBlobServiceClientCache.delete(cacheKey)
    throw error
  }
}

// ── Resource ID Helpers ─────────────────────────────────────────────────────────

export function extractResourceGroup(resourceId: string): string {
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i)
  return match?.[1] ?? ''
}

export function extractResourceName(resourceId: string): string {
  const segments = resourceId.split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

// ── VM Status Helpers ───────────────────────────────────────────────────────────

export function extractPowerState(statuses: Array<{ code?: string; displayStatus?: string }>): string {
  const match = statuses.find((status) => status.code?.toLowerCase().startsWith('powerstate/'))
  return match?.displayStatus?.trim() || match?.code?.split('/').pop()?.trim() || 'Unknown'
}

export function extractProvisioningState(statuses: Array<{ code?: string; displayStatus?: string }>, fallback: string): string {
  const match = statuses.find((status) => status.code?.toLowerCase().startsWith('provisioningstate/'))
  return match?.displayStatus?.trim() || fallback.trim() || 'Unknown'
}

// ── Location / Region Helpers ───────────────────────────────────────────────────

export function normalizeLocationList(locations: string[]): string[] {
  return [...new Set(
    locations
      .map((value) => value.trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right))
}

export function normalizeRegion<T extends { location: string }>(items: T[], location: string): T[] {
  const normalizedLocation = location.trim().toLowerCase().replace(/\s+/g, '')
  if (!normalizedLocation) {
    return items
  }

  return items.filter((item) => item.location.trim().toLowerCase().replace(/\s+/g, '') === normalizedLocation)
}

// ── RBAC Helpers ────────────────────────────────────────────────────────────────

export function inferScopeKind(scope: string, subscriptionScope: string): 'subscription' | 'resourceGroup' | 'resource' {
  const normalizedScope = scope.toLowerCase()
  const normalizedSubscriptionScope = subscriptionScope.toLowerCase()

  if (normalizedScope === normalizedSubscriptionScope) {
    return 'subscription'
  }

  if (normalizedScope.includes('/resourcegroups/')) {
    return 'resourceGroup'
  }

  return 'resource'
}

// ── Monitor Helpers ─────────────────────────────────────────────────────────────

export function toFacetCounts(values: string[]): AzureMonitorFacetCount[] {
  const counts = new Map<string, number>()
  for (const value of values.map((entry) => entry.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

// ── Content Type Helpers ────────────────────────────────────────────────────────

export function guessContentTypeFromKey(key: string): string {
  switch (extname(key.trim()).toLowerCase()) {
    case '.json':
      return 'application/json'
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.ts':
    case '.tsx':
      return 'application/javascript'
    case '.html':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.md':
      return 'text/markdown'
    case '.xml':
      return 'application/xml'
    case '.yaml':
    case '.yml':
      return 'application/yaml'
    case '.csv':
      return 'text/csv'
    case '.txt':
    case '.log':
    case '.sh':
    case '.ps1':
    case '.tf':
    case '.tfvars':
      return 'text/plain'
    case '.sql':
      return 'application/sql'
    default:
      return 'application/octet-stream'
  }
}

// ── Stream Helpers ──────────────────────────────────────────────────────────────

export async function streamToBuffer(stream: NodeJS.ReadableStream | null | undefined): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0)
  }

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

// ── Subscription Location Helper ────────────────────────────────────────────────

export async function listSubscriptionLocations(subscriptionId: string): Promise<string[]> {
  const locations: string[] = []

  try {
    const response = await fetchAzureArmJson<{ value?: Array<{ name?: string; displayName?: string }> }>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/locations`,
      '2022-12-01'
    )
    for (const location of response.value ?? []) {
      const label = location.name?.trim() || location.displayName?.trim() || ''
      if (label) {
        locations.push(label)
      }
    }
  } catch (error) {
    logWarn('azureSdk.listSubscriptionLocations', 'Failed to enumerate Azure subscription locations.', { subscriptionId }, error)
  }

  return normalizeLocationList(locations)
}

// ── Azure CLI Path Resolution ───────────────────────────────────────────────────

export { getEnvironmentHealthReport } from '../environment'

export function isWindowsBatchFile(command: string): boolean {
  if (process.platform !== 'win32') return false
  const ext = extname(command.trim()).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}
