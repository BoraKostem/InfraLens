/**
 * Azure Firewall — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { extractResourceGroup } from './shared'
import type {
  AzureFirewallSummary,
  AzureFirewallIpConfiguration,
  AzureFirewallRuleCollection,
  AzureFirewallDetail
} from '@shared/types'

const enc = encodeURIComponent

export async function listAzureFirewalls(subscriptionId: string, location: string): Promise<AzureFirewallSummary[]> {
  const raw = await fetchAzureArmCollection<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/providers/Microsoft.Network/azureFirewalls`,
    '2023-11-01'
  )
  const all: AzureFirewallSummary[] = raw.map((fw) => {
    const props = (fw.properties ?? {}) as Record<string, unknown>
    const sku = (props.sku ?? {}) as Record<string, unknown>
    const policyId = String(((props.firewallPolicy ?? {}) as Record<string, unknown>).id ?? '')
    return {
      id: String(fw.id ?? ''),
      name: String(fw.name ?? ''),
      resourceGroup: extractResourceGroup(String(fw.id ?? '')),
      location: String(fw.location ?? ''),
      skuName: String(sku.name ?? ''),
      skuTier: String(sku.tier ?? ''),
      threatIntelMode: String(props.threatIntelMode ?? ''),
      provisioningState: String(props.provisioningState ?? ''),
      firewallPolicyId: policyId,
      ipConfigurationCount: Array.isArray(props.ipConfigurations) ? props.ipConfigurations.length : 0,
      networkRuleCollectionCount: Array.isArray(props.networkRuleCollections) ? props.networkRuleCollections.length : 0,
      applicationRuleCollectionCount: Array.isArray(props.applicationRuleCollections) ? props.applicationRuleCollections.length : 0,
      natRuleCollectionCount: Array.isArray(props.natRuleCollections) ? props.natRuleCollections.length : 0
    }
  })
  const loc = location.trim().toLowerCase().replace(/\s/g, '')
  return loc ? all.filter((fw) => fw.location.toLowerCase().replace(/\s/g, '') === loc) : all
}

export async function describeAzureFirewall(subscriptionId: string, resourceGroup: string, firewallName: string): Promise<AzureFirewallDetail> {
  const raw = await fetchAzureArmJson<Record<string, unknown>>(
    `/subscriptions/${enc(subscriptionId)}/resourceGroups/${enc(resourceGroup)}/providers/Microsoft.Network/azureFirewalls/${enc(firewallName)}`,
    '2023-11-01'
  )
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const sku = (props.sku ?? {}) as Record<string, unknown>
  const policyId = String(((props.firewallPolicy ?? {}) as Record<string, unknown>).id ?? '')

  const summary: AzureFirewallSummary = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    resourceGroup: extractResourceGroup(String(raw.id ?? '')),
    location: String(raw.location ?? ''),
    skuName: String(sku.name ?? ''),
    skuTier: String(sku.tier ?? ''),
    threatIntelMode: String(props.threatIntelMode ?? ''),
    provisioningState: String(props.provisioningState ?? ''),
    firewallPolicyId: policyId,
    ipConfigurationCount: Array.isArray(props.ipConfigurations) ? props.ipConfigurations.length : 0,
    networkRuleCollectionCount: Array.isArray(props.networkRuleCollections) ? props.networkRuleCollections.length : 0,
    applicationRuleCollectionCount: Array.isArray(props.applicationRuleCollections) ? props.applicationRuleCollections.length : 0,
    natRuleCollectionCount: Array.isArray(props.natRuleCollections) ? props.natRuleCollections.length : 0
  }

  const ipConfigurations: AzureFirewallIpConfiguration[] = (Array.isArray(props.ipConfigurations) ? props.ipConfigurations : []).map((cfg: Record<string, unknown>) => {
    const cfgProps = (cfg.properties ?? {}) as Record<string, unknown>
    return {
      name: String(cfg.name ?? ''),
      privateIPAddress: String(cfgProps.privateIPAddress ?? ''),
      publicIPAddressId: String(((cfgProps.publicIPAddress ?? {}) as Record<string, unknown>).id ?? ''),
      subnetId: String(((cfgProps.subnet ?? {}) as Record<string, unknown>).id ?? ''),
      provisioningState: String(cfgProps.provisioningState ?? '')
    }
  })

  const ruleCollections: AzureFirewallRuleCollection[] = []
  for (const kind of ['networkRuleCollections', 'applicationRuleCollections', 'natRuleCollections'] as const) {
    const label = kind === 'networkRuleCollections' ? 'Network' : kind === 'applicationRuleCollections' ? 'Application' : 'NAT'
    const arr = Array.isArray(props[kind]) ? (props[kind] as Record<string, unknown>[]) : []
    for (const rc of arr) {
      const rcProps = (rc.properties ?? {}) as Record<string, unknown>
      const actionObj = (rcProps.action ?? {}) as Record<string, unknown>
      ruleCollections.push({
        name: String(rc.name ?? ''),
        kind: label,
        priority: Number(rcProps.priority ?? 0),
        action: String(actionObj.type ?? ''),
        ruleCount: Array.isArray(rcProps.rules) ? rcProps.rules.length : 0,
        provisioningState: String(rcProps.provisioningState ?? '')
      })
    }
  }
  ruleCollections.sort((a, b) => a.priority - b.priority)

  return { summary, ipConfigurations, ruleCollections }
}
