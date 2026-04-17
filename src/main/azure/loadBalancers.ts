/**
 * Azure Load Balancers — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureLoadBalancerSummary,
  AzureLoadBalancerFrontendIp,
  AzureLoadBalancerBackendPool,
  AzureLoadBalancerRule,
  AzureLoadBalancerProbe,
  AzureLoadBalancerInboundNatRule,
  AzureLoadBalancerDetail
} from '@shared/types'

const enc = encodeURIComponent

function extractNameFromId(armId: string): string {
  if (!armId) return ''
  const parts = armId.split('/')
  return parts[parts.length - 1] ?? ''
}

export async function listAzureLoadBalancers(subscriptionId: string, location: string): Promise<AzureLoadBalancerSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Network/loadBalancers`,
    '2023-11-01'
  )
  const all: AzureLoadBalancerSummary[] = raw.map((lb) => {
    const props = (lb.properties ?? {}) as Record<string, unknown>
    const sku = (lb.sku ?? {}) as Record<string, unknown>
    return {
      id: String(lb.id ?? ''),
      name: String(lb.name ?? ''),
      resourceGroup: extractResourceGroup(String(lb.id ?? '')),
      location: String(lb.location ?? ''),
      skuName: String(sku.name ?? ''),
      skuTier: String(sku.tier ?? ''),
      frontendIpCount: Array.isArray(props.frontendIPConfigurations) ? props.frontendIPConfigurations.length : 0,
      backendPoolCount: Array.isArray(props.backendAddressPools) ? props.backendAddressPools.length : 0,
      ruleCount: Array.isArray(props.loadBalancingRules) ? props.loadBalancingRules.length : 0,
      probeCount: Array.isArray(props.probes) ? props.probes.length : 0,
      provisioningState: String(props.provisioningState ?? '')
    }
  })
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return loc ? all.filter((lb) => lb.location.toLowerCase().replace(/\s/g, '') === loc) : all
}

export async function describeAzureLoadBalancer(subscriptionId: string, resourceGroup: string, lbName: string): Promise<AzureLoadBalancerDetail> {
  const raw = await fetchAzureArmJson<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/loadBalancers/${enc(lbName)}`,
    '2023-11-01'
  )
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const sku = (raw.sku ?? {}) as Record<string, unknown>

  const summary: AzureLoadBalancerSummary = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    resourceGroup: extractResourceGroup(String(raw.id ?? '')),
    location: String(raw.location ?? ''),
    skuName: String(sku.name ?? ''),
    skuTier: String(sku.tier ?? ''),
    frontendIpCount: Array.isArray(props.frontendIPConfigurations) ? props.frontendIPConfigurations.length : 0,
    backendPoolCount: Array.isArray(props.backendAddressPools) ? props.backendAddressPools.length : 0,
    ruleCount: Array.isArray(props.loadBalancingRules) ? props.loadBalancingRules.length : 0,
    probeCount: Array.isArray(props.probes) ? props.probes.length : 0,
    provisioningState: String(props.provisioningState ?? '')
  }

  const frontendIpConfigurations: AzureLoadBalancerFrontendIp[] = (Array.isArray(props.frontendIPConfigurations) ? props.frontendIPConfigurations : []).map((fe: Record<string, unknown>) => {
    const feProps = (fe.properties ?? {}) as Record<string, unknown>
    return {
      name: String(fe.name ?? ''),
      privateIPAddress: String(feProps.privateIPAddress ?? ''),
      privateIPAllocationMethod: String(feProps.privateIPAllocationMethod ?? ''),
      publicIPAddressId: String(((feProps.publicIPAddress ?? {}) as Record<string, unknown>).id ?? ''),
      subnetId: String(((feProps.subnet ?? {}) as Record<string, unknown>).id ?? ''),
      provisioningState: String(feProps.provisioningState ?? ''),
      zones: Array.isArray(fe.zones) ? (fe.zones as string[]) : []
    }
  })

  const backendPools: AzureLoadBalancerBackendPool[] = (Array.isArray(props.backendAddressPools) ? props.backendAddressPools : []).map((bp: Record<string, unknown>) => {
    const bpProps = (bp.properties ?? {}) as Record<string, unknown>
    const addresses = Array.isArray(bpProps.loadBalancerBackendAddresses) ? bpProps.loadBalancerBackendAddresses : (Array.isArray(bpProps.backendIPConfigurations) ? bpProps.backendIPConfigurations : [])
    return {
      name: String(bp.name ?? ''),
      backendAddressCount: addresses.length,
      provisioningState: String(bpProps.provisioningState ?? '')
    }
  })

  const rules: AzureLoadBalancerRule[] = (Array.isArray(props.loadBalancingRules) ? props.loadBalancingRules : []).map((r: Record<string, unknown>) => {
    const rProps = (r.properties ?? {}) as Record<string, unknown>
    return {
      name: String(r.name ?? ''),
      protocol: String(rProps.protocol ?? ''),
      frontendPort: Number(rProps.frontendPort ?? 0),
      backendPort: Number(rProps.backendPort ?? 0),
      frontendIPConfigurationName: extractNameFromId(String(((rProps.frontendIPConfiguration ?? {}) as Record<string, unknown>).id ?? '')),
      backendAddressPoolName: extractNameFromId(String(((rProps.backendAddressPool ?? {}) as Record<string, unknown>).id ?? '')),
      probeName: extractNameFromId(String(((rProps.probe ?? {}) as Record<string, unknown>).id ?? '')),
      enableFloatingIP: Boolean(rProps.enableFloatingIP ?? false),
      idleTimeoutInMinutes: Number(rProps.idleTimeoutInMinutes ?? 0),
      loadDistribution: String(rProps.loadDistribution ?? ''),
      provisioningState: String(rProps.provisioningState ?? '')
    }
  })

  const probes: AzureLoadBalancerProbe[] = (Array.isArray(props.probes) ? props.probes : []).map((p: Record<string, unknown>) => {
    const pProps = (p.properties ?? {}) as Record<string, unknown>
    return {
      name: String(p.name ?? ''),
      protocol: String(pProps.protocol ?? ''),
      port: Number(pProps.port ?? 0),
      intervalInSeconds: Number(pProps.intervalInSeconds ?? 0),
      numberOfProbes: Number(pProps.numberOfProbes ?? 0),
      requestPath: String(pProps.requestPath ?? ''),
      provisioningState: String(pProps.provisioningState ?? '')
    }
  })

  const inboundNatRules: AzureLoadBalancerInboundNatRule[] = (Array.isArray(props.inboundNatRules) ? props.inboundNatRules : []).map((nr: Record<string, unknown>) => {
    const nrProps = (nr.properties ?? {}) as Record<string, unknown>
    return {
      name: String(nr.name ?? ''),
      protocol: String(nrProps.protocol ?? ''),
      frontendPort: Number(nrProps.frontendPort ?? 0),
      backendPort: Number(nrProps.backendPort ?? 0),
      frontendIPConfigurationName: extractNameFromId(String(((nrProps.frontendIPConfiguration ?? {}) as Record<string, unknown>).id ?? '')),
      enableFloatingIP: Boolean(nrProps.enableFloatingIP ?? false),
      idleTimeoutInMinutes: Number(nrProps.idleTimeoutInMinutes ?? 0),
      provisioningState: String(nrProps.provisioningState ?? '')
    }
  })

  return { summary, frontendIpConfigurations, backendPools, rules, probes, inboundNatRules }
}
