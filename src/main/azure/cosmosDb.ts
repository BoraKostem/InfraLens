/**
 * Azure Cosmos DB — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import { logWarn } from '../observability'
import type {
  AzureCosmosDbEstateOverview,
  AzureCosmosDbAccountSummary,
  AzureCosmosDbDatabaseSummary,
  AzureCosmosDbContainerSummary,
  AzureCosmosDbAccountDetail
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureCosmosDbEstate(subscriptionId: string, location: string): Promise<AzureCosmosDbEstateOverview> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.DocumentDB/databaseAccounts`,
    '2024-05-15'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')

  const accounts: AzureCosmosDbAccountSummary[] = raw
    .filter((a) => !loc || String(a.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((a) => {
      const props = (a.properties ?? {}) as Record<string, unknown>
      const consistency = (props.consistencyPolicy as Record<string, unknown>) ?? {}
      const readLocs = Array.isArray(props.readLocations) ? (props.readLocations as Record<string, unknown>[]).map((l) => String(l.locationName ?? '')) : []
      const writeLocs = Array.isArray(props.writeLocations) ? (props.writeLocations as Record<string, unknown>[]).map((l) => String(l.locationName ?? '')) : []
      return {
        id: String(a.id ?? ''),
        name: String(a.name ?? ''),
        resourceGroup: extractResourceGroup(String(a.id ?? '')),
        location: String(a.location ?? ''),
        kind: String(a.kind ?? 'GlobalDocumentDB'),
        databaseAccountOfferType: String(props.databaseAccountOfferType ?? ''),
        consistencyLevel: String(consistency.defaultConsistencyLevel ?? ''),
        enableAutomaticFailover: Boolean(props.enableAutomaticFailover),
        enableMultipleWriteLocations: Boolean(props.enableMultipleWriteLocations),
        publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
        isVirtualNetworkFilterEnabled: Boolean(props.isVirtualNetworkFilterEnabled),
        readLocations: readLocs,
        writeLocations: writeLocs,
        provisioningState: String(props.provisioningState ?? ''),
        documentEndpoint: String(props.documentEndpoint ?? ''),
        tagCount: Object.keys((a.tags as Record<string, string>) ?? {}).length
      }
    })

  const notes: string[] = []
  const publicCount = accounts.filter((a) => a.publicNetworkAccess.toLowerCase() !== 'disabled').length
  if (publicCount > 0) notes.push(`${publicCount} account(s) with public network access`)

  return {
    subscriptionId,
    accountCount: accounts.length,
    databaseCount: 0,
    containerCount: 0,
    accounts,
    notes
  }
}

export async function describeAzureCosmosDbAccount(subscriptionId: string, resourceGroup: string, accountName: string): Promise<AzureCosmosDbAccountDetail> {
  const raw = await fetchAzureArmJson<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DocumentDB/databaseAccounts/${enc(accountName)}`,
    '2024-05-15'
  )
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const consistency = (props.consistencyPolicy as Record<string, unknown>) ?? {}
  const readLocs = Array.isArray(props.readLocations) ? (props.readLocations as Record<string, unknown>[]).map((l) => String(l.locationName ?? '')) : []
  const writeLocs = Array.isArray(props.writeLocations) ? (props.writeLocations as Record<string, unknown>[]).map((l) => String(l.locationName ?? '')) : []

  const account: AzureCosmosDbAccountSummary = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    resourceGroup,
    location: String(raw.location ?? ''),
    kind: String(raw.kind ?? 'GlobalDocumentDB'),
    databaseAccountOfferType: String(props.databaseAccountOfferType ?? ''),
    consistencyLevel: String(consistency.defaultConsistencyLevel ?? ''),
    enableAutomaticFailover: Boolean(props.enableAutomaticFailover),
    enableMultipleWriteLocations: Boolean(props.enableMultipleWriteLocations),
    publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
    isVirtualNetworkFilterEnabled: Boolean(props.isVirtualNetworkFilterEnabled),
    readLocations: readLocs,
    writeLocations: writeLocs,
    provisioningState: String(props.provisioningState ?? ''),
    documentEndpoint: String(props.documentEndpoint ?? ''),
    tagCount: Object.keys((raw.tags as Record<string, string>) ?? {}).length
  }

  let databases: AzureCosmosDbDatabaseSummary[] = []
  let containers: AzureCosmosDbContainerSummary[] = []
  const isMongo = account.kind.toLowerCase().includes('mongo')
  const dbType = isMongo ? 'mongodbDatabases' : 'sqlDatabases'
  const containerType = isMongo ? 'mongodbCollections' : 'containers'

  try {
    const rawDbs = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DocumentDB/databaseAccounts/${enc(accountName)}/${dbType}`,
      '2024-05-15'
    )
    databases = rawDbs.map((db) => ({
      id: String(db.id ?? ''),
      name: String(db.name ?? ''),
      accountName,
      resourceGroup
    }))

    for (const db of databases.slice(0, 10)) {
      try {
        const rawContainers = await fetchAzureArmCollection<Record<string, unknown>>(
          `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DocumentDB/databaseAccounts/${enc(accountName)}/${dbType}/${enc(db.name)}/${containerType}`,
          '2024-05-15'
        )
        for (const c of rawContainers) {
          const cp = (c.properties ?? {}) as Record<string, unknown>
          const resource = (cp.resource ?? cp) as Record<string, unknown>
          const pk = (resource.partitionKey ?? {}) as Record<string, unknown>
          const paths = Array.isArray(pk.paths) ? pk.paths : []
          const indexing = (resource.indexingPolicy ?? {}) as Record<string, unknown>
          containers.push({
            id: String(c.id ?? ''),
            name: String(c.name ?? resource.id ?? ''),
            databaseName: db.name,
            partitionKeyPath: paths.length > 0 ? String(paths[0]) : '',
            defaultTtl: Number(resource.defaultTtl ?? -1),
            indexingMode: String(indexing.indexingMode ?? 'consistent'),
            analyticalStorageTtl: Number(resource.analyticalStorageTtl ?? -1)
          })
        }
      } catch (err) { logWarn('azureSdk.describeAzureCosmosDbAccount', `Failed to list Cosmos containers for ${db.name}.`, { accountName, databaseName: db.name }, err) }
    }
  } catch (err) { logWarn('azureSdk.describeAzureCosmosDbAccount', `Failed to list Cosmos databases for ${accountName}.`, { accountName }, err) }

  return { account, databases, containers }
}
