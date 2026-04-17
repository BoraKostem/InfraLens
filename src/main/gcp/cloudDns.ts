/**
 * Cloud DNS wrappers — managed zones, record sets, CRUD. Extracted verbatim
 * from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpDnsManagedZoneSummary,
  GcpDnsRecordUpsertInput,
  GcpDnsResourceRecordSetSummary
} from '@shared/types'

import { requestGcp } from './client'
import { asString, buildGcpSdkError, normalizeNumber } from './shared'

function buildDnsApiUrl(projectId: string, pathname: string): string {
  const normalizedPath = pathname.replace(/^\/+/, '')
  return `https://dns.googleapis.com/dns/v1/projects/${encodeURIComponent(projectId)}/${normalizedPath}`
}

export async function listGcpDnsManagedZones(projectId: string): Promise<GcpDnsManagedZoneSummary[]> {
  try {
    const zones: GcpDnsManagedZoneSummary[] = []
    let pageToken: string | undefined

    while (true) {
      const url = pageToken
        ? `${buildDnsApiUrl(projectId, 'managedZones')}?pageToken=${encodeURIComponent(pageToken)}`
        : buildDnsApiUrl(projectId, 'managedZones')

      const response = await requestGcp<{ managedZones?: Record<string, unknown>[]; nextPageToken?: string }>(projectId, { url })

      for (const z of response.managedZones ?? []) {
        const dnssecConfig = (z.dnssecConfig ?? {}) as Record<string, unknown>
        zones.push({
          name: asString(z.name),
          dnsName: asString(z.dnsName),
          description: asString(z.description),
          id: String(z.id ?? ''),
          visibility: asString(z.visibility) || 'public',
          dnssecState: asString(dnssecConfig.state) || 'off',
          nameServers: Array.isArray(z.nameServers) ? (z.nameServers as string[]) : [],
          creationTime: asString(z.creationTime)
        })
      }

      if (!response.nextPageToken) break
      pageToken = response.nextPageToken
    }

    return zones.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw buildGcpSdkError('listing Cloud DNS managed zones', error, 'dns.googleapis.com')
  }
}

export async function listGcpDnsResourceRecordSets(projectId: string, managedZone: string): Promise<GcpDnsResourceRecordSetSummary[]> {
  try {
    const records: GcpDnsResourceRecordSetSummary[] = []
    let pageToken: string | undefined

    while (true) {
      const url = pageToken
        ? `${buildDnsApiUrl(projectId, `managedZones/${encodeURIComponent(managedZone)}/rrsets`)}?pageToken=${encodeURIComponent(pageToken)}`
        : buildDnsApiUrl(projectId, `managedZones/${encodeURIComponent(managedZone)}/rrsets`)

      const response = await requestGcp<{ rrsets?: Record<string, unknown>[]; nextPageToken?: string }>(projectId, { url })

      for (const r of response.rrsets ?? []) {
        records.push({
          name: asString(r.name),
          type: asString(r.type),
          ttl: normalizeNumber(r.ttl),
          rrdatas: Array.isArray(r.rrdatas) ? (r.rrdatas as string[]) : [],
          signatureRrdatas: Array.isArray(r.signatureRrdatas) ? (r.signatureRrdatas as string[]) : []
        })
      }

      if (!response.nextPageToken) break
      pageToken = response.nextPageToken
    }

    return records
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud DNS record sets for zone "${managedZone}"`, error, 'dns.googleapis.com')
  }
}

export async function createGcpDnsResourceRecordSet(projectId: string, managedZone: string, input: GcpDnsRecordUpsertInput): Promise<void> {
  try {
    await requestGcp(projectId, {
      url: buildDnsApiUrl(projectId, `managedZones/${encodeURIComponent(managedZone)}/rrsets`),
      method: 'POST',
      data: {
        name: input.name,
        type: input.type,
        ttl: input.ttl,
        rrdatas: input.rrdatas
      }
    })
  } catch (error) {
    throw buildGcpSdkError(`creating Cloud DNS record set "${input.name}" (${input.type})`, error, 'dns.googleapis.com')
  }
}

export async function updateGcpDnsResourceRecordSet(projectId: string, managedZone: string, input: GcpDnsRecordUpsertInput): Promise<void> {
  try {
    await requestGcp(projectId, {
      url: buildDnsApiUrl(projectId, `managedZones/${encodeURIComponent(managedZone)}/rrsets/${encodeURIComponent(input.name)}/${encodeURIComponent(input.type)}`),
      method: 'PATCH',
      data: {
        ttl: input.ttl,
        rrdatas: input.rrdatas
      }
    })
  } catch (error) {
    throw buildGcpSdkError(`updating Cloud DNS record set "${input.name}" (${input.type})`, error, 'dns.googleapis.com')
  }
}

export async function deleteGcpDnsResourceRecordSet(projectId: string, managedZone: string, name: string, type: string): Promise<void> {
  try {
    await requestGcp(projectId, {
      url: buildDnsApiUrl(projectId, `managedZones/${encodeURIComponent(managedZone)}/rrsets/${encodeURIComponent(name)}/${encodeURIComponent(type)}`),
      method: 'DELETE'
    })
  } catch (error) {
    throw buildGcpSdkError(`deleting Cloud DNS record set "${name}" (${type})`, error, 'dns.googleapis.com')
  }
}
