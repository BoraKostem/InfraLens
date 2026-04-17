/**
 * Load Balancer + Cloud Armor wrappers — URL maps, backend services,
 * forwarding rules, health checks, security policies. Extracted verbatim
 * from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpBackendServiceSummary,
  GcpForwardingRuleSummary,
  GcpHealthCheckSummary,
  GcpSecurityPolicyDetail,
  GcpSecurityPolicySummary,
  GcpUrlMapDetail,
  GcpUrlMapSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asBoolean,
  asString,
  buildComputeApiUrl,
  buildGcpSdkError,
  normalizeNumber,
  toRecord
} from './shared'

export async function listGcpUrlMaps(projectId: string): Promise<GcpUrlMapSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const items: GcpUrlMapSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { urlMaps?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/urlMaps', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.urlMaps ?? []) {
          const record = toRecord(entry)
          if (!record) continue
          const selfLink = asString(record.selfLink)
          const regionMatch = selfLink.match(/\/regions\/([^/]+)\//)
          items.push({
            name: asString(record.name),
            description: asString(record.description),
            selfLink,
            defaultService: asString(record.defaultService),
            hostRuleCount: Array.isArray(record.hostRules) ? record.hostRules.length : 0,
            pathMatcherCount: Array.isArray(record.pathMatchers) ? record.pathMatchers.length : 0,
            creationTimestamp: asString(record.creationTimestamp),
            region: regionMatch ? regionMatch[1] : '',
            fingerprint: asString(record.fingerprint)
          })
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError(`listing URL maps for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function getGcpUrlMapDetail(projectId: string, urlMapName: string, region?: string): Promise<GcpUrlMapDetail> {
  const normalizedProjectId = projectId.trim()
  const path = region
    ? `regions/${encodeURIComponent(region)}/urlMaps/${encodeURIComponent(urlMapName)}`
    : `global/urlMaps/${encodeURIComponent(urlMapName)}`

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildComputeApiUrl(normalizedProjectId, path)
    })

    return {
      name: asString(response.name),
      description: asString(response.description),
      selfLink: asString(response.selfLink),
      defaultService: asString(response.defaultService),
      hostRules: Array.isArray(response.hostRules)
        ? (response.hostRules as Array<Record<string, unknown>>).map((hr) => ({
            hosts: Array.isArray(hr.hosts) ? (hr.hosts as string[]) : [],
            pathMatcher: asString(hr.pathMatcher)
          }))
        : [],
      pathMatchers: Array.isArray(response.pathMatchers)
        ? (response.pathMatchers as Array<Record<string, unknown>>).map((pm) => ({
            name: asString(pm.name),
            defaultService: asString(pm.defaultService),
            pathRules: Array.isArray(pm.pathRules)
              ? (pm.pathRules as Array<Record<string, unknown>>).map((pr) => ({
                  paths: Array.isArray(pr.paths) ? (pr.paths as string[]) : [],
                  service: asString(pr.service)
                }))
              : []
          }))
        : [],
      creationTimestamp: asString(response.creationTimestamp),
      fingerprint: asString(response.fingerprint)
    }
  } catch (error) {
    throw buildGcpSdkError(`getting URL map detail for "${urlMapName}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpBackendServices(projectId: string): Promise<GcpBackendServiceSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const items: GcpBackendServiceSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { backendServices?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/backendServices', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.backendServices ?? []) {
          const record = toRecord(entry)
          if (!record) continue
          const selfLink = asString(record.selfLink)
          const regionMatch = selfLink.match(/\/regions\/([^/]+)\//)
          items.push({
            name: asString(record.name),
            description: asString(record.description),
            selfLink,
            protocol: asString(record.protocol),
            port: normalizeNumber(record.port),
            portName: asString(record.portName),
            timeoutSec: normalizeNumber(record.timeoutSec),
            healthChecks: Array.isArray(record.healthChecks) ? (record.healthChecks as string[]) : [],
            backendsCount: Array.isArray(record.backends) ? record.backends.length : 0,
            loadBalancingScheme: asString(record.loadBalancingScheme),
            sessionAffinity: asString(record.sessionAffinity),
            region: regionMatch ? regionMatch[1] : '',
            creationTimestamp: asString(record.creationTimestamp),
            securityPolicy: asString(record.securityPolicy)
          })
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError(`listing backend services for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpForwardingRules(projectId: string): Promise<GcpForwardingRuleSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const items: GcpForwardingRuleSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { forwardingRules?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/forwardingRules', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.forwardingRules ?? []) {
          const record = toRecord(entry)
          if (!record) continue
          const selfLink = asString(record.selfLink)
          const regionMatch = selfLink.match(/\/regions\/([^/]+)\//)
          items.push({
            name: asString(record.name),
            description: asString(record.description),
            selfLink,
            IPAddress: asString(record.IPAddress),
            IPProtocol: asString(record.IPProtocol),
            portRange: asString(record.portRange),
            target: asString(record.target),
            loadBalancingScheme: asString(record.loadBalancingScheme),
            network: asString(record.network),
            region: regionMatch ? regionMatch[1] : '',
            creationTimestamp: asString(record.creationTimestamp)
          })
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError(`listing forwarding rules for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpHealthChecks(projectId: string): Promise<GcpHealthCheckSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const items: GcpHealthCheckSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { healthChecks?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/healthChecks', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.healthChecks ?? []) {
          const record = toRecord(entry)
          if (!record) continue
          items.push({
            name: asString(record.name),
            description: asString(record.description),
            selfLink: asString(record.selfLink),
            type: asString(record.type),
            checkIntervalSec: normalizeNumber(record.checkIntervalSec),
            timeoutSec: normalizeNumber(record.timeoutSec),
            unhealthyThreshold: normalizeNumber(record.unhealthyThreshold),
            healthyThreshold: normalizeNumber(record.healthyThreshold),
            creationTimestamp: asString(record.creationTimestamp)
          })
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError(`listing health checks for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpSecurityPolicies(projectId: string): Promise<GcpSecurityPolicySummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const items: GcpSecurityPolicySummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: unknown[]; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'global/securityPolicies', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of response.items ?? []) {
        const record = toRecord(entry)
        if (!record) continue
        const adaptiveRaw = toRecord(record.adaptiveProtectionConfig)
        items.push({
          name: asString(record.name),
          description: asString(record.description),
          selfLink: asString(record.selfLink),
          type: asString(record.type),
          ruleCount: Array.isArray(record.rules) ? record.rules.length : 0,
          adaptiveProtection: adaptiveRaw
            ? asBoolean((toRecord(adaptiveRaw.layer7DdosDefenseConfig) ?? {}).enable)
            : false,
          creationTimestamp: asString(record.creationTimestamp),
          fingerprint: asString(record.fingerprint)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError(`listing security policies for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function getGcpSecurityPolicyDetail(projectId: string, policyName: string): Promise<GcpSecurityPolicyDetail> {
  const normalizedProjectId = projectId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildComputeApiUrl(normalizedProjectId, `global/securityPolicies/${encodeURIComponent(policyName)}`)
    })

    const adaptiveRaw = toRecord(response.adaptiveProtectionConfig)
    const l7Raw = adaptiveRaw ? toRecord(adaptiveRaw.layer7DdosDefenseConfig) : null

    return {
      name: asString(response.name),
      description: asString(response.description),
      selfLink: asString(response.selfLink),
      type: asString(response.type),
      rules: Array.isArray(response.rules)
        ? (response.rules as Array<Record<string, unknown>>).map((r) => {
            const matchRaw = toRecord(r.match)
            const configRaw = matchRaw ? toRecord(matchRaw.config) : null
            return {
              priority: normalizeNumber(r.priority),
              action: asString(r.action),
              description: asString(r.description),
              match: matchRaw
                ? {
                    versionedExpr: asString(matchRaw.versionedExpr),
                    config: {
                      srcIpRanges: configRaw && Array.isArray(configRaw.srcIpRanges)
                        ? (configRaw.srcIpRanges as string[])
                        : []
                    }
                  }
                : null,
              preview: asBoolean(r.preview)
            }
          })
        : [],
      adaptiveProtectionConfig: adaptiveRaw
        ? {
            enabled: l7Raw ? asBoolean(l7Raw.enable) : false,
            layer7DdosDefenseConfig: l7Raw
              ? { enable: asBoolean(l7Raw.enable), ruleVisibility: asString(l7Raw.ruleVisibility) }
              : null
          }
        : null,
      ddosProtectionConfig: asString(response.ddosProtectionConfig),
      fingerprint: asString(response.fingerprint),
      creationTimestamp: asString(response.creationTimestamp)
    }
  } catch (error) {
    throw buildGcpSdkError(`getting security policy detail for "${policyName}"`, error, 'compute.googleapis.com')
  }
}
