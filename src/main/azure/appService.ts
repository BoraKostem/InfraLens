/**
 * Azure App Service — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractResourceName } from './shared'
import type {
  AzureAppServicePlanSummary,
  AzureWebAppSummary,
  AzureWebAppSlotSummary,
  AzureWebAppDeploymentSummary,
  AzureFunctionAppSummary,
  AzureFunctionSummary,
  AzureWebAppConfigSummary,
  AzureWebAppAction,
  AzureWebAppActionResult
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureAppServicePlans(subscriptionId: string, location: string): Promise<AzureAppServicePlanSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Web/serverfarms`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-12-01')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map((r): AzureAppServicePlanSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const sku = (r.sku ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      resourceGroup: extractResourceGroup(String(r.id ?? '')),
      location: String(r.location ?? ''),
      skuName: String(sku.name ?? ''),
      skuTier: String(sku.tier ?? ''),
      skuCapacity: Number(sku.capacity ?? 0),
      kind: String(r.kind ?? ''),
      numberOfWorkers: Number(props.numberOfWorkers ?? 0),
      numberOfSites: Number(props.numberOfSites ?? 0),
      status: String(props.status ?? 'Unknown'),
      reserved: Boolean(props.reserved),
      zoneRedundant: Boolean(props.zoneRedundant),
      provisioningState: String(props.provisioningState ?? 'Unknown'),
      tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
    }
  })
}

export async function listAzureWebApps(subscriptionId: string, location: string): Promise<AzureWebAppSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Web/sites`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-12-01')
  const locationFilter = location.trim().toLowerCase()
  const filtered = locationFilter
    ? raw.filter((item) => String(item.location ?? '').toLowerCase() === locationFilter)
    : raw
  return filtered.map((r): AzureWebAppSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const siteConfig = (props.siteConfig ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      resourceGroup: extractResourceGroup(String(r.id ?? '')),
      location: String(r.location ?? ''),
      kind: String(r.kind ?? ''),
      state: String(props.state ?? 'Unknown'),
      defaultHostName: String(props.defaultHostName ?? ''),
      httpsOnly: Boolean(props.httpsOnly),
      enabled: Boolean(props.enabled),
      appServicePlanName: extractResourceName(String(props.serverFarmId ?? '')),
      runtimeStack: String(siteConfig.linuxFxVersion ?? siteConfig.windowsFxVersion ?? siteConfig.netFrameworkVersion ?? ''),
      ftpsState: String(siteConfig.ftpsState ?? ''),
      http20Enabled: Boolean(siteConfig.http20Enabled),
      minTlsVersion: String(siteConfig.minTlsVersion ?? ''),
      publicNetworkAccess: String(props.publicNetworkAccess ?? 'Enabled'),
      provisioningState: String(props.provisioningState ?? 'Unknown'),
      lastModifiedTimeUtc: String(props.lastModifiedTimeUtc ?? ''),
      tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
    }
  })
}

export async function describeAzureWebApp(subscriptionId: string, resourceGroup: string, siteName: string): Promise<AzureWebAppSummary> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Web/sites/${encodeURIComponent(siteName)}`
  const r = await fetchAzureArmJson<Record<string, unknown>>(path, '2023-12-01')
  const props = (r.properties ?? {}) as Record<string, unknown>
  const siteConfig = (props.siteConfig ?? {}) as Record<string, unknown>
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    resourceGroup: extractResourceGroup(String(r.id ?? '')),
    location: String(r.location ?? ''),
    kind: String(r.kind ?? ''),
    state: String(props.state ?? 'Unknown'),
    defaultHostName: String(props.defaultHostName ?? ''),
    httpsOnly: Boolean(props.httpsOnly),
    enabled: Boolean(props.enabled),
    appServicePlanName: extractResourceName(String(props.serverFarmId ?? '')),
    runtimeStack: String(siteConfig.linuxFxVersion ?? siteConfig.windowsFxVersion ?? siteConfig.netFrameworkVersion ?? ''),
    ftpsState: String(siteConfig.ftpsState ?? ''),
    http20Enabled: Boolean(siteConfig.http20Enabled),
    minTlsVersion: String(siteConfig.minTlsVersion ?? ''),
    publicNetworkAccess: String(props.publicNetworkAccess ?? 'Enabled'),
    provisioningState: String(props.provisioningState ?? 'Unknown'),
    lastModifiedTimeUtc: String(props.lastModifiedTimeUtc ?? ''),
    tagCount: Object.keys((r.tags ?? {}) as Record<string, unknown>).length
  }
}

export async function listAzureWebAppSlots(subscriptionId: string, resourceGroup: string, siteName: string): Promise<AzureWebAppSlotSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Web/sites/${encodeURIComponent(siteName)}/slots`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-12-01')
  return raw.map((r): AzureWebAppSlotSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const fullName = String(r.name ?? '')
    const slotName = fullName.includes('/') ? fullName.split('/').pop()! : fullName
    return {
      id: String(r.id ?? ''),
      name: fullName,
      slotName,
      state: String(props.state ?? 'Unknown'),
      hostName: String(props.defaultHostName ?? ''),
      enabled: Boolean(props.enabled),
      httpsOnly: Boolean(props.httpsOnly),
      lastModifiedTimeUtc: String(props.lastModifiedTimeUtc ?? '')
    }
  })
}

export async function listAzureWebAppDeployments(subscriptionId: string, resourceGroup: string, siteName: string): Promise<AzureWebAppDeploymentSummary[]> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Web/sites/${encodeURIComponent(siteName)}/deployments`
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(path, '2023-12-01')
  return raw.map((r): AzureWebAppDeploymentSummary => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    return {
      id: String(r.id ?? ''),
      deploymentId: String(r.name ?? ''),
      status: Number(props.status ?? 0),
      message: String(props.message ?? ''),
      author: String(props.author ?? ''),
      deployer: String(props.deployer ?? ''),
      startTime: String(props.start_time ?? props.startTime ?? ''),
      endTime: String(props.end_time ?? props.endTime ?? ''),
      active: Boolean(props.active)
    }
  })
}

export async function listAzureFunctionApps(subscriptionId: string, location: string): Promise<AzureFunctionAppSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Web/sites`,
    '2023-12-01'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return raw
    .filter((s) => {
      const kind = String(s.kind ?? '').toLowerCase()
      if (!kind.includes('functionapp')) return false
      if (loc && String(s.location ?? '').toLowerCase().replace(/\s/g, '') !== loc) return false
      return true
    })
    .map((s) => {
      const props = (s.properties ?? {}) as Record<string, unknown>
      const siteConfig = (props.siteConfig ?? {}) as Record<string, unknown>
      return {
        id: String(s.id ?? ''),
        name: String(s.name ?? ''),
        resourceGroup: extractResourceGroup(String(s.id ?? '')),
        location: String(s.location ?? ''),
        kind: String(s.kind ?? ''),
        state: String(props.state ?? ''),
        defaultHostName: String(props.defaultHostName ?? ''),
        httpsOnly: Boolean(props.httpsOnly),
        enabled: Boolean(props.enabled),
        appServicePlanName: extractResourceName(String(props.serverFarmId ?? '')),
        runtimeStack: String(siteConfig.linuxFxVersion ?? siteConfig.windowsFxVersion ?? ''),
        publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
        provisioningState: String(props.provisioningState ?? ''),
        lastModifiedTimeUtc: String(props.lastModifiedTimeUtc ?? ''),
        tagCount: Object.keys((s.tags as Record<string, string>) ?? {}).length
      }
    })
}

export async function listAzureFunctions(subscriptionId: string, resourceGroup: string, siteName: string): Promise<AzureFunctionSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Web/sites/${enc(siteName)}/functions`,
    '2023-12-01'
  )
  return raw.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>
    const config = (props.config ?? {}) as Record<string, unknown>
    const bindings = Array.isArray(props.config_bindings) ? props.config_bindings : (Array.isArray(config.bindings) ? config.bindings as unknown[] : [])
    return {
      name: String(f.name ?? props.name ?? ''),
      scriptHref: String(props.script_href ?? ''),
      configHref: String(props.config_href ?? ''),
      isDisabled: Boolean(props.isDisabled),
      language: String(props.language ?? ''),
      bindingCount: Array.isArray(bindings) ? bindings.length : 0
    }
  })
}

export async function getAzureWebAppConfiguration(subscriptionId: string, resourceGroup: string, siteName: string): Promise<AzureWebAppConfigSummary> {
  const [configRaw, settingsRaw, connStrRaw] = await Promise.all([
    fetchAzureArmJson<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Web/sites/${enc(siteName)}/config/web`,
      '2023-12-01'
    ),
    fetchAzureArmJson<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Web/sites/${enc(siteName)}/config/appsettings/list`,
      '2023-12-01',
      { method: 'POST' }
    ),
    fetchAzureArmJson<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Web/sites/${enc(siteName)}/config/connectionstrings/list`,
      '2023-12-01',
      { method: 'POST' }
    )
  ])
  const cp = (configRaw.properties ?? {}) as Record<string, unknown>
  const settingsProps = (settingsRaw.properties ?? {}) as Record<string, string>
  const connProps = (connStrRaw.properties ?? {}) as Record<string, Record<string, unknown>>

  return {
    appSettings: Object.entries(settingsProps).map(([name, value]) => ({ name, value: String(value ?? ''), slotSetting: false })),
    connectionStrings: Object.entries(connProps).map(([name, entry]) => ({ name, type: String(entry.type ?? ''), slotSetting: false })),
    linuxFxVersion: String(cp.linuxFxVersion ?? ''),
    netFrameworkVersion: String(cp.netFrameworkVersion ?? ''),
    phpVersion: String(cp.phpVersion ?? ''),
    pythonVersion: String(cp.pythonVersion ?? ''),
    nodeVersion: String(cp.nodeVersion ?? ''),
    javaVersion: String(cp.javaVersion ?? ''),
    http20Enabled: Boolean(cp.http20Enabled),
    minTlsVersion: String(cp.minTlsVersion ?? ''),
    ftpsState: String(cp.ftpsState ?? ''),
    alwaysOn: Boolean(cp.alwaysOn)
  }
}

export async function runAzureWebAppAction(subscriptionId: string, resourceGroup: string, siteName: string, action: AzureWebAppAction): Promise<AzureWebAppActionResult> {
  try {
    await fetchAzureArmJson<unknown>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Web/sites/${enc(siteName)}/${action}`,
      '2023-12-01',
      { method: 'POST' }
    )
    return { action, siteName, resourceGroup, accepted: true }
  } catch (err) {
    return { action, siteName, resourceGroup, accepted: false, error: String(err) }
  }
}
