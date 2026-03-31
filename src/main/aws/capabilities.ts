import type { AwsCapabilityHint, AwsCapabilitySnapshot, AwsCapabilitySubject } from '@shared/types'

const BILLING_HOME_REGION = 'us-east-1'
const ROUTE53_DOMAINS_HOME_REGION = 'us-east-1'

function normalizeRegion(region: string): string {
  return region.trim().toLowerCase()
}

function buildHint(subject: AwsCapabilitySubject, region: string): AwsCapabilityHint | null {
  const normalizedRegion = normalizeRegion(region)

  switch (subject) {
    case 'billing':
      return normalizedRegion === BILLING_HOME_REGION
        ? {
            id: `billing:${normalizedRegion}`,
            subject,
            region: normalizedRegion,
            availability: 'supported',
            severity: 'info',
            title: 'Billing APIs are aligned',
            summary: 'Cost and payer-level billing surfaces are best routed through us-east-1 for consistent behavior.',
            recommendedAction: 'Use the active region for overview, but prefer us-east-1 when a workflow needs payer-level billing detail.'
          }
        : {
            id: `billing:${normalizedRegion}`,
            subject,
            region: normalizedRegion,
            availability: 'limited',
            severity: 'warning',
            title: 'Billing context is payer-scoped',
            summary: 'Billing and Cost Explorer data are account-global surfaces. Region-specific navigation can work, but payer-level detail is most reliable through us-east-1.',
            recommendedAction: 'Fall back to us-east-1 or a global overview flow before treating missing billing data as an AWS error.'
          }
    case 'organizations':
      return {
        id: `organizations:${normalizedRegion}`,
        subject,
        region: normalizedRegion,
        availability: 'limited',
        severity: 'warning',
        title: 'Organizations data is permission-sensitive',
        summary: 'Organizations and account grouping are management-account surfaces. Many operator profiles will not have permission to enumerate them.',
        recommendedAction: 'Gate the UI behind a management-account or delegated-admin check and explain partial visibility when access is denied.'
      }
    case 'route53-domains':
      return normalizedRegion === ROUTE53_DOMAINS_HOME_REGION
        ? {
            id: `route53-domains:${normalizedRegion}`,
            subject,
            region: normalizedRegion,
            availability: 'supported',
            severity: 'info',
            title: 'Route 53 Domains region is aligned',
            summary: 'Route 53 domain registration handoff flows can execute directly in us-east-1.',
            recommendedAction: 'Prefer in-app domain workflows only when the active region is us-east-1; otherwise guide the user to switch first.'
          }
        : {
            id: `route53-domains:${normalizedRegion}`,
            subject,
            region: normalizedRegion,
            availability: 'unsupported',
            severity: 'error',
            title: 'Route 53 Domains is not regionalized here',
            summary: 'Domain registration and transfer APIs are not available from the current region.',
            recommendedAction: 'Explain the region restriction early and offer a switch to us-east-1 before the workflow starts.'
          }
    case 'local-zones':
      return {
        id: `local-zones:${normalizedRegion}`,
        subject,
        region: normalizedRegion,
        availability: 'limited',
        severity: 'warning',
        title: 'Local Zone support is narrower than regional support',
        summary: 'Local Zone placement, resource types, and follow-up actions vary by service and by home region. A standard regional success path does not guarantee Local Zone support.',
        recommendedAction: 'Run capability checks before mutating Local Zone resources and explain service-specific limitations before the operator commits an action.'
      }
    default:
      return null
  }
}

export function getAwsCapabilitySnapshot(region: string, subjects?: AwsCapabilitySubject[]): AwsCapabilitySnapshot {
  const normalizedRegion = normalizeRegion(region)
  const targetSubjects: AwsCapabilitySubject[] = subjects?.length
    ? subjects
    : ['billing', 'organizations', 'route53-domains', 'local-zones']

  return {
    region: normalizedRegion,
    generatedAt: new Date().toISOString(),
    hints: targetSubjects
      .map((subject) => buildHint(subject, normalizedRegion))
      .filter((hint): hint is AwsCapabilityHint => Boolean(hint))
  }
}
