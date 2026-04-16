/**
 * Azure Key Vault — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureKeyVaultSummary,
  AzureKeyVaultSecretSummary,
  AzureKeyVaultKeySummary
} from '@shared/types'

export async function listAzureKeyVaults(subscriptionId: string, location: string): Promise<AzureKeyVaultSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.KeyVault/vaults`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-07-01')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map((r): AzureKeyVaultSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      resourceGroup: extractResourceGroup(String(r.id ?? '')),
      location: String(r.location ?? ''),
      vaultUri: String(props.vaultUri ?? ''),
      skuName: String(((props.sku ?? {}) as Record<string, unknown>).name ?? ''),
      tenantId: String(props.tenantId ?? ''),
      enableSoftDelete: Boolean(props.enableSoftDelete),
      softDeleteRetentionInDays: Number(props.softDeleteRetentionInDays ?? 90),
      enablePurgeProtection: Boolean(props.enablePurgeProtection),
      enableRbacAuthorization: Boolean(props.enableRbacAuthorization),
      publicNetworkAccess: String(props.publicNetworkAccess ?? 'Enabled'),
      provisioningState: String(props.provisioningState ?? 'Unknown'),
      tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
    }
  })
}

export async function describeAzureKeyVault(subscriptionId: string, resourceGroup: string, vaultName: string): Promise<AzureKeyVaultSummary> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.KeyVault/vaults/${encodeURIComponent(vaultName)}`
  const r = await fetchAzureArmJson<Record<string, unknown>>(path, '2023-07-01')
  const props = (r.properties ?? {}) as Record<string, unknown>
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    resourceGroup: extractResourceGroup(String(r.id ?? '')),
    location: String(r.location ?? ''),
    vaultUri: String(props.vaultUri ?? ''),
    skuName: String(((props.sku ?? {}) as Record<string, unknown>).name ?? ''),
    tenantId: String(props.tenantId ?? ''),
    enableSoftDelete: Boolean(props.enableSoftDelete),
    softDeleteRetentionInDays: Number(props.softDeleteRetentionInDays ?? 90),
    enablePurgeProtection: Boolean(props.enablePurgeProtection),
    enableRbacAuthorization: Boolean(props.enableRbacAuthorization),
    publicNetworkAccess: String(props.publicNetworkAccess ?? 'Enabled'),
    provisioningState: String(props.provisioningState ?? 'Unknown'),
    tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
  }
}

export async function listAzureKeyVaultSecrets(subscriptionId: string, resourceGroup: string, vaultName: string): Promise<AzureKeyVaultSecretSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.KeyVault/vaults/${encodeURIComponent(vaultName)}/secrets`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-07-01')
  return raw.map((r): AzureKeyVaultSecretSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const attrs = (props.attributes ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      enabled: Boolean(attrs.enabled),
      contentType: String(props.contentType ?? ''),
      managed: Boolean(attrs.managed),
      created: String(attrs.created ?? ''),
      updated: String(attrs.updated ?? '')
    }
  })
}

export async function listAzureKeyVaultKeys(subscriptionId: string, resourceGroup: string, vaultName: string): Promise<AzureKeyVaultKeySummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.KeyVault/vaults/${encodeURIComponent(vaultName)}/keys`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-07-01')
  return raw.map((r): AzureKeyVaultKeySummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const attrs = (props.attributes ?? {}) as Record<string, unknown>
    const kty = (props.kty ?? '') as string
    const keyOps = Array.isArray(props.keyOps) ? (props.keyOps as string[]) : []
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      enabled: Boolean(attrs.enabled),
      keyType: kty,
      keyOps,
      created: String(attrs.created ?? ''),
      updated: String(attrs.updated ?? '')
    }
  })
}
