/**
 * Azure SQL Server — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup, extractResourceName, normalizeRegion } from './shared'
import type {
  AzureSqlEstateOverview,
  AzureSqlServerSummary,
  AzureSqlDatabaseSummary,
  AzureSqlServerDetail,
  AzureSqlFirewallRule,
  AzureSqlPostureBadge,
  AzureSqlFinding,
  AzureSqlSummaryTile
} from '@shared/types'

export async function listAzureSqlEstate(subscriptionId: string, location: string): Promise<AzureSqlEstateOverview> {
  const servers = await fetchAzureArmCollection<{
    id?: string
    name?: string
    location?: string
    tags?: Record<string, string>
    properties?: {
      version?: string
      fullyQualifiedDomainName?: string
      publicNetworkAccess?: string
      minimalTlsVersion?: string
      administrators?: { administratorType?: string }
      restrictOutboundNetworkAccess?: string
    }
  }>(`/subscriptions/${subscriptionId.trim()}/providers/Microsoft.Sql/servers`, '2023-08-01-preview')

  const filteredServers = normalizeRegion(
    servers.map((server) => ({
      id: server.id?.trim() || '',
      name: server.name?.trim() || extractResourceName(server.id ?? ''),
      resourceGroup: extractResourceGroup(server.id ?? ''),
      location: server.location?.trim() || '',
      version: server.properties?.version?.trim() || '',
      fullyQualifiedDomainName: server.properties?.fullyQualifiedDomainName?.trim() || '',
      publicNetworkAccess: server.properties?.publicNetworkAccess?.trim() || 'Enabled',
      minimalTlsVersion: server.properties?.minimalTlsVersion?.trim() || '',
      administratorType: server.properties?.administrators?.administratorType?.trim() || '',
      outboundNetworkRestriction: server.properties?.restrictOutboundNetworkAccess?.trim() || '',
      tagCount: Object.keys(server.tags ?? {}).length
    })),
    location
  )

  const serverDetails = await Promise.all(filteredServers.map(async (server) => {
    const [databases, elasticPools] = await Promise.all([
      fetchAzureArmCollection<{
        id?: string
        name?: string
        location?: string
        sku?: { name?: string; tier?: string }
        properties?: {
          status?: string
          maxSizeBytes?: number
          zoneRedundant?: boolean
          readScale?: string
          autoPauseDelay?: number
          requestedBackupStorageRedundancy?: string
        }
      }>(`/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(server.resourceGroup)}/providers/Microsoft.Sql/servers/${encodeURIComponent(server.name)}/databases`, '2023-08-01-preview'),
      fetchAzureArmCollection<unknown>(`/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(server.resourceGroup)}/providers/Microsoft.Sql/servers/${encodeURIComponent(server.name)}/elasticPools`, '2023-08-01-preview')
    ])

    const mappedDatabases = databases
      .filter((database) => (database.name?.trim().toLowerCase() ?? '') !== 'master')
      .map((database) => ({
        id: database.id?.trim() || '',
        name: database.name?.trim() || '',
        serverName: server.name,
        resourceGroup: server.resourceGroup,
        location: database.location?.trim() || server.location,
        status: database.properties?.status?.trim() || '',
        skuName: database.sku?.name?.trim() || '',
        edition: database.sku?.tier?.trim() || '',
        maxSizeGb: database.properties?.maxSizeBytes ? Number((database.properties.maxSizeBytes / (1024 ** 3)).toFixed(1)) : 0,
        zoneRedundant: database.properties?.zoneRedundant === true,
        readScale: database.properties?.readScale?.trim() || '',
        autoPauseDelayMinutes: database.properties?.autoPauseDelay ?? 0,
        backupStorageRedundancy: database.properties?.requestedBackupStorageRedundancy?.trim() || ''
      } satisfies AzureSqlDatabaseSummary))

    const notes: string[] = []
    if (server.publicNetworkAccess.toLowerCase() === 'enabled') {
      notes.push('Public network access is enabled for this SQL server.')
    }
    if ((server.minimalTlsVersion || '').toUpperCase() && (server.minimalTlsVersion || '').toUpperCase() !== '1.2') {
      notes.push(`Minimal TLS version is ${server.minimalTlsVersion}.`)
    }

    return {
      server: {
        ...server,
        databaseCount: mappedDatabases.length,
        elasticPoolCount: elasticPools.length,
        notes
      } satisfies AzureSqlServerSummary,
      databases: mappedDatabases
    }
  }))

  const mappedServers = serverDetails.map((entry) => entry.server).sort((left, right) => left.name.localeCompare(right.name))
  const mappedDatabases = serverDetails.flatMap((entry) => entry.databases).sort((left, right) => left.name.localeCompare(right.name))

  return {
    subscriptionId,
    serverCount: mappedServers.length,
    databaseCount: mappedDatabases.length,
    publicServerCount: mappedServers.filter((server) => server.publicNetworkAccess.toLowerCase() === 'enabled').length,
    servers: mappedServers,
    databases: mappedDatabases,
    notes: mappedServers.length === 0
      ? [
          'No Azure SQL servers were visible for the selected subscription and region.',
          'If servers exist in the Azure Portal, verify that the Microsoft.Sql resource provider is registered on this subscription and that your identity has Reader access to SQL Server resources.'
        ]
      : []
  }
}

export async function describeAzureSqlServer(subscriptionId: string, resourceGroup: string, serverName: string): Promise<AzureSqlServerDetail> {
  const basePath = `/subscriptions/${encodeURIComponent(subscriptionId.trim())}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Sql/servers/${encodeURIComponent(serverName)}`

  const [serverRaw, databases, firewallRulesRaw, elasticPools] = await Promise.all([
    fetchAzureArmJson<{
      id?: string
      name?: string
      location?: string
      tags?: Record<string, string>
      properties?: {
        version?: string
        fullyQualifiedDomainName?: string
        publicNetworkAccess?: string
        minimalTlsVersion?: string
        administrators?: { administratorType?: string }
        restrictOutboundNetworkAccess?: string
      }
    }>(basePath, '2023-08-01-preview'),
    fetchAzureArmCollection<{
      id?: string
      name?: string
      location?: string
      sku?: { name?: string; tier?: string }
      properties?: {
        status?: string
        maxSizeBytes?: number
        zoneRedundant?: boolean
        readScale?: string
        autoPauseDelay?: number
        requestedBackupStorageRedundancy?: string
      }
    }>(`${basePath}/databases`, '2023-08-01-preview'),
    fetchAzureArmCollection<{
      id?: string
      name?: string
      properties?: { startIpAddress?: string; endIpAddress?: string }
    }>(`${basePath}/firewallRules`, '2023-08-01-preview'),
    fetchAzureArmCollection<unknown>(`${basePath}/elasticPools`, '2023-08-01-preview')
  ])

  const server: AzureSqlServerSummary = {
    id: serverRaw.id?.trim() || '',
    name: serverRaw.name?.trim() || serverName,
    resourceGroup,
    location: serverRaw.location?.trim() || '',
    version: serverRaw.properties?.version?.trim() || '',
    fullyQualifiedDomainName: serverRaw.properties?.fullyQualifiedDomainName?.trim() || '',
    publicNetworkAccess: serverRaw.properties?.publicNetworkAccess?.trim() || 'Enabled',
    minimalTlsVersion: serverRaw.properties?.minimalTlsVersion?.trim() || '',
    administratorType: serverRaw.properties?.administrators?.administratorType?.trim() || '',
    outboundNetworkRestriction: serverRaw.properties?.restrictOutboundNetworkAccess?.trim() || '',
    databaseCount: 0,
    elasticPoolCount: elasticPools.length,
    tagCount: Object.keys(serverRaw.tags ?? {}).length,
    notes: []
  }

  const mappedDatabases: AzureSqlDatabaseSummary[] = databases
    .filter((db) => (db.name?.trim().toLowerCase() ?? '') !== 'master')
    .map((db) => ({
      id: db.id?.trim() || '',
      name: db.name?.trim() || '',
      serverName: server.name,
      resourceGroup,
      location: db.location?.trim() || server.location,
      status: db.properties?.status?.trim() || '',
      skuName: db.sku?.name?.trim() || '',
      edition: db.sku?.tier?.trim() || '',
      maxSizeGb: db.properties?.maxSizeBytes ? Number((db.properties.maxSizeBytes / (1024 ** 3)).toFixed(1)) : 0,
      zoneRedundant: db.properties?.zoneRedundant === true,
      readScale: db.properties?.readScale?.trim() || '',
      autoPauseDelayMinutes: db.properties?.autoPauseDelay ?? 0,
      backupStorageRedundancy: db.properties?.requestedBackupStorageRedundancy?.trim() || ''
    } satisfies AzureSqlDatabaseSummary))

  server.databaseCount = mappedDatabases.length

  const firewallRules: AzureSqlFirewallRule[] = firewallRulesRaw.map((rule) => ({
    name: rule.name?.trim() || '',
    startIpAddress: rule.properties?.startIpAddress?.trim() || '',
    endIpAddress: rule.properties?.endIpAddress?.trim() || ''
  }))

  const isPublic = server.publicNetworkAccess.toLowerCase() === 'enabled'
  const hasWeakTls = !!server.minimalTlsVersion && server.minimalTlsVersion !== '1.2'
  const noTlsMin = !server.minimalTlsVersion
  const hasAadAdmin = !!server.administratorType && server.administratorType.toLowerCase().includes('activedirectory')
  const outboundRestricted = server.outboundNetworkRestriction.toLowerCase() === 'enabled'
  const hasAllowAllRule = firewallRules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '255.255.255.255')
  const hasAllowAzureRule = firewallRules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '0.0.0.0')
  const zoneRedundantCount = mappedDatabases.filter((db) => db.zoneRedundant).length
  const onlineCount = mappedDatabases.filter((db) => db.status.toLowerCase() === 'online').length

  const badges: AzureSqlPostureBadge[] = [
    { id: 'public-access', label: 'Public Access', value: isPublic ? 'Enabled' : 'Disabled', tone: isPublic ? 'risk' : 'good' },
    { id: 'tls', label: 'Min TLS', value: server.minimalTlsVersion || 'Not set', tone: noTlsMin || hasWeakTls ? 'warning' : 'good' },
    { id: 'aad-admin', label: 'AAD Admin', value: hasAadAdmin ? 'Configured' : 'Local only', tone: hasAadAdmin ? 'good' : 'warning' },
    { id: 'outbound', label: 'Outbound', value: outboundRestricted ? 'Restricted' : 'Unrestricted', tone: outboundRestricted ? 'good' : 'info' },
    { id: 'firewall', label: 'Firewall Rules', value: `${firewallRules.length} rules`, tone: hasAllowAllRule ? 'risk' : firewallRules.length === 0 ? 'good' : 'info' }
  ]

  const findings: AzureSqlFinding[] = []
  const recommendations: string[] = []

  if (isPublic) {
    findings.push({ id: 'public-access', severity: 'risk', title: 'Public network access enabled', message: 'This SQL server accepts connections from public IP addresses.', recommendation: 'Disable public network access and use private endpoints for production workloads.' })
    recommendations.push('Disable public network access and use private endpoints for production workloads.')
  }

  if (hasWeakTls) {
    findings.push({ id: 'weak-tls', severity: 'warning', title: `Minimum TLS version is ${server.minimalTlsVersion}`, message: 'The server permits connections using deprecated TLS versions.', recommendation: 'Set the minimum TLS version to 1.2 to enforce modern transport security.' })
    recommendations.push('Set the minimum TLS version to 1.2 to enforce modern transport security.')
  }

  if (noTlsMin) {
    findings.push({ id: 'no-tls-min', severity: 'info', title: 'No minimum TLS version configured', message: 'The server does not enforce a minimum TLS version.', recommendation: 'Explicitly set the minimum TLS version to 1.2.' })
    recommendations.push('Explicitly set the minimum TLS version to 1.2.')
  }

  if (!hasAadAdmin) {
    findings.push({ id: 'no-aad', severity: 'warning', title: 'No Azure AD administrator', message: 'The server uses only SQL authentication without AAD integration.', recommendation: 'Configure an Azure AD administrator for centralized identity management.' })
    recommendations.push('Configure an Azure AD administrator for centralized identity management.')
  }

  if (hasAllowAllRule) {
    findings.push({ id: 'allow-all-firewall', severity: 'risk', title: 'Firewall allows all IP addresses', message: 'A firewall rule permits connections from the entire internet (0.0.0.0 - 255.255.255.255).', recommendation: 'Remove the allow-all firewall rule and restrict to specific IP ranges.' })
    recommendations.push('Remove the allow-all firewall rule and restrict to specific IP ranges.')
  }

  if (hasAllowAzureRule) {
    findings.push({ id: 'allow-azure-services', severity: 'info', title: 'Azure services access allowed', message: 'A special rule allows all Azure services to connect to this server.', recommendation: 'Review whether all Azure services need access or if private endpoints are preferred.' })
    recommendations.push('Review whether all Azure services need access or if private endpoints are preferred.')
  }

  if (recommendations.length === 0) {
    recommendations.push('No immediate operational posture warnings detected. Continue reviewing firewall and access settings during routine checks.')
  }

  const summaryTiles: AzureSqlSummaryTile[] = [
    { id: 'findings', label: 'Findings', value: String(findings.length), tone: findings.some((f) => f.severity === 'risk') ? 'risk' : findings.length ? 'warning' : 'good' },
    { id: 'databases', label: 'Databases', value: `${onlineCount}/${mappedDatabases.length} online`, tone: onlineCount === mappedDatabases.length ? 'good' : 'warning' },
    { id: 'firewall', label: 'Firewall', value: `${firewallRules.length} rules`, tone: hasAllowAllRule ? 'risk' : 'info' },
    { id: 'zone-redundant', label: 'Zone Redundant', value: `${zoneRedundantCount}/${mappedDatabases.length}`, tone: zoneRedundantCount === mappedDatabases.length && mappedDatabases.length > 0 ? 'good' : zoneRedundantCount > 0 ? 'info' : 'neutral' }
  ]

  if (isPublic) server.notes.push('Public network access is enabled for this SQL server.')
  if (hasWeakTls) server.notes.push(`Minimal TLS version is ${server.minimalTlsVersion}.`)

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
      { label: 'SQL version', value: server.version || 'N/A' },
      { label: 'Port', value: '1433' },
      { label: 'Administrator', value: server.administratorType || 'SQL Authentication' },
      { label: 'Elastic pools', value: String(server.elasticPoolCount) },
      { label: 'Tags', value: String(server.tagCount) }
    ]
  }
}
