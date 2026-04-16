/**
 * Azure MySQL Flexible Servers — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import { logWarn } from '../observability'
import type {
  AzureMySqlEstateOverview,
  AzureMySqlServerSummary,
  AzureMySqlDatabaseSummary,
  AzureMySqlServerDetail,
  AzureMySqlFirewallRule,
  AzureMySqlPostureBadge,
  AzureMySqlSummaryTile,
  AzureMySqlFinding
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureMySqlEstate(subscriptionId: string, location: string): Promise<AzureMySqlEstateOverview> {
  const rawServers = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.DBforMySQL/flexibleServers`,
    '2023-12-30'
  )
  const loc = location.trim().toLowerCase().replace(/\s/g, '')

  const servers: AzureMySqlServerSummary[] = rawServers
    .filter((s) => !loc || String(s.location ?? '').toLowerCase().replace(/\s/g, '') === loc)
    .map((s) => {
      const props = (s.properties ?? {}) as Record<string, unknown>
      const sku = (s.sku ?? {}) as Record<string, unknown>
      const storage = (props.storage ?? {}) as Record<string, unknown>
      const ha = (props.highAvailability ?? {}) as Record<string, unknown>
      const backup = (props.backup ?? {}) as Record<string, unknown>
      const notes: string[] = []
      if (String(props.publicNetworkAccess ?? '').toLowerCase() === 'enabled') notes.push('Public network access enabled')
      return {
        id: String(s.id ?? ''),
        name: String(s.name ?? ''),
        resourceGroup: extractResourceGroup(String(s.id ?? '')),
        location: String(s.location ?? ''),
        version: String(props.version ?? ''),
        fullyQualifiedDomainName: String(props.fullyQualifiedDomainName ?? ''),
        publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
        state: String(props.state ?? ''),
        skuName: String(sku.name ?? ''),
        skuTier: String(sku.tier ?? ''),
        storageSizeGb: Number(storage.storageSizeGB ?? 0),
        haEnabled: String(ha.mode ?? '').toLowerCase() !== 'disabled',
        haState: String(ha.state ?? ''),
        backupRetentionDays: Number(backup.backupRetentionDays ?? 7),
        geoRedundantBackup: String(backup.geoRedundantBackup ?? ''),
        availabilityZone: String(props.availabilityZone ?? ''),
        databaseCount: 0,
        tagCount: Object.keys((s.tags as Record<string, string>) ?? {}).length,
        notes
      }
    })

  const databases: AzureMySqlDatabaseSummary[] = []
  for (const server of servers.slice(0, 20)) {
    try {
      const rawDbs = await fetchAzureArmCollection<Record<string, unknown>>(
        `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(server.resourceGroup)}/providers/Microsoft.DBforMySQL/flexibleServers/${enc(server.name)}/databases`,
        '2023-12-30'
      )
      for (const db of rawDbs) {
        const props = (db.properties ?? {}) as Record<string, unknown>
        databases.push({
          id: String(db.id ?? ''),
          name: String(db.name ?? ''),
          serverName: server.name,
          resourceGroup: server.resourceGroup,
          charset: String(props.charset ?? ''),
          collation: String(props.collation ?? '')
        })
      }
      server.databaseCount = rawDbs.length
    } catch (err) {
      logWarn('azureSdk.listAzureMySqlEstate', `Failed to list MySQL databases for ${server.name}.`, { serverName: server.name }, err)
    }
  }

  const publicServerCount = servers.filter((s) => s.publicNetworkAccess.toLowerCase() === 'enabled').length
  const notes: string[] = []
  if (publicServerCount > 0) notes.push(`${publicServerCount} server(s) with public network access enabled`)

  return {
    subscriptionId,
    serverCount: servers.length,
    databaseCount: databases.length,
    publicServerCount,
    servers,
    databases,
    notes
  }
}

export async function describeAzureMySqlServer(subscriptionId: string, resourceGroup: string, serverName: string): Promise<AzureMySqlServerDetail> {
  const raw = await fetchAzureArmJson<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DBforMySQL/flexibleServers/${enc(serverName)}`,
    '2023-12-30'
  )
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const sku = (raw.sku ?? {}) as Record<string, unknown>
  const storage = (props.storage ?? {}) as Record<string, unknown>
  const ha = (props.highAvailability ?? {}) as Record<string, unknown>
  const backup = (props.backup ?? {}) as Record<string, unknown>
  const notes: string[] = []
  if (String(props.publicNetworkAccess ?? '').toLowerCase() === 'enabled') notes.push('Public network access enabled')

  const server: AzureMySqlServerSummary = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    resourceGroup,
    location: String(raw.location ?? ''),
    version: String(props.version ?? ''),
    fullyQualifiedDomainName: String(props.fullyQualifiedDomainName ?? ''),
    publicNetworkAccess: String(props.publicNetworkAccess ?? ''),
    state: String(props.state ?? ''),
    skuName: String(sku.name ?? ''),
    skuTier: String(sku.tier ?? ''),
    storageSizeGb: Number(storage.storageSizeGB ?? 0),
    haEnabled: String(ha.mode ?? '').toLowerCase() !== 'disabled',
    haState: String(ha.state ?? ''),
    backupRetentionDays: Number(backup.backupRetentionDays ?? 7),
    geoRedundantBackup: String(backup.geoRedundantBackup ?? ''),
    availabilityZone: String(props.availabilityZone ?? ''),
    databaseCount: 0,
    tagCount: Object.keys((raw.tags as Record<string, string>) ?? {}).length,
    notes
  }

  let databases: AzureMySqlDatabaseSummary[] = []
  try {
    const rawDbs = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DBforMySQL/flexibleServers/${enc(serverName)}/databases`,
      '2023-12-30'
    )
    databases = rawDbs.map((db) => {
      const dp = (db.properties ?? {}) as Record<string, unknown>
      return {
        id: String(db.id ?? ''),
        name: String(db.name ?? ''),
        serverName,
        resourceGroup,
        charset: String(dp.charset ?? ''),
        collation: String(dp.collation ?? '')
      }
    })
    server.databaseCount = databases.length
  } catch (err) { logWarn('azureSdk.describeAzureMySqlServer', 'Failed to list MySQL databases.', { serverName }, err) }

  let firewallRules: AzureMySqlFirewallRule[] = []
  try {
    const rawFw = await fetchAzureArmCollection<Record<string, unknown>>(
      `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.DBforMySQL/flexibleServers/${enc(serverName)}/firewallRules`,
      '2023-12-30'
    )
    firewallRules = rawFw.map((fw) => {
      const fp = (fw.properties ?? {}) as Record<string, unknown>
      return {
        name: String(fw.name ?? ''),
        startIpAddress: String(fp.startIpAddress ?? ''),
        endIpAddress: String(fp.endIpAddress ?? '')
      }
    })
  } catch (err) { logWarn('azureSdk.describeAzureMySqlServer', 'Failed to list MySQL firewall rules.', { serverName }, err) }

  const badges: AzureMySqlPostureBadge[] = []
  const findings: AzureMySqlFinding[] = []

  const publicAccess = String(props.publicNetworkAccess ?? '').toLowerCase()
  badges.push({ id: 'network', label: 'Network', value: publicAccess === 'enabled' ? 'Public' : 'Private', tone: publicAccess === 'enabled' ? 'warning' : 'good' })
  badges.push({ id: 'ha', label: 'HA', value: server.haEnabled ? 'Enabled' : 'Disabled', tone: server.haEnabled ? 'good' : 'info' })
  badges.push({ id: 'backup', label: 'Backup', value: `${server.backupRetentionDays}d`, tone: server.backupRetentionDays >= 7 ? 'good' : 'warning' })
  badges.push({ id: 'ssl', label: 'SSL', value: String(props.sslEnforcement ?? props.requireSecureTransport ?? 'ON'), tone: 'good' })

  if (publicAccess === 'enabled') {
    findings.push({ id: 'public-access', severity: 'warning', title: 'Public Network Access', message: 'Server allows connections from the public internet.', recommendation: 'Restrict to private endpoints or specific IP ranges.' })
  }
  const anyIp = firewallRules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '255.255.255.255')
  if (anyIp) {
    findings.push({ id: 'any-ip', severity: 'risk', title: 'Open Firewall Rule', message: 'A firewall rule allows all IPv4 addresses.', recommendation: 'Remove overly permissive firewall rules.' })
  }
  if (!server.haEnabled) {
    findings.push({ id: 'no-ha', severity: 'info', title: 'No High Availability', message: 'High availability is not enabled.', recommendation: 'Enable zone-redundant HA for production workloads.' })
  }

  const summaryTiles: AzureMySqlSummaryTile[] = [
    { id: 'databases', label: 'Databases', value: String(databases.length), tone: 'info' },
    { id: 'firewall', label: 'Firewall Rules', value: String(firewallRules.length), tone: firewallRules.length === 0 ? 'warning' : 'info' },
    { id: 'version', label: 'Version', value: server.version, tone: 'neutral' },
    { id: 'sku', label: 'SKU', value: `${server.skuTier} / ${server.skuName}`, tone: 'neutral' }
  ]

  return { server, databases, firewallRules, badges, summaryTiles, findings }
}
