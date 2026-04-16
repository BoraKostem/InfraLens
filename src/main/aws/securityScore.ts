import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch'

import type {
  AwsConnection,
  SecurityCheck,
  SecurityDomainResult,
  SecurityScoreDomain,
  SecurityScoreReport,
  SecurityScoreWeights
} from '@shared/types'
import { getAwsClient } from './client'
import { listTrails } from './cloudtrail'
import { getAccountSummary, getCredentialReport } from './iam'
import { listSecurityGroups } from './securityGroups'
import { listBucketGovernance } from './s3'
import { describeDbInstance, listDbInstances } from './rds'
import { listVpcs } from './vpc'

const DEFAULT_WEIGHTS: SecurityScoreWeights = {
  iam: 30,
  network: 25,
  encryption: 20,
  logging: 15,
  compliance: 10
}

const RISKY_PORTS = new Set([22, 3389, 3306, 5432, 6379, 27017, 9200, 2375])

async function loadSafe<T>(fallback: T, fn: () => Promise<T>, warnings: string[], label: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

/* ── IAM domain checks ───────────────────────────────────── */

async function evaluateIam(connection: AwsConnection, warnings: string[]): Promise<SecurityDomainResult> {
  const checks: SecurityCheck[] = []

  const [credentialReport, accountSummary] = await Promise.all([
    loadSafe([], () => getCredentialReport(connection), warnings, 'IAM credential report'),
    loadSafe({} as Record<string, number>, () => getAccountSummary(connection), warnings, 'IAM account summary')
  ])

  // Check: root account MFA
  const rootUser = credentialReport.find((entry) => entry.user === '<root_account>')
  checks.push({
    id: 'iam:root-mfa',
    label: 'Root account has MFA enabled',
    passed: rootUser?.mfaActive === 'true',
    severity: 'high',
    detail: rootUser?.mfaActive === 'true' ? 'Root MFA is enabled' : 'Root account does not have MFA enabled'
  })

  // Check: no root access keys
  const rootHasKeys = rootUser?.accessKey1Active === 'true' || rootUser?.accessKey2Active === 'true'
  checks.push({
    id: 'iam:root-access-keys',
    label: 'No active root access keys',
    passed: !rootHasKeys,
    severity: 'high',
    detail: rootHasKeys ? 'Root account has active access keys — remove them' : 'No root access keys found'
  })

  // Check: all users have MFA
  const humanUsers = credentialReport.filter(
    (entry) => entry.user !== '<root_account>' && entry.passwordEnabled === 'true'
  )
  const usersWithoutMfa = humanUsers.filter((entry) => entry.mfaActive !== 'true')
  checks.push({
    id: 'iam:user-mfa',
    label: 'All console users have MFA',
    passed: usersWithoutMfa.length === 0,
    severity: 'high',
    detail:
      usersWithoutMfa.length === 0
        ? 'All console users have MFA'
        : `${usersWithoutMfa.length} console user(s) without MFA`
  })

  // Check: access key rotation (90 day threshold)
  const staleKeyThresholdMs = 90 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const staleKeyUsers = credentialReport.filter((entry) => {
    if (entry.accessKey1Active === 'true' && entry.accessKey1LastRotated) {
      const rotated = new Date(entry.accessKey1LastRotated).getTime()
      if (now - rotated > staleKeyThresholdMs) return true
    }
    if (entry.accessKey2Active === 'true' && entry.accessKey2LastRotated) {
      const rotated = new Date(entry.accessKey2LastRotated).getTime()
      if (now - rotated > staleKeyThresholdMs) return true
    }
    return false
  })
  checks.push({
    id: 'iam:key-rotation',
    label: 'Access keys rotated within 90 days',
    passed: staleKeyUsers.length === 0,
    severity: 'medium',
    detail:
      staleKeyUsers.length === 0
        ? 'All access keys rotated recently'
        : `${staleKeyUsers.length} user(s) with stale access keys`
  })

  // Check: password policy strength
  const hasPasswordPolicy = (accountSummary as Record<string, number>)['AccountMFAEnabled'] === 1
  checks.push({
    id: 'iam:account-mfa',
    label: 'Account-level MFA enabled',
    passed: hasPasswordPolicy,
    severity: 'medium',
    detail: hasPasswordPolicy ? 'Account MFA is enabled' : 'Account-level MFA is not enabled'
  })

  return buildDomainResult('iam', checks)
}

/* ── Network domain checks ───────────────────────────────── */

async function evaluateNetwork(connection: AwsConnection, warnings: string[]): Promise<SecurityDomainResult> {
  const checks: SecurityCheck[] = []

  const [securityGroups, vpcs] = await Promise.all([
    loadSafe([], () => listSecurityGroups(connection), warnings, 'Security groups'),
    loadSafe([], () => listVpcs(connection), warnings, 'VPCs')
  ])

  // Check: no wide-open security groups (0.0.0.0/0 ingress on risky ports)
  const wideOpenGroups = securityGroups.filter((sg) =>
    sg.inboundRules.some(
      (rule) =>
        (rule.source === '0.0.0.0/0' || rule.source === '::/0') &&
        isRiskyPort(rule.protocol, rule.portRange)
    )
  )
  checks.push({
    id: 'net:wide-open-sg',
    label: 'No security groups open to 0.0.0.0/0 on risky ports',
    passed: wideOpenGroups.length === 0,
    severity: 'high',
    detail:
      wideOpenGroups.length === 0
        ? 'No wide-open security groups found'
        : `${wideOpenGroups.length} security group(s) with 0.0.0.0/0 ingress on risky ports`
  })

  // Check: no unrestricted SSH
  const sshOpen = securityGroups.filter((sg) =>
    sg.inboundRules.some(
      (rule) =>
        (rule.source === '0.0.0.0/0' || rule.source === '::/0') &&
        rule.portRange === '22'
    )
  )
  checks.push({
    id: 'net:ssh-restricted',
    label: 'SSH (port 22) not open to the internet',
    passed: sshOpen.length === 0,
    severity: 'high',
    detail: sshOpen.length === 0 ? 'SSH is restricted' : `${sshOpen.length} group(s) expose SSH to the internet`
  })

  // Check: no unrestricted RDP
  const rdpOpen = securityGroups.filter((sg) =>
    sg.inboundRules.some(
      (rule) =>
        (rule.source === '0.0.0.0/0' || rule.source === '::/0') &&
        rule.portRange === '3389'
    )
  )
  checks.push({
    id: 'net:rdp-restricted',
    label: 'RDP (port 3389) not open to the internet',
    passed: rdpOpen.length === 0,
    severity: 'high',
    detail: rdpOpen.length === 0 ? 'RDP is restricted' : `${rdpOpen.length} group(s) expose RDP to the internet`
  })

  // Check: VPC flow logs (presence of VPCs suggests need for flow logs)
  const vpcFlowLogCheck = vpcs.length === 0 || vpcs.some((vpc) => vpc.tags?.['FlowLogEnabled'] === 'true')
  checks.push({
    id: 'net:flow-logs',
    label: 'VPC flow logs enabled',
    passed: vpcFlowLogCheck,
    severity: 'medium',
    detail: vpcFlowLogCheck ? 'VPC flow logs appear configured' : 'VPC flow logs may not be enabled on all VPCs'
  })

  return buildDomainResult('network', checks)
}

/* ── Encryption domain checks ────────────────────────────── */

async function evaluateEncryption(connection: AwsConnection, warnings: string[]): Promise<SecurityDomainResult> {
  const checks: SecurityCheck[] = []

  const [s3Governance, rdsInstanceSummaries] = await Promise.all([
    loadSafe(null, () => listBucketGovernance(connection), warnings, 'S3 governance'),
    loadSafe([], () => listDbInstances(connection), warnings, 'RDS instances')
  ])

  // Check: S3 bucket encryption
  if (s3Governance) {
    const unencryptedBuckets = s3Governance.buckets.filter((b) => b.encryption.status !== 'enabled')
    checks.push({
      id: 'enc:s3-at-rest',
      label: 'All S3 buckets have encryption at rest',
      passed: unencryptedBuckets.length === 0,
      severity: 'high',
      detail:
        unencryptedBuckets.length === 0
          ? 'All S3 buckets are encrypted'
          : `${unencryptedBuckets.length} bucket(s) without encryption`
    })

    // Check: S3 public access block
    const publicBuckets = s3Governance.buckets.filter(
      (b) =>
        !b.publicAccessBlock.blockPublicAcls ||
        !b.publicAccessBlock.blockPublicPolicy ||
        !b.publicAccessBlock.ignorePublicAcls ||
        !b.publicAccessBlock.restrictPublicBuckets
    )
    checks.push({
      id: 'enc:s3-public-access',
      label: 'No S3 buckets with public access',
      passed: publicBuckets.length === 0,
      severity: 'high',
      detail:
        publicBuckets.length === 0
          ? 'No public buckets'
          : `${publicBuckets.length} bucket(s) with public access`
    })
  }

  // Check: RDS encryption
  const rdsDetails = await loadSafe([], async () => {
    const results = []
    for (const instance of rdsInstanceSummaries.slice(0, 10)) {
      try {
        results.push(await describeDbInstance(connection, instance.dbInstanceIdentifier))
      } catch { /* skip */ }
    }
    return results
  }, warnings, 'RDS encryption check')

  const unencryptedRds = rdsDetails.filter((db) => !db.storageEncrypted)
  checks.push({
    id: 'enc:rds-at-rest',
    label: 'All RDS instances have encryption at rest',
    passed: unencryptedRds.length === 0,
    severity: 'high',
    detail:
      unencryptedRds.length === 0
        ? 'All RDS instances are encrypted'
        : `${unencryptedRds.length} RDS instance(s) without encryption`
  })

  return buildDomainResult('encryption', checks)
}

/* ── Logging domain checks ───────────────────────────────── */

async function evaluateLogging(connection: AwsConnection, warnings: string[]): Promise<SecurityDomainResult> {
  const checks: SecurityCheck[] = []

  const [trails, alarmCount] = await Promise.all([
    loadSafe([], () => listTrails(connection), warnings, 'CloudTrail'),
    loadSafe(0, async () => {
      const client = getAwsClient(CloudWatchClient, connection)
      const response = await client.send(new DescribeAlarmsCommand({ MaxRecords: 1 }))
      return (response.MetricAlarms?.length ?? 0) + (response.CompositeAlarms?.length ?? 0)
    }, warnings, 'CloudWatch alarms')
  ])

  // Check: CloudTrail enabled
  const activeTrails = trails.filter((t) => t.isLogging)
  checks.push({
    id: 'log:cloudtrail-enabled',
    label: 'CloudTrail is active',
    passed: activeTrails.length > 0,
    severity: 'high',
    detail: activeTrails.length > 0 ? `${activeTrails.length} active trail(s)` : 'No active CloudTrail trails'
  })

  // Check: multi-region trail
  const multiRegionTrail = trails.some((t) => t.isMultiRegion && t.isLogging)
  checks.push({
    id: 'log:cloudtrail-multi-region',
    label: 'Multi-region CloudTrail enabled',
    passed: multiRegionTrail,
    severity: 'medium',
    detail: multiRegionTrail ? 'Multi-region trail is active' : 'No multi-region CloudTrail trail found'
  })

  // Check: CloudWatch alarms present
  checks.push({
    id: 'log:cloudwatch-alarms',
    label: 'CloudWatch alarms configured',
    passed: alarmCount > 0,
    severity: 'low',
    detail: alarmCount > 0 ? `${alarmCount} alarm(s) configured` : 'No CloudWatch alarms configured'
  })

  return buildDomainResult('logging', checks)
}

/* ── Compliance domain checks ────────────────────────────── */

async function evaluateCompliance(connection: AwsConnection, warnings: string[]): Promise<SecurityDomainResult> {
  const checks: SecurityCheck[] = []

  const [s3Governance, securityGroups] = await Promise.all([
    loadSafe(null, () => listBucketGovernance(connection), warnings, 'S3 governance'),
    loadSafe([], () => listSecurityGroups(connection), warnings, 'Security groups')
  ])

  // Check: S3 versioning
  if (s3Governance) {
    const unversioned = s3Governance.buckets.filter((b) => b.versioning.status !== 'enabled')
    checks.push({
      id: 'cpl:s3-versioning',
      label: 'S3 buckets have versioning enabled',
      passed: unversioned.length === 0,
      severity: 'medium',
      detail:
        unversioned.length === 0
          ? 'All buckets have versioning'
          : `${unversioned.length} bucket(s) without versioning`
    })
  }

  // Check: default security groups have no rules
  const defaultGroups = securityGroups.filter((sg) => sg.groupName === 'default')
  const defaultGroupsWithRules = defaultGroups.filter(
    (sg) => sg.inboundRules.length > 0 || sg.outboundRules.length > 0
  )
  checks.push({
    id: 'cpl:default-sg-clean',
    label: 'Default security groups have no rules',
    passed: defaultGroupsWithRules.length === 0,
    severity: 'medium',
    detail:
      defaultGroupsWithRules.length === 0
        ? 'Default security groups are clean'
        : `${defaultGroupsWithRules.length} default group(s) still have rules`
  })

  return buildDomainResult('compliance', checks)
}

/* ── Helpers ─────────────────────────────────────────────── */

function isRiskyPort(protocol: string, portRange: string): boolean {
  if (protocol === 'All' || portRange === 'All') return true
  const [fromText, toText = fromText] = portRange.split('-')
  const from = Number(fromText)
  const to = Number(toText)
  if (Number.isNaN(from) || Number.isNaN(to)) return false
  for (const port of RISKY_PORTS) {
    if (port >= from && port <= to) return true
  }
  return false
}

function buildDomainResult(domain: SecurityScoreDomain, checks: SecurityCheck[]): SecurityDomainResult {
  if (checks.length === 0) {
    return { domain, score: 100, maxScore: 100, checks }
  }

  const severityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 }
  let maxScore = 0
  let earnedScore = 0

  for (const check of checks) {
    const weight = severityWeight[check.severity] ?? 1
    maxScore += weight
    if (check.passed) earnedScore += weight
  }

  const normalizedScore = Math.round((earnedScore / maxScore) * 100)
  return { domain, score: normalizedScore, maxScore: 100, checks }
}

function computeOverallScore(domainResults: SecurityDomainResult[], weights: SecurityScoreWeights): number {
  let totalWeight = 0
  let weightedScore = 0

  for (const result of domainResults) {
    const weight = weights[result.domain]
    totalWeight += weight
    weightedScore += result.score * weight
  }

  return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0
}

/* ── Main export ─────────────────────────────────────────── */

export async function getSecurityScoreReport(
  connection: AwsConnection,
  weights?: Partial<SecurityScoreWeights>
): Promise<SecurityScoreReport> {
  const mergedWeights: SecurityScoreWeights = { ...DEFAULT_WEIGHTS, ...weights }
  const warnings: string[] = []

  const [iam, network, encryption, logging, compliance] = await Promise.all([
    evaluateIam(connection, warnings),
    evaluateNetwork(connection, warnings),
    evaluateEncryption(connection, warnings),
    evaluateLogging(connection, warnings),
    evaluateCompliance(connection, warnings)
  ])

  const domainResults = [iam, network, encryption, logging, compliance]
  const overallScore = computeOverallScore(domainResults, mergedWeights)

  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    domainResults,
    weights: mergedWeights,
    warnings
  }
}
