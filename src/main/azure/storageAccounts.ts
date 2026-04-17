/**
 * Azure Storage Accounts — extracted from azureSdk.ts.
 */

import { app, dialog, BrowserWindow, shell } from 'electron'
import { watchFile, unwatchFile } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import {
  extractResourceGroup,
  extractResourceName,
  normalizeRegion,
  guessContentTypeFromKey,
  streamToBuffer,
  getAzureBlobServiceClient,
  getAzureStorageAccountKey
} from './shared'
import { logWarn } from '../observability'
import type {
  AzureStorageAccountSummary,
  AzureStorageContainerSummary,
  AzureStorageBlobSummary,
  AzureStorageBlobContent,
  AzureStorageFileShareSummary,
  AzureStorageQueueSummary,
  AzureStorageTableSummary
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureStorageAccounts(subscriptionId: string, location: string): Promise<AzureStorageAccountSummary[]> {
  const accounts = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    kind?: string
    sku?: { name?: string }
    tags?: Record<string, string>
    properties?: {
      accessTier?: string
      publicNetworkAccess?: string
      minimumTlsVersion?: string
      allowBlobPublicAccess?: boolean
      allowSharedKeyAccess?: boolean
      supportsHttpsTrafficOnly?: boolean
      networkAcls?: {
        defaultAction?: string
      }
      primaryEndpoints?: {
        blob?: string
        file?: string
        queue?: string
        table?: string
      }
    }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.Storage/storageAccounts`, '2024-01-01')

  const filteredAccounts = normalizeRegion(
    accounts.map((account) => ({
      id: account.id?.trim() || '',
      name: account.name?.trim() || extractResourceName(account.id ?? ''),
      resourceGroup: extractResourceGroup(account.id ?? ''),
      location: account.location?.trim() || '',
      kind: account.kind?.trim() || '',
      skuName: account.sku?.name?.trim() || '',
      accessTier: account.properties?.accessTier?.trim() || '',
      publicNetworkAccess: account.properties?.publicNetworkAccess?.trim() || 'Enabled',
      defaultNetworkAction: account.properties?.networkAcls?.defaultAction?.trim() || 'Allow',
      minimumTlsVersion: account.properties?.minimumTlsVersion?.trim() || 'TLS1_0',
      allowBlobPublicAccess: account.properties?.allowBlobPublicAccess === true,
      allowSharedKeyAccess: account.properties?.allowSharedKeyAccess !== false,
      httpsOnly: account.properties?.supportsHttpsTrafficOnly !== false,
      primaryBlobEndpoint: account.properties?.primaryEndpoints?.blob?.trim() || '',
      primaryFileEndpoint: account.properties?.primaryEndpoints?.file?.trim() || '',
      primaryQueueEndpoint: account.properties?.primaryEndpoints?.queue?.trim() || '',
      primaryTableEndpoint: account.properties?.primaryEndpoints?.table?.trim() || '',
      tagCount: Object.keys(account.tags ?? {}).length
    })),
    location
  )

  const results = await Promise.all(filteredAccounts.map(async (account) => {
    try {
      const serviceProperties = await fetchAzureArmJson<{
        properties?: {
          isVersioningEnabled?: boolean
          changeFeed?: { enabled?: boolean }
          deleteRetentionPolicy?: { enabled?: boolean; days?: number }
          containerDeleteRetentionPolicy?: { enabled?: boolean; days?: number }
        }
      }>(
        `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(account.resourceGroup)}/providers/Microsoft.Storage/storageAccounts/${encodeURIComponent(account.name)}/blobServices/default`,
        '2024-01-01'
      )

      const notes: string[] = []
      if (account.publicNetworkAccess.toLowerCase() === 'enabled' && account.defaultNetworkAction.toLowerCase() === 'allow') {
        notes.push('Public network access is enabled with allow-by-default network rules.')
      }
      if (!account.httpsOnly) {
        notes.push('HTTPS-only traffic enforcement is disabled.')
      }
      if (account.allowBlobPublicAccess) {
        notes.push('Blob public access is allowed on this account.')
      }
      if (!account.allowSharedKeyAccess) {
        notes.push('Shared key access is disabled; data-plane mutations may require alternate auth paths.')
      }

      return {
        ...account,
        versioningEnabled: serviceProperties.properties?.isVersioningEnabled === true,
        changeFeedEnabled: serviceProperties.properties?.changeFeed?.enabled === true,
        blobDeleteRetentionDays: serviceProperties.properties?.deleteRetentionPolicy?.enabled
          ? serviceProperties.properties?.deleteRetentionPolicy?.days ?? 0
          : 0,
        containerDeleteRetentionDays: serviceProperties.properties?.containerDeleteRetentionPolicy?.enabled
          ? serviceProperties.properties?.containerDeleteRetentionPolicy?.days ?? 0
          : 0,
        containerCount: 0,
        notes
      } satisfies AzureStorageAccountSummary
    } catch (error) {
      logWarn('azureSdk.listAzureStorageAccounts', 'Failed to load blob service properties for Azure storage account.', { account: account.name }, error)
      return {
        ...account,
        versioningEnabled: false,
        changeFeedEnabled: false,
        blobDeleteRetentionDays: 0,
        containerDeleteRetentionDays: 0,
        containerCount: 0,
        notes: ['Blob service properties were not fully visible for this account.']
      } satisfies AzureStorageAccountSummary
    }
  }))

  return results.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listAzureStorageContainers(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  blobEndpoint = ''
): Promise<AzureStorageContainerSummary[]> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const iterator = serviceClient.listContainers({ includeMetadata: true })
    const basicContainers = []
    for await (const container of iterator) {
      basicContainers.push(container)
    }

    const results = await Promise.all(basicContainers.map(async (container) => {
      const containerClient = serviceClient.getContainerClient(container.name)
      const properties = await containerClient.getProperties()

      return {
        name: container.name,
        publicAccess: properties.blobPublicAccess?.trim() || 'private',
        metadataCount: Object.keys(container.metadata ?? {}).length,
        leaseStatus: properties.leaseStatus?.trim() || 'unlocked',
        lastModified: properties.lastModified?.toISOString() || '',
        hasImmutabilityPolicy: properties.hasImmutabilityPolicy === true,
        hasLegalHold: properties.hasLegalHold === true,
        defaultEncryptionScope: properties.defaultEncryptionScope?.trim() || '',
        denyEncryptionScopeOverride: properties.denyEncryptionScopeOverride === true
      } satisfies AzureStorageContainerSummary
    }))

    return results.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw new Error(`Failed to list Azure storage containers for "${accountName}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function listAzureStorageBlobs(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  prefix = '',
  blobEndpoint = ''
): Promise<AzureStorageBlobSummary[]> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const containerClient = serviceClient.getContainerClient(containerName.trim())
    const iterator = containerClient.listBlobsByHierarchy('/', { prefix: prefix.trim() || undefined })
    const items: AzureStorageBlobSummary[] = []

    for await (const item of iterator) {
      if (item.kind === 'prefix') {
        items.push({
          key: item.name,
          size: 0,
          lastModified: '',
          contentType: '',
          accessTier: '',
          isFolder: true
        })
        continue
      }

      items.push({
        key: item.name,
        size: item.properties.contentLength ?? 0,
        lastModified: item.properties.lastModified?.toISOString() || '',
        contentType: item.properties.contentType?.trim() || guessContentTypeFromKey(item.name),
        accessTier: item.properties.accessTier?.toString().trim() || '',
        isFolder: false
      })
    }

    return items.sort((left, right) => {
      if (left.isFolder !== right.isFolder) {
        return left.isFolder ? -1 : 1
      }

      return left.key.localeCompare(right.key)
    })
  } catch (error) {
    throw new Error(`Failed to list Azure storage blobs for "${accountName}/${containerName}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function getAzureStorageBlobContent(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<AzureStorageBlobContent> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blobClient = serviceClient.getContainerClient(containerName.trim()).getBlobClient(key.trim())
    const [properties, download] = await Promise.all([
      blobClient.getProperties(),
      blobClient.download()
    ])

    return {
      body: (await streamToBuffer(download.readableStreamBody)).toString('utf8'),
      contentType: properties.contentType?.trim() || guessContentTypeFromKey(key)
    }
  } catch (error) {
    throw new Error(`Failed to read Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function putAzureStorageBlobContent(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  content: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blockBlobClient = serviceClient.getContainerClient(containerName.trim()).getBlockBlobClient(key.trim())
    await blockBlobClient.uploadData(Buffer.from(content, 'utf8'), {
      blobHTTPHeaders: {
        blobContentType: guessContentTypeFromKey(key)
      }
    })
  } catch (error) {
    throw new Error(`Failed to write Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function uploadAzureStorageBlob(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  localPath: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const body = await readFile(localPath.trim())
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blockBlobClient = serviceClient.getContainerClient(containerName.trim()).getBlockBlobClient(key.trim())
    await blockBlobClient.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: guessContentTypeFromKey(key || localPath)
      }
    })
  } catch (error) {
    throw new Error(`Failed to upload Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function downloadAzureStorageBlobToPath(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<string> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: basename(key.trim()) || 'download',
    title: 'Save Azure Blob'
  })

  if (result.canceled || !result.filePath) {
    return ''
  }

  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    const blobClient = serviceClient.getContainerClient(containerName.trim()).getBlobClient(key.trim())
    const download = await blobClient.download()
    await writeFile(result.filePath, await streamToBuffer(download.readableStreamBody))
    return result.filePath
  } catch (error) {
    throw new Error(`Failed to download Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function deleteAzureStorageBlob(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    await serviceClient.getContainerClient(containerName.trim()).deleteBlob(key.trim())
  } catch (error) {
    throw new Error(`Failed to delete Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function createAzureStorageContainer(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  blobEndpoint = ''
): Promise<void> {
  try {
    const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
    await serviceClient.getContainerClient(containerName.trim()).create({ access: undefined })
  } catch (error) {
    throw new Error(`Failed to create Azure container "${containerName}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function downloadAzureStorageBlobToTemp(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<string> {
  const serviceClient = await getAzureBlobServiceClient(subscriptionId, resourceGroup, accountName, blobEndpoint)
  const blobClient = serviceClient.getContainerClient(containerName.trim()).getBlobClient(key.trim())
  const download = await blobClient.download()

  const fileName = basename(key.split('/').pop() || 'download').replace(/\.\./g, '_')
  const tempDir = app.getPath('temp')
  const filePath = join(tempDir, `azure-blob-${Date.now()}-${fileName}`)

  const buf = await streamToBuffer(download.readableStreamBody)
  await writeFile(filePath, buf, { mode: 0o600 })
  return filePath
}

export async function openAzureStorageBlob(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<string> {
  try {
    const filePath = await downloadAzureStorageBlobToTemp(subscriptionId, resourceGroup, accountName, containerName, key, blobEndpoint)
    void shell.openPath(filePath)
    return filePath
  } catch (error) {
    throw new Error(`Failed to open Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

const azureBlobWatchedFiles = new Set<string>()

export async function openAzureStorageBlobInVSCode(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = ''
): Promise<string> {
  try {
    const filePath = await downloadAzureStorageBlobToTemp(subscriptionId, resourceGroup, accountName, containerName, key, blobEndpoint)
    void shell.openExternal(`vscode://file/${encodeURI(filePath)}`)

    if (azureBlobWatchedFiles.has(filePath)) {
      unwatchFile(filePath)
    }

    let uploading = false
    watchFile(filePath, { interval: 1000 }, async (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs || uploading) return
      uploading = true
      try {
        await uploadAzureStorageBlob(subscriptionId, resourceGroup, accountName, containerName, key, filePath, blobEndpoint)
      } catch {
        unwatchFile(filePath)
        azureBlobWatchedFiles.delete(filePath)
      } finally {
        uploading = false
      }
    })

    azureBlobWatchedFiles.add(filePath)

    app.once('before-quit', () => {
      unwatchFile(filePath)
      azureBlobWatchedFiles.delete(filePath)
    })

    return filePath
  } catch (error) {
    throw new Error(`Failed to open Azure blob "${key}" in VSCode: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function generateAzureStorageBlobSasUrl(
  subscriptionId: string,
  resourceGroup: string,
  accountName: string,
  containerName: string,
  key: string,
  blobEndpoint = '',
  expiresInSeconds = 3600
): Promise<string> {
  try {
    const storageKey = await getAzureStorageAccountKey(subscriptionId, resourceGroup, accountName)
    const credential = new StorageSharedKeyCredential(accountName.trim(), storageKey)
    const endpoint = blobEndpoint.trim() || `https://${accountName.trim()}.blob.core.windows.net`

    const startsOn = new Date()
    const expiresOn = new Date(startsOn.getTime() + expiresInSeconds * 1000)

    const sasToken = generateBlobSASQueryParameters({
      containerName: containerName.trim(),
      blobName: key.trim(),
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn
    }, credential).toString()

    return `${endpoint}/${containerName.trim()}/${key.trim()}?${sasToken}`
  } catch (error) {
    throw new Error(`Failed to generate SAS URL for Azure blob "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Storage File/Queue/Table ────────────────────────────────────────────────────

export async function listAzureStorageFileShares(subscriptionId: string, resourceGroup: string, accountName: string): Promise<AzureStorageFileShareSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Storage/storageAccounts/${enc(accountName)}/fileServices/default/shares`,
    '2024-01-01'
  )
  return raw.map((s) => {
    const props = (s.properties ?? {}) as Record<string, unknown>
    return {
      name: String(s.name ?? ''),
      quota: Number(props.shareQuota ?? 0),
      accessTier: String(props.accessTier ?? ''),
      enabledProtocols: String(props.enabledProtocols ?? 'SMB'),
      leaseStatus: String(props.leaseStatus ?? ''),
      lastModified: String(props.lastModifiedTime ?? ''),
      usedCapacityBytes: Number(props.shareUsageBytes ?? 0)
    }
  })
}

export async function listAzureStorageQueues(subscriptionId: string, resourceGroup: string, accountName: string): Promise<AzureStorageQueueSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Storage/storageAccounts/${enc(accountName)}/queueServices/default/queues`,
    '2024-01-01'
  )
  return raw.map((q) => {
    const props = (q.properties ?? {}) as Record<string, unknown>
    return {
      name: String(q.name ?? ''),
      approximateMessageCount: Number(props.approximateMessageCount ?? 0),
      metadata: (props.metadata ?? {}) as Record<string, string>
    }
  })
}

export async function listAzureStorageTables(subscriptionId: string, resourceGroup: string, accountName: string): Promise<AzureStorageTableSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Storage/storageAccounts/${enc(accountName)}/tableServices/default/tables`,
    '2024-01-01'
  )
  return raw.map((t) => ({
    name: String(t.name ?? '')
  }))
}
