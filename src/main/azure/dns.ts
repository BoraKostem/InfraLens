/**
 * Azure DNS — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureDnsZoneSummary,
  AzureDnsRecordSummary,
  AzureDnsRecordUpsertInput
} from '@shared/types'

const enc = encodeURIComponent
const DNS_API_VERSION = '2018-05-01'

function flattenDnsRecordValues(type: string, props: Record<string, unknown>): string[] {
  switch (type) {
    case 'A':
      return ((props.ARecords ?? []) as Array<Record<string, unknown>>).map((r) => String(r.ipv4Address ?? ''))
    case 'AAAA':
      return ((props.AAAARecords ?? []) as Array<Record<string, unknown>>).map((r) => String(r.ipv6Address ?? ''))
    case 'CNAME': {
      const cname = (props.CNAMERecord ?? null) as Record<string, unknown> | null
      return cname ? [String(cname.cname ?? '')] : []
    }
    case 'MX':
      return ((props.MXRecords ?? []) as Array<Record<string, unknown>>).map((r) => `${r.preference ?? 0} ${r.exchange ?? ''}`)
    case 'NS':
      return ((props.NSRecords ?? []) as Array<Record<string, unknown>>).map((r) => String(r.nsdname ?? ''))
    case 'TXT':
      return ((props.TXTRecords ?? []) as Array<Record<string, unknown>>).flatMap((r) => ((r.value ?? []) as string[]))
    case 'SRV':
      return ((props.SRVRecords ?? []) as Array<Record<string, unknown>>).map((r) => `${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${r.target ?? ''}`)
    case 'CAA':
      return ((props.caaRecords ?? []) as Array<Record<string, unknown>>).map((r) => `${r.flags ?? 0} ${r.tag ?? ''} "${r.value ?? ''}"`)
    case 'PTR':
      return ((props.PTRRecords ?? []) as Array<Record<string, unknown>>).map((r) => String(r.ptrdname ?? ''))
    case 'SOA': {
      const soa = (props.SOARecord ?? null) as Record<string, unknown> | null
      return soa ? [`${soa.host ?? ''} ${soa.email ?? ''} ${soa.serialNumber ?? 0} ${soa.refreshTime ?? 0} ${soa.retryTime ?? 0} ${soa.expireTime ?? 0} ${soa.minimumTTL ?? 0}`] : []
    }
    default:
      return []
  }
}

function buildDnsRecordProperties(type: string, values: string[]): Record<string, unknown> {
  switch (type) {
    case 'A':
      return { ARecords: values.map((v) => ({ ipv4Address: v.trim() })) }
    case 'AAAA':
      return { AAAARecords: values.map((v) => ({ ipv6Address: v.trim() })) }
    case 'CNAME':
      return { CNAMERecord: { cname: values[0]?.trim() ?? '' } }
    case 'MX':
      return {
        MXRecords: values.map((v) => {
          const parts = v.trim().split(/\s+/, 2)
          return { preference: Number(parts[0]) || 0, exchange: parts[1] ?? '' }
        })
      }
    case 'NS':
      return { NSRecords: values.map((v) => ({ nsdname: v.trim() })) }
    case 'TXT':
      return { TXTRecords: values.map((v) => ({ value: [v.trim()] })) }
    case 'SRV':
      return {
        SRVRecords: values.map((v) => {
          const parts = v.trim().split(/\s+/, 4)
          return { priority: Number(parts[0]) || 0, weight: Number(parts[1]) || 0, port: Number(parts[2]) || 0, target: parts[3] ?? '' }
        })
      }
    case 'CAA':
      return {
        caaRecords: values.map((v) => {
          const match = v.trim().match(/^(\d+)\s+(\S+)\s+"?(.*?)"?$/)
          return { flags: Number(match?.[1]) || 0, tag: match?.[2] ?? '', value: match?.[3] ?? '' }
        })
      }
    case 'PTR':
      return { PTRRecords: values.map((v) => ({ ptrdname: v.trim() })) }
    default:
      return {}
  }
}

function extractDnsRecordType(armType: string): string {
  const parts = armType.split('/')
  return parts[parts.length - 1] ?? armType
}

export async function listAzureDnsZones(subscriptionId: string, _location: string): Promise<AzureDnsZoneSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Network/dnsZones`,
    DNS_API_VERSION
  )
  return raw.map((z) => {
    const props = (z.properties ?? {}) as Record<string, unknown>
    const tags = (z.tags ?? {}) as Record<string, string>
    return {
      id: String(z.id ?? ''),
      name: String(z.name ?? ''),
      resourceGroup: extractResourceGroup(String(z.id ?? '')),
      location: String(z.location ?? 'global'),
      numberOfRecordSets: Number(props.numberOfRecordSets ?? 0),
      maxNumberOfRecordSets: Number(props.maxNumberOfRecordSets ?? 0),
      nameServers: ((props.nameServers ?? []) as string[]),
      zoneType: String(props.zoneType ?? 'Public'),
      tags
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listAzureDnsRecordSets(subscriptionId: string, resourceGroup: string, zoneName: string): Promise<AzureDnsRecordSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/dnsZones/${enc(zoneName)}/recordSets`,
    DNS_API_VERSION
  )
  return raw.map((r) => {
    const props = (r.properties ?? {}) as Record<string, unknown>
    const type = extractDnsRecordType(String(r.type ?? ''))
    const metadata = (props.metadata ?? {}) as Record<string, string>
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      fqdn: String(props.fqdn ?? ''),
      type,
      ttl: Number(props.TTL ?? 0),
      values: flattenDnsRecordValues(type, props),
      metadata
    }
  })
}

export async function upsertAzureDnsRecord(subscriptionId: string, resourceGroup: string, zoneName: string, input: AzureDnsRecordUpsertInput): Promise<void> {
  const name = input.name.trim() || '@'
  const type = input.type.trim().toUpperCase()
  const path = `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/dnsZones/${enc(zoneName)}/${type}/${enc(name)}`
  await fetchAzureArmJson(path, DNS_API_VERSION, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        TTL: input.ttl,
        ...buildDnsRecordProperties(type, input.values.filter(Boolean))
      }
    })
  })
}

export async function deleteAzureDnsRecord(subscriptionId: string, resourceGroup: string, zoneName: string, recordType: string, recordName: string): Promise<void> {
  const path = `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/dnsZones/${enc(zoneName)}/${enc(recordType)}/${enc(recordName)}`
  await fetchAzureArmJson(path, DNS_API_VERSION, { method: 'DELETE' })
}

export async function createAzureDnsZone(subscriptionId: string, resourceGroup: string, zoneName: string, zoneType: 'Public' | 'Private'): Promise<AzureDnsZoneSummary> {
  const path = `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/dnsZones/${enc(zoneName)}`
  const result = await fetchAzureArmJson<Record<string, unknown>>(path, DNS_API_VERSION, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'global',
      properties: { zoneType }
    })
  })
  const props = (result.properties ?? {}) as Record<string, unknown>
  return {
    id: String(result.id ?? ''),
    name: String(result.name ?? zoneName),
    resourceGroup,
    location: 'global',
    numberOfRecordSets: Number(props.numberOfRecordSets ?? 0),
    maxNumberOfRecordSets: Number(props.maxNumberOfRecordSets ?? 0),
    nameServers: ((props.nameServers ?? []) as string[]),
    zoneType: String(props.zoneType ?? zoneType),
    tags: (result.tags ?? {}) as Record<string, string>
  }
}
