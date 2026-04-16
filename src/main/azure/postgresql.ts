/**
 * Azure PostgreSQL Flexible Servers — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractResourceName, normalizeRegion } from './shared'
import { logInfo } from '../observability'
import type {
  AzurePostgreSqlEstateOverview,
  AzurePostgreSqlServerSummary,
  AzurePostgreSqlDatabaseSummary,
  AzurePostgreSqlServerDetail,
  AzurePostgreSqlFirewallRule,
  AzurePostgreSqlPostureBadge,
  AzurePostgreSqlFinding,
  AzurePostgreSqlSummaryTile
} from '@shared/types'

export async function listAzurePostgreSqlEstate(subscriptionId: string, location: string): Promise<AzurePostgreSqlEstateOverview> {
  const servers = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    sku?: { name?: string; tier?: string }
    properties?: {
      version?: string
      fullyQualifiedDomainName?: string
      network?: { publicNetworkAccess?: string }
      state?: string
      storage?: { storageSizeGB?: number }
      highAvailability?: { mode?: string; state?: string }
      backup?: { backupRetentionDays?: number; geoRedundantBackup?: string }
      availabilityZone?: string
    }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.DBforPostgreSQL/flexibleServers`, '2022-12-01')

  logInfo('azureSdk.listAzurePostgreSqlEstate', `ARM returned ${servers.length} server(s) before region filter.`, {
    subscriptionId,
    location,
    serverLocations: servers.map((s) => s.location ?? '(null)').join(', ') || '(none)'
  })

  const filteredServers = normalizeRegion(
    servers.map((server) => ({
      id: server.id?.trim() || '',
      name: server.name?.trim() || extractResourceName(server.id ?? ''),
      resourceGroup: extractResourceGroup(server.id ?? ''),
      location: server.location?.trim() || '',
      version: server.properties?.version?.trim() || '',
      fullyQualifiedDomainName: server.properties?.fullyQualifiedDomainName?.trim() || '',
      publicNetworkAccess: server.properties?.network?.publicNetworkAccess?.trim() || 'Disabled',
      state: server.properties?.state?.trim() || '',
      skuName: server.sku?.name?.trim() || '',
      skuTier: server.sku?.tier?.trim() || '',
      storageSizeGb: server.properties?.storage?.storageSizeGB ?? 0,
      haEnabled: (server.properties?.highAvailability?.mode ?? '').toLowerCase() !== 'disabled' && (server.properties?.highAvailability?.mode ?? '') !== '',
      haState: server.properties?.highAvailability?.state?.trim() || '',
      backupRetentionDays: server.properties?.backup?.backupRetentionDays ?? 7,
      geoRedundantBackup: (server.properties?.backup?.geoRedundantBackup ?? '').toLowerCase() === 'enabled',
      availabilityZone: server.properties?.availabilityZone?.trim() || '',
      databaseCount: 0,
      tagCount: Object.keys(server.tags ?? {}).length,
      notes: [] as string[]
    })),
    location
  )

  const serverDetails = await Promise.all(filteredServers.map(async (server) => {
    const databases = await fetchAzureArmCollection<{
      id?: string
      name?: string
      properties?: { charset?: string; collation?: string }
    }>(`/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(server.resourceGroup)}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${encodeURIComponent(server.name)}/databases`, '2022-12-01')

    const mappedDatabases = databases
      .filter((db) => !['azure_maintenance', 'azure_sys'].includes(db.name?.trim().toLowerCase() ?? ''))
      .map((db) => ({
        id: db.id?.trim() || '',
        name: db.name?.trim() || '',
        serverName: server.name,
        resourceGroup: server.resourceGroup,
        charset: db.properties?.charset?.trim() || '',
        collation: db.properties?.collation?.trim() || ''
      } satisfies AzurePostgreSqlDatabaseSummary))

    return {
      server: { ...server, databaseCount: mappedDatabases.length },
      databases: mappedDatabases
    }
  }))

  const mappedServers = serverDetails.map((e) => e.server).sort((a, b) => a.name.localeCompare(b.name))
  const mappedDatabases = serverDetails.flatMap((e) => e.databases).sort((a, b) => a.name.localeCompare(b.name))

  return {
    subscriptionId,
    serverCount: mappedServers.length,
    databaseCount: mappedDatabases.length,
    publicServerCount: mappedServers.filter((s) => s.publicNetworkAccess.toLowerCase() === 'enabled').length,
    servers: mappedServers,
    databases: mappedDatabases,
    notes: mappedServers.length === 0
      ? [
          'No PostgreSQL Flexible Servers were visible for the selected subscription and region.',
          'If servers exist in the Azure Portal, verify that the Microsoft.DBforPostgreSQL resource provider is registered on this subscription and that your identity has Reader access to Flexible Server resources.'
        ]
      : []
  }
}

export async function describeAzurePostgreSqlServer(subscriptionId: string, resourceGroup: string, serverName: string): Promise<AzurePostgreSqlServerDetail> {
  const basePath = `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${encodeURIComponent(serverName)}`

  const [serverRaw, databases, firewallRulesRaw] = await Promise.all([
    fetchAzureArmJson<{
      id?: string
      name?: string
      location?: string
      tags?: Record<string, string>
      sku?: { name?: string; tier?: string }
      properties?: {
        version?: string
        fullyQualifiedDomainName?: string
        network?: { publicNetworkAccess?: string }
        state?: string
        storage?: { storageSizeGB?: number }
        highAvailability?: { mode?: string; state?: string }
        backup?: { backupRetentionDays?: number; geoRedundantBackup?: string }
        availabilityZone?: string
        administratorLogin?: string
        authConfig?: { activeDirectoryAuth?: string; passwordAuth?: string }
        minorVersion?: string
      }
    }>(basePath, '2022-12-01'),
    fetchAzureArmCollection<{
      id?: string
      name?: string
      properties?: { charset?: string; collation?: string }
    }>(`${basePath}/databases`, '2022-12-01'),
    fetchAzureArmCollection<{
      id?: string
      name?: string
      properties?: { startIpAddress?: string; endIpAddress?: string }
    }>(`${basePath}/firewallRules`, '2022-12-01')
  ])

  const server: AzurePostgreSqlServerSummary = {
    id: serverRaw.id?.trim() || '',
    name: serverRaw.name?.trim() || serverName,
    resourceGroup,
    location: serverRaw.location?.trim() || '',
    version: serverRaw.properties?.version?.trim() || '',
    fullyQualifiedDomainName: serverRaw.properties?.fullyQualifiedDomainName?.trim() || '',
    publicNetworkAccess: serverRaw.properties?.network?.publicNetworkAccess?.trim() || 'Disabled',
    state: serverRaw.properties?.state?.trim() || '',
    skuName: serverRaw.sku?.name?.trim() || '',
    skuTier: serverRaw.sku?.tier?.trim() || '',
    storageSizeGb: serverRaw.properties?.storage?.storageSizeGB ?? 0,
    haEnabled: (serverRaw.properties?.highAvailability?.mode ?? '').toLowerCase() !== 'disabled' && (serverRaw.properties?.highAvailability?.mode ?? '') !== '',
    haState: serverRaw.properties?.highAvailability?.state?.trim() || '',
    backupRetentionDays: serverRaw.properties?.backup?.backupRetentionDays ?? 7,
    geoRedundantBackup: (serverRaw.properties?.backup?.geoRedundantBackup ?? '').toLowerCase() === 'enabled',
    availabilityZone: serverRaw.properties?.availabilityZone?.trim() || '',
    databaseCount: 0,
    tagCount: Object.keys(serverRaw.tags ?? {}).length,
    notes: []
  }

  const mappedDatabases: AzurePostgreSqlDatabaseSummary[] = databases
    .filter((db) => !['azure_maintenance', 'azure_sys'].includes(db.name?.trim().toLowerCase() ?? ''))
    .map((db) => ({
      id: db.id?.trim() || '',
      name: db.name?.trim() || '',
      serverName: server.name,
      resourceGroup,
      charset: db.properties?.charset?.trim() || '',
      collation: db.properties?.collation?.trim() || ''
    } satisfies AzurePostgreSqlDatabaseSummary))

  server.databaseCount = mappedDatabases.length

  const firewallRules: AzurePostgreSqlFirewallRule[] = firewallRulesRaw.map((rule) => ({
    name: rule.name?.trim() || '',
    startIpAddress: rule.properties?.startIpAddress?.trim() || '',
    endIpAddress: rule.properties?.endIpAddress?.trim() || ''
  }))

  const isPublic = server.publicNetworkAccess.toLowerCase() === 'enabled'
  const hasAadAuth = (serverRaw.properties?.authConfig?.activeDirectoryAuth ?? '').toLowerCase() === 'enabled'
  const hasPasswordAuth = (serverRaw.properties?.authConfig?.passwordAuth ?? '').toLowerCase() !== 'disabled'
  const hasAllowAllRule = firewallRules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '255.255.255.255')
  const hasAllowAzureRule = firewallRules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '0.0.0.0')
  const isReady = server.state.toLowerCase() === 'ready'

  const badges: AzurePostgreSqlPostureBadge[] = [
    { id: 'public-access', label: 'Public Access', value: isPublic ? 'Enabled' : 'Disabled', tone: isPublic ? 'risk' : 'good' },
    { id: 'ha', label: 'High Availability', value: server.haEnabled ? `${serverRaw.properties?.highAvailability?.mode ?? 'Enabled'}` : 'Disabled', tone: server.haEnabled ? 'good' : 'info' },
    { id: 'aad-auth', label: 'AAD Auth', value: hasAadAuth ? 'Enabled' : 'Disabled', tone: hasAadAuth ? 'good' : 'warning' },
    { id: 'geo-backup', label: 'Geo Backup', value: server.geoRedundantBackup ? 'Enabled' : 'Disabled', tone: server.geoRedundantBackup ? 'good' : 'info' },
    { id: 'firewall', label: 'Firewall Rules', value: `${firewallRules.length} rules`, tone: hasAllowAllRule ? 'risk' : firewallRules.length === 0 ? 'good' : 'info' }
  ]

  const findings: AzurePostgreSqlFinding[] = []
  const recommendations: string[] = []

  if (isPublic) {
    findings.push({ id: 'public-access', severity: 'risk', title: 'Public network access enabled', message: 'This PostgreSQL server accepts connections from public IP addresses.', recommendation: 'Disable public network access and use private endpoints or VNet integration for production workloads.' })
    recommendations.push('Disable public network access and use private endpoints or VNet integration.')
  }

  if (!hasAadAuth) {
    findings.push({ id: 'no-aad', severity: 'warning', title: 'Azure AD authentication not enabled', message: 'The server relies on password-only authentication without AAD integration.', recommendation: 'Enable Azure AD authentication for centralized identity management.' })
    recommendations.push('Enable Azure AD authentication for centralized identity management.')
  }

  if (!server.haEnabled) {
    findings.push({ id: 'no-ha', severity: 'info', title: 'High availability not configured', message: 'The server has no high-availability standby replica.', recommendation: 'Enable zone-redundant or same-zone HA for production workloads.' })
    recommendations.push('Enable high availability for production workloads.')
  }

  if (!server.geoRedundantBackup) {
    findings.push({ id: 'no-geo-backup', severity: 'info', title: 'Geo-redundant backup disabled', message: 'Backups are stored in a single region only.', recommendation: 'Enable geo-redundant backup for disaster recovery scenarios.' })
    recommendations.push('Enable geo-redundant backup for disaster recovery.')
  }

  if (hasAllowAllRule) {
    findings.push({ id: 'allow-all-firewall', severity: 'risk', title: 'Firewall allows all IP addresses', message: 'A firewall rule permits connections from the entire internet (0.0.0.0 - 255.255.255.255).', recommendation: 'Remove the allow-all firewall rule and restrict to specific IP ranges.' })
    recommendations.push('Remove the allow-all firewall rule and restrict to specific IP ranges.')
  }

  if (hasAllowAzureRule) {
    findings.push({ id: 'allow-azure-services', severity: 'info', title: 'Azure services access allowed', message: 'A special rule allows all Azure services to connect to this server.', recommendation: 'Review whether all Azure services need access or if VNet integration is preferred.' })
    recommendations.push('Review whether all Azure services need access or if VNet integration is preferred.')
  }

  if (server.backupRetentionDays < 14) {
    findings.push({ id: 'short-retention', severity: 'warning', title: `Backup retention is ${server.backupRetentionDays} days`, message: 'Short backup retention reduces your recovery window.', recommendation: 'Increase backup retention to at least 14 days for production workloads.' })
    recommendations.push('Increase backup retention to at least 14 days.')
  }

  if (recommendations.length === 0) {
    recommendations.push('No immediate operational posture warnings detected. Continue reviewing network and access settings during routine checks.')
  }

  const summaryTiles: AzurePostgreSqlSummaryTile[] = [
    { id: 'findings', label: 'Findings', value: String(findings.length), tone: findings.some((f) => f.severity === 'risk') ? 'risk' : findings.length ? 'warning' : 'good' },
    { id: 'state', label: 'State', value: server.state || 'Unknown', tone: isReady ? 'good' : 'warning' },
    { id: 'databases', label: 'Databases', value: String(mappedDatabases.length), tone: 'info' },
    { id: 'firewall', label: 'Firewall', value: `${firewallRules.length} rules`, tone: hasAllowAllRule ? 'risk' : 'info' }
  ]

  if (isPublic) server.notes.push('Public network access is enabled for this PostgreSQL server.')

  return {
    server,
    databases: mappedDatabases,
    firewallRules,
    badges,
    summaryTiles,
    findings,
    recommendations,
    connectionDetails: [
      { label: 'FQDN', value: server.fullyQualifiedDomainName || 'N/A' },
      { label: 'Server name', value: server.name },
      { label: 'Resource group', value: server.resourceGroup },
      { label: 'PG version', value: server.version || 'N/A' },
      { label: 'Minor version', value: serverRaw.properties?.minorVersion?.trim() || 'N/A' },
      { label: 'SKU', value: `${server.skuName} (${server.skuTier})` },
      { label: 'Storage', value: server.storageSizeGb ? `${server.storageSizeGb} GB` : 'N/A' },
      { label: 'Port', value: '5432' },
      { label: 'Admin login', value: serverRaw.properties?.administratorLogin?.trim() || 'N/A' },
      { label: 'Auth', value: [hasPasswordAuth ? 'Password' : '', hasAadAuth ? 'AAD' : ''].filter(Boolean).join(' + ') || 'Password' },
      { label: 'Availability zone', value: server.availabilityZone || 'N/A' },
      { label: 'Backup retention', value: `${server.backupRetentionDays} days` },
      { label: 'Tags', value: String(server.tagCount) }
    ]
  }
}
