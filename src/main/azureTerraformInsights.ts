import { randomUUID } from 'node:crypto'

import type {
  AwsConnection,
  CorrelatedSignalReference,
  ObservabilityFinding,
  ObservabilityPostureArea,
  ObservabilityPostureReport,
  ObservabilityRecommendation,
  TerraformDriftCoverageItem,
  TerraformDriftDifference,
  TerraformDriftHistory,
  TerraformDriftItem,
  TerraformDriftReport,
  TerraformDriftSnapshot,
  TerraformDriftStatus,
  TerraformProject,
  TerraformResourceInventoryItem
} from '@shared/types'
import { getProject } from './terraform'

type AzureTerraformContext = {
  contextId: string
  location: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseAzureContext(profileName: string, project: TerraformProject, connection?: AwsConnection): AzureTerraformContext {
  const match = profileName.match(/^provider:azure:terraform:([^:]+):(.+)$/)
  return {
    contextId: connection?.profile || str(project.environment.connectionLabel) || (match?.[1] && match[1] !== 'unscoped' ? match[1] : 'azure'),
    location: connection?.region || str(project.environment.region) || (match?.[2] && match[2] !== 'global' ? match[2] : 'global')
  }
}

function portalUrl(): string {
  return 'https://portal.azure.com/#home'
}

function resourceLocation(item: TerraformResourceInventoryItem, fallback: string): string {
  return str(item.values.location) || str(item.values.primary_location) || str(item.values.region) || fallback
}

function resourceId(item: TerraformResourceInventoryItem): string {
  return str(item.values.id)
}

function terminalCommand(item: TerraformResourceInventoryItem): string {
  const id = resourceId(item)
  return id
    ? `az resource show --ids "${id}" --output jsonc`
    : `terraform state show ${item.address}`
}

function createDifference(key: string, label: string, terraformValue: string, liveValue: string): TerraformDriftDifference {
  return {
    key,
    label,
    kind: 'heuristic',
    assessment: 'inferred',
    terraformValue,
    liveValue
  }
}

function coverageForType(resourceType: string): TerraformDriftCoverageItem {
  return {
    resourceType,
    coverage: 'partial',
    verifiedChecks: [],
    inferredChecks: ['Terraform state presence', 'Azure resource ID', 'Resource group', 'Location'],
    notes: ['Azure drift is inferred from Terraform metadata until live Azure SDK collectors are added.']
  }
}

function buildDriftItem(item: TerraformResourceInventoryItem, fallbackLocation: string): TerraformDriftItem {
  const id = resourceId(item)
  const location = resourceLocation(item, fallbackLocation)
  const resourceGroup = str(item.values.resource_group_name)
  const evidence = [id ? `Resource ID present: ${id}` : 'Resource ID missing from Terraform state.', resourceGroup ? `Resource group: ${resourceGroup}` : 'Resource group not present in Terraform state.']
  const differences: TerraformDriftDifference[] = []
  let status: TerraformDriftStatus = 'in_sync'
  let explanation = 'Terraform state contains an Azure resource identifier, group, and location. This item is treated as in sync with inferred confidence.'
  let suggestedNextStep = 'Use the terminal handoff to inspect the live Azure resource if you need stronger verification.'

  if (!id) {
    status = 'drifted'
    explanation = 'Terraform state does not expose an Azure resource ID for this resource, so live lookup confidence is reduced.'
    suggestedNextStep = 'Run the suggested terminal command to verify the live resource or refresh state after apply.'
    differences.push(createDifference('resource_id', 'Azure resource ID', 'missing', 'expected from state'))
  } else if (!location) {
    status = 'drifted'
    explanation = 'Terraform state does not expose a location for this resource, which weakens Azure handoff quality and drift confidence.'
    suggestedNextStep = 'Confirm the resource location in Azure and refresh Terraform state.'
    differences.push(createDifference('location', 'Location', 'missing', 'expected from state'))
  }

  return {
    terraformAddress: item.address,
    resourceType: item.type,
    logicalName: str(item.values.name) || item.name || item.address,
    cloudIdentifier: id || str(item.values.name) || item.address,
    region: location || fallbackLocation,
    status,
    assessment: 'inferred',
    explanation,
    suggestedNextStep,
    consoleUrl: portalUrl(),
    terminalCommand: terminalCommand(item),
    differences,
    evidence,
    relatedTerraformAddresses: [item.address]
  }
}

function summarizeItems(items: TerraformDriftItem[], scannedAt: string): TerraformDriftReport['summary'] {
  const statusCounts: Record<TerraformDriftStatus, number> = {
    in_sync: 0,
    drifted: 0,
    missing_in_aws: 0,
    unmanaged_in_aws: 0,
    unsupported: 0
  }
  const resourceTypeCounts = new Map<string, number>()
  const supportedResourceTypes = new Map<string, TerraformDriftCoverageItem>()

  for (const item of items) {
    statusCounts[item.status] += 1
    resourceTypeCounts.set(item.resourceType, (resourceTypeCounts.get(item.resourceType) ?? 0) + 1)
    supportedResourceTypes.set(item.resourceType, coverageForType(item.resourceType))
  }

  return {
    total: items.length,
    statusCounts,
    resourceTypeCounts: [...resourceTypeCounts.entries()].map(([resourceType, count]) => ({ resourceType, count })).sort((left, right) => right.count - left.count || left.resourceType.localeCompare(right.resourceType)),
    scannedAt,
    verifiedCount: 0,
    inferredCount: items.length,
    unsupportedResourceTypes: [],
    supportedResourceTypes: [...supportedResourceTypes.values()].sort((left, right) => left.resourceType.localeCompare(right.resourceType))
  }
}

function singleSnapshot(summary: TerraformDriftReport['summary'], items: TerraformDriftItem[], scannedAt: string): TerraformDriftHistory {
  const snapshot: TerraformDriftSnapshot = {
    id: randomUUID(),
    scannedAt,
    trigger: 'manual',
    summary,
    items
  }
  return {
    snapshots: [snapshot],
    trend: 'insufficient_history',
    latestScanAt: scannedAt,
    previousScanAt: ''
  }
}

export async function getAzureTerraformDriftReport(
  profileName: string,
  projectId: string,
  connection?: AwsConnection,
  _options?: { forceRefresh?: boolean }
): Promise<TerraformDriftReport> {
  const project = await getProject(profileName, projectId, connection)
  const context = parseAzureContext(profileName, project, connection)
  const scannedAt = new Date().toISOString()
  const azureResources = project.inventory.filter((item) => item.mode === 'managed' && item.type.startsWith('azurerm_'))
  const items = azureResources.map((item) => buildDriftItem(item, context.location))
  const summary = summarizeItems(items, scannedAt)

  return {
    projectId: project.id,
    projectName: project.name,
    profileName,
    region: context.location,
    summary,
    items,
    history: singleSnapshot(summary, items, scannedAt),
    fromCache: false
  }
}

function postureArea(id: string, label: string, value: string, tone: ObservabilityPostureArea['tone'], detail: string): ObservabilityPostureArea {
  return { id, label, value, tone, detail }
}

function finding(id: string, title: string, severity: ObservabilityFinding['severity'], summary: string, detail: string, impact: string, recommendationId: string, inference = true): ObservabilityFinding {
  return {
    id,
    title,
    severity,
    category: 'deployment',
    summary,
    detail,
    evidence: [],
    impact,
    inference,
    recommendedActionIds: [recommendationId]
  }
}

function recommendation(id: string, title: string, summary: string, rationale: string, expectedBenefit: string, risk: string, rollback: string): ObservabilityRecommendation {
  return {
    id,
    title,
    type: 'manual-check',
    summary,
    rationale,
    expectedBenefit,
    risk,
    rollback,
    prerequisiteLevel: 'required',
    setupEffort: 'low',
    labels: ['azure', 'terraform']
  }
}

export async function generateAzureTerraformObservabilityReport(
  profileName: string,
  projectId: string,
  connection?: AwsConnection
): Promise<ObservabilityPostureReport> {
  const project = await getProject(profileName, projectId, connection)
  const context = parseAzureContext(profileName, project, connection)
  const azureResources = project.inventory.filter((item) => item.mode === 'managed' && item.type.startsWith('azurerm_'))
  const monitorCount = azureResources.filter((item) => item.type.includes('monitor_') || item.type.includes('log_analytics_')).length
  const taggedCount = azureResources.filter((item) => {
    const tags = item.values.tags
    return Boolean(tags && typeof tags === 'object' && Object.keys(tags as Record<string, unknown>).length > 0)
  }).length
  const tagCoverage = azureResources.length > 0 ? Math.round((taggedCount / azureResources.length) * 100) : 0

  const recommendations: ObservabilityRecommendation[] = [
    recommendation('azure-backend', 'Move state to a shared backend', 'Prefer a remote backend for Azure shared workspaces.', 'Shared workspaces rely on consistent state access and recoverability.', 'Improves recovery and operator confidence.', 'Backend migration needs coordination.', 'Revert backend configuration and reinitialize if the migration is blocked.'),
    recommendation('azure-monitor', 'Add Azure Monitor anchors', 'Track diagnostic settings and Log Analytics resources in Terraform.', 'Shared Overview and Direct Access become more actionable when monitoring surfaces exist in state.', 'Improves observability and handoff quality.', 'Additional resources may increase cost.', 'Remove the monitor resources from Terraform if they are not desired.')
  ]

  const findings: ObservabilityFinding[] = []
  if (project.metadata.backendType === 'local') {
    findings.push(finding('local-backend', 'Terraform state uses a local backend', 'high', 'Local backend detected', 'The project is still using a local backend, which weakens shared operator recovery flows.', 'Operators have lower confidence during incident response or drift review.', 'azure-backend'))
  }
  if (monitorCount === 0 && azureResources.length > 0) {
    findings.push(finding('monitor-gap', 'Azure Monitor resources are not tracked in Terraform', 'medium', 'No monitor anchors found', 'No Azure Monitor diagnostic or Log Analytics resources are visible in the current Terraform inventory.', 'Overview and resilience workflows have fewer observability pivots.', 'azure-monitor'))
  }

  const correlatedSignals: CorrelatedSignalReference[] = [
    { id: 'azure-terraform', title: 'Terraform workspace', detail: project.name, serviceId: 'terraform', targetView: 'drift' },
    { id: 'azure-overview', title: 'Shared overview', detail: context.contextId, serviceId: 'overview', targetView: 'overview' },
    { id: 'azure-compliance', title: 'Compliance queue', detail: 'Azure heuristic findings', serviceId: 'compliance-center', targetView: 'tasks' },
    { id: 'azure-compare', title: 'Compare workspace', detail: 'Cross-project Azure Terraform comparison', serviceId: 'compare', targetView: 'services' }
  ]

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      kind: 'terraform',
      connection: {
        kind: connection?.kind ?? 'profile',
        label: connection?.label || context.contextId,
        profile: connection?.profile || context.contextId,
        region: connection?.region || context.location,
        sessionId: connection?.sessionId || profileName
      },
      projectId: project.id,
      projectName: project.name,
      rootPath: project.rootPath
    },
    summary: [
      postureArea('resources', 'Tracked resources', String(azureResources.length), azureResources.length > 0 ? 'mixed' : 'weak', 'Azure observability inference currently works from Terraform inventory only.'),
      postureArea('backend', 'Backend', project.metadata.backendType, project.metadata.backendType === 'local' ? 'weak' : 'good', 'Remote backends improve shared operator recovery and drift workflows.'),
      postureArea('monitor', 'Monitor coverage', String(monitorCount), monitorCount > 0 ? 'good' : 'weak', 'Diagnostic settings and Log Analytics resources act as observability anchors.'),
      postureArea('tags', 'Tag coverage', `${tagCoverage}%`, tagCoverage >= 70 ? 'good' : tagCoverage >= 40 ? 'mixed' : 'weak', 'Tags help correlate cost, ownership, and remediation queues.')
    ],
    findings,
    recommendations,
    experiments: [],
    artifacts: [],
    safetyNotes: [
      {
        title: 'Azure Terraform observability is inferred',
        blastRadius: 'Low',
        prerequisites: ['Use the terminal handoff for stronger live verification when needed.'],
        rollback: 'No rollback required; this report does not mutate infrastructure.'
      }
    ],
    correlatedSignals
  }
}
