/**
 * VPC networking wrappers — firewall rules, networks, subnetworks, routers,
 * global addresses, service networking connections. Extracted verbatim from
 * gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpFirewallRuleSummary,
  GcpGlobalAddressSummary,
  GcpNetworkSummary,
  GcpRouterNatSummary,
  GcpRouterSummary,
  GcpServiceNetworkingConnectionSummary,
  GcpSubnetworkSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asString,
  buildComputeApiUrl,
  buildGcpSdkError,
  filterRoutersByLocation,
  filterSubnetworksByLocation,
  normalizeFirewallRule,
  normalizeGlobalAddress,
  normalizeNetwork,
  normalizeRouter,
  normalizeRouterNat,
  normalizeServiceNetworkingConnection,
  normalizeSubnetwork,
  resourceBasename,
  toRecord
} from './shared'

export async function listGcpFirewallRules(projectId: string): Promise<GcpFirewallRuleSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const items: GcpFirewallRuleSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: unknown[]; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'global/firewalls', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      items.push(
        ...(response.items ?? [])
          .map((entry) => normalizeFirewallRule(entry))
          .filter((entry): entry is GcpFirewallRuleSummary => entry !== null)
      )

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing firewall rules for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpNetworks(projectId: string): Promise<GcpNetworkSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const items: GcpNetworkSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: unknown[]; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'global/networks', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      items.push(
        ...(response.items ?? [])
          .map((entry) => normalizeNetwork(entry))
          .filter((entry): entry is GcpNetworkSummary => entry !== null)
      )

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing VPC networks for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpSubnetworks(projectId: string, location: string): Promise<GcpSubnetworkSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const items: GcpSubnetworkSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { subnetworks?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/subnetworks', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.subnetworks ?? []) {
          const normalized = normalizeSubnetwork(entry)
          if (normalized) {
            items.push(normalized)
          }
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return filterSubnetworksByLocation(items, location)
      .sort((left, right) => left.region.localeCompare(right.region) || left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing subnetworks for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpRouters(projectId: string, location: string): Promise<{ routers: GcpRouterSummary[]; nats: GcpRouterNatSummary[] }> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return { routers: [], nats: [] }
  }

  try {
    const routers: GcpRouterSummary[] = []
    const nats: GcpRouterNatSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: Record<string, { routers?: unknown[] }>; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'aggregated/routers', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const scoped of Object.values(response.items ?? {})) {
        for (const entry of scoped?.routers ?? []) {
          const router = normalizeRouter(entry)
          if (!router) {
            continue
          }

          routers.push(router)
          const record = toRecord(entry)
          for (const natEntry of Array.isArray(record.nats) ? record.nats : []) {
            const nat = normalizeRouterNat(natEntry, router.name, router.region)
            if (nat) {
              nats.push(nat)
            }
          }
        }
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return {
      routers: filterRoutersByLocation(routers, location)
        .sort((left, right) => left.region.localeCompare(right.region) || left.name.localeCompare(right.name)),
      nats: filterRoutersByLocation(nats, location)
        .sort((left, right) => left.region.localeCompare(right.region) || left.router.localeCompare(right.router) || left.name.localeCompare(right.name))
    }
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Routers for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpGlobalAddresses(projectId: string): Promise<GcpGlobalAddressSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return []
  }

  try {
    const items: GcpGlobalAddressSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<{ items?: unknown[]; nextPageToken?: string }>(normalizedProjectId, {
        url: buildComputeApiUrl(normalizedProjectId, 'global/addresses', {
          maxResults: 500,
          pageToken: pageToken || undefined
        })
      })

      items.push(
        ...(response.items ?? [])
          .map((entry) => normalizeGlobalAddress(entry))
          .filter((entry): entry is GcpGlobalAddressSummary => entry !== null)
      )

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return items.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    throw buildGcpSdkError(`listing global addresses for project "${normalizedProjectId}"`, error, 'compute.googleapis.com')
  }
}

export async function listGcpServiceNetworkingConnections(projectId: string, networkNames: string[]): Promise<GcpServiceNetworkingConnectionSummary[]> {
  const normalizedProjectId = projectId.trim()
  const targets = [...new Set(networkNames.map((value) => resourceBasename(value)).filter(Boolean))]
  if (!normalizedProjectId || targets.length === 0) {
    return []
  }

  try {
    const items: GcpServiceNetworkingConnectionSummary[] = []

    for (const networkName of targets) {
      const response = await requestGcp<{ connections?: unknown[] }>(normalizedProjectId, {
        url: `https://servicenetworking.googleapis.com/v1/services/servicenetworking.googleapis.com/connections?network=${encodeURIComponent(`projects/${normalizedProjectId}/global/networks/${networkName}`)}`
      })

      items.push(
        ...(response.connections ?? [])
          .map((entry) => normalizeServiceNetworkingConnection(entry, networkName))
          .filter((entry): entry is GcpServiceNetworkingConnectionSummary => entry !== null)
      )
    }

    return items.sort((left, right) => left.network.localeCompare(right.network) || left.service.localeCompare(right.service))
  } catch (error) {
    throw buildGcpSdkError(`listing service networking connections for project "${normalizedProjectId}"`, error, 'servicenetworking.googleapis.com')
  }
}
