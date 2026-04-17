import {
  GuardDutyClient,
  ListDetectorsCommand,
  GetDetectorCommand,
  ListFindingsCommand,
  GetFindingsCommand,
  ArchiveFindingsCommand,
  UnarchiveFindingsCommand
} from '@aws-sdk/client-guardduty'

import type {
  AwsConnection,
  GuardDutyDetectorSummary,
  GuardDutyFinding,
  GuardDutyReport,
  GuardDutySeverity,
  GuardDutySeverityCounts
} from '@shared/types'
import { getAwsClient } from './client'

function classifySeverity(numericSeverity: number): GuardDutySeverity {
  if (numericSeverity >= 8) return 'critical'
  if (numericSeverity >= 5) return 'high'
  if (numericSeverity >= 3) return 'medium'
  return 'low'
}

function classifyCategory(type: string): string {
  const prefix = type.split('/')[0] ?? 'Unknown'
  const categoryMap: Record<string, string> = {
    Recon: 'Reconnaissance',
    UnauthorizedAccess: 'Credential Compromise',
    Trojan: 'Instance Compromise',
    CryptoCurrency: 'Instance Compromise',
    Backdoor: 'Instance Compromise',
    Stealth: 'Evasion',
    PenTest: 'Penetration Testing',
    Impact: 'Impact',
    Policy: 'Policy Violation',
    Discovery: 'Reconnaissance',
    Exfiltration: 'Exfiltration',
    Persistence: 'Persistence',
    PrivilegeEscalation: 'Credential Compromise',
    Execution: 'Instance Compromise'
  }
  return categoryMap[prefix] ?? prefix
}

function extractResource(finding: {
  Resource?: {
    ResourceType?: string
    InstanceDetails?: { InstanceId?: string }
    AccessKeyDetails?: { AccessKeyId?: string; UserName?: string }
    S3BucketDetails?: Array<{ Name?: string }>
    EksClusterDetails?: { Name?: string }
    EcsClusterDetails?: { Arn?: string }
    ContainerDetails?: { ContainerRuntime?: string; Id?: string }
    RdsDbInstanceDetails?: { DbInstanceIdentifier?: string }
    LambdaDetails?: { FunctionName?: string }
  }
}): { resourceType: string; resourceId: string } {
  const resource = finding.Resource
  const resourceType = resource?.ResourceType ?? 'Unknown'

  if (resource?.InstanceDetails?.InstanceId) {
    return { resourceType, resourceId: resource.InstanceDetails.InstanceId }
  }
  if (resource?.AccessKeyDetails?.AccessKeyId) {
    return {
      resourceType,
      resourceId: resource.AccessKeyDetails.UserName ?? resource.AccessKeyDetails.AccessKeyId
    }
  }
  if (resource?.S3BucketDetails?.[0]?.Name) {
    return { resourceType, resourceId: resource.S3BucketDetails[0].Name }
  }
  if (resource?.EksClusterDetails?.Name) {
    return { resourceType, resourceId: resource.EksClusterDetails.Name }
  }
  if (resource?.EcsClusterDetails?.Arn) {
    return { resourceType, resourceId: resource.EcsClusterDetails.Arn }
  }
  if (resource?.RdsDbInstanceDetails?.DbInstanceIdentifier) {
    return { resourceType, resourceId: resource.RdsDbInstanceDetails.DbInstanceIdentifier }
  }
  if (resource?.LambdaDetails?.FunctionName) {
    return { resourceType, resourceId: resource.LambdaDetails.FunctionName }
  }
  return { resourceType, resourceId: 'unknown' }
}

async function getDetector(
  client: GuardDutyClient
): Promise<GuardDutyDetectorSummary | null> {
  const detectors = await client.send(new ListDetectorsCommand({ MaxResults: 1 }))
  const detectorId = detectors.DetectorIds?.[0]
  if (!detectorId) return null

  const detail = await client.send(new GetDetectorCommand({ DetectorId: detectorId }))
  return {
    detectorId,
    status: detail.Status ?? 'UNKNOWN',
    createdAt: detail.CreatedAt ?? ''
  }
}

async function listAllFindings(
  client: GuardDutyClient,
  detectorId: string,
  archived: boolean
): Promise<string[]> {
  const ids: string[] = []
  let nextToken: string | undefined

  do {
    const response = await client.send(
      new ListFindingsCommand({
        DetectorId: detectorId,
        FindingCriteria: {
          Criterion: {
            'service.archived': { Eq: [archived ? 'true' : 'false'] }
          }
        },
        MaxResults: 50,
        NextToken: nextToken
      })
    )
    ids.push(...(response.FindingIds ?? []))
    nextToken = response.NextToken
  } while (nextToken && ids.length < 200)

  return ids
}

async function getFindings(
  client: GuardDutyClient,
  detectorId: string,
  findingIds: string[]
): Promise<GuardDutyFinding[]> {
  if (findingIds.length === 0) return []

  const findings: GuardDutyFinding[] = []

  // GetFindings supports max 50 at a time
  for (let i = 0; i < findingIds.length; i += 50) {
    const batch = findingIds.slice(i, i + 50)
    const response = await client.send(
      new GetFindingsCommand({ DetectorId: detectorId, FindingIds: batch })
    )

    for (const f of response.Findings ?? []) {
      const { resourceType, resourceId } = extractResource(f as Parameters<typeof extractResource>[0])
      findings.push({
        id: f.Id ?? '',
        title: f.Title ?? '',
        description: f.Description ?? '',
        severity: classifySeverity(f.Severity ?? 0),
        type: f.Type ?? '',
        category: classifyCategory(f.Type ?? ''),
        resourceType,
        resourceId,
        region: f.Region ?? '',
        count: f.Service?.Count ?? 1,
        firstSeenAt: f.Service?.EventFirstSeen ?? f.CreatedAt ?? '',
        lastSeenAt: f.Service?.EventLastSeen ?? f.UpdatedAt ?? '',
        archived: f.Service?.Archived ?? false
      })
    }
  }

  return findings
}

export async function getGuardDutyReport(connection: AwsConnection): Promise<GuardDutyReport> {
  const client = getAwsClient(GuardDutyClient, connection)
  const warnings: string[] = []

  const detector = await getDetector(client)
  if (!detector) {
    return {
      generatedAt: new Date().toISOString(),
      detector: null,
      findings: [],
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      topTargetedResources: [],
      categoryBreakdown: {},
      warnings: ['GuardDuty is not enabled in this region']
    }
  }

  let findingIds: string[] = []
  try {
    findingIds = await listAllFindings(client, detector.detectorId, false)
  } catch (error) {
    warnings.push(`List findings: ${error instanceof Error ? error.message : String(error)}`)
  }

  let findings: GuardDutyFinding[] = []
  try {
    findings = await getFindings(client, detector.detectorId, findingIds)
  } catch (error) {
    warnings.push(`Get findings: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Sort by severity then recency
  const severityOrder: Record<GuardDutySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  findings.sort((a, b) => {
    const sevDelta = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDelta !== 0) return sevDelta
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  })

  // Compute severity counts
  const severityCounts: GuardDutySeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) {
    severityCounts[f.severity] += 1
  }

  // Top targeted resources
  const resourceCounts = new Map<string, number>()
  for (const f of findings) {
    resourceCounts.set(f.resourceId, (resourceCounts.get(f.resourceId) ?? 0) + 1)
  }
  const topTargetedResources = Array.from(resourceCounts.entries())
    .map(([resourceId, findingCount]) => ({ resourceId, findingCount }))
    .sort((a, b) => b.findingCount - a.findingCount)
    .slice(0, 10)

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {}
  for (const f of findings) {
    categoryBreakdown[f.category] = (categoryBreakdown[f.category] ?? 0) + 1
  }

  return {
    generatedAt: new Date().toISOString(),
    detector,
    findings,
    severityCounts,
    topTargetedResources,
    categoryBreakdown,
    warnings
  }
}

export async function archiveGuardDutyFindings(
  connection: AwsConnection,
  findingIds: string[]
): Promise<void> {
  const client = getAwsClient(GuardDutyClient, connection)
  const detectors = await client.send(new ListDetectorsCommand({ MaxResults: 1 }))
  const detectorId = detectors.DetectorIds?.[0]
  if (!detectorId) throw new Error('GuardDuty is not enabled')

  await client.send(
    new ArchiveFindingsCommand({ DetectorId: detectorId, FindingIds: findingIds })
  )
}

export async function unarchiveGuardDutyFindings(
  connection: AwsConnection,
  findingIds: string[]
): Promise<void> {
  const client = getAwsClient(GuardDutyClient, connection)
  const detectors = await client.send(new ListDetectorsCommand({ MaxResults: 1 }))
  const detectorId = detectors.DetectorIds?.[0]
  if (!detectorId) throw new Error('GuardDuty is not enabled')

  await client.send(
    new UnarchiveFindingsCommand({ DetectorId: detectorId, FindingIds: findingIds })
  )
}
