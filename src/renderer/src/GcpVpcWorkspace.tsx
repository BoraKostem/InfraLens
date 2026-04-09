import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  GcpFirewallRuleSummary,
  GcpGlobalAddressSummary,
  GcpNetworkSummary,
  GcpRouterNatSummary,
  GcpRouterSummary,
  GcpServiceNetworkingConnectionSummary,
  GcpSubnetworkSummary,
  ServiceId
} from '@shared/types'
import {
  listGcpFirewallRules,
  listGcpGlobalAddresses,
  listGcpNetworks,
  listGcpRouters,
  listGcpServiceNetworkingConnections,
  listGcpSubnetworks
} from './api'
import { SvcState } from './SvcState'
import './vpc.css'
import './gcp-vpc.css'

type GcpVpcTab = 'topology' | 'flow' | 'security' | 'gateways' | 'addresses'

const TABS: Array<{ id: GcpVpcTab; label: string }> = [
  { id: 'topology', label: 'Topology' },
  { id: 'flow', label: 'Architecture' },
  { id: 'security', label: 'Security' },
  { id: 'gateways', label: 'Gateways' },
  { id: 'addresses', label: 'Addresses' }
]

function summarizeNetworkMode(network: GcpNetworkSummary | null): { tone: 'success' | 'warning' | 'info'; label: string } {
  if (!network) {
    return { tone: 'info', label: 'No selection' }
  }

  if (network.autoCreateSubnetworks) {
    return { tone: 'warning', label: 'Auto mode' }
  }

  if ((network.routingMode || '').trim().toUpperCase() === 'GLOBAL') {
    return { tone: 'success', label: 'Custom / global routing' }
  }

  return { tone: 'info', label: 'Custom mode' }
}

function formatRoutingMode(network: GcpNetworkSummary): string {
  const routingMode = network.routingMode.trim().toUpperCase()
  return routingMode ? `${routingMode.toLowerCase()} routing` : 'routing mode unavailable'
}

function subnetworkAccessTone(subnetwork: GcpSubnetworkSummary): 'success' | 'info' {
  return subnetwork.privateIpGoogleAccess ? 'success' : 'info'
}

function filterSelected<T extends { network: string }>(items: T[], networkName: string): T[] {
  return items.filter((item) => item.network === networkName)
}

function GcpVpcArchitectureDiagram({
  network,
  subnetworks,
  routers,
  nats,
  serviceConnections,
  globalAddresses
}: {
  network: GcpNetworkSummary
  subnetworks: GcpSubnetworkSummary[]
  routers: GcpRouterSummary[]
  nats: GcpRouterNatSummary[]
  serviceConnections: GcpServiceNetworkingConnectionSummary[]
  globalAddresses: GcpGlobalAddressSummary[]
}) {
  const subnetworksByRegion = useMemo(() => {
    const grouped = new Map<string, GcpSubnetworkSummary[]>()

    for (const subnetwork of subnetworks) {
      const key = subnetwork.region || 'global'
      const current = grouped.get(key) ?? []
      current.push(subnetwork)
      grouped.set(key, current)
    }

    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [subnetworks])

  return (
    <div className="gcp-vpc-architecture">
      <div className="gcp-vpc-architecture-row">
        <div className="gcp-vpc-architecture-node gcp-vpc-architecture-node-edge">Google APIs / Internet edge</div>
      </div>
      <div className="gcp-vpc-architecture-arrow">↓</div>
      <div className="gcp-vpc-architecture-row">
        <div className="gcp-vpc-architecture-node gcp-vpc-architecture-node-core">
          <strong>{network.name}</strong>
          <span>{network.autoCreateSubnetworks ? 'Auto subnet mode' : 'Custom subnet mode'}</span>
          <small>{formatRoutingMode(network)}</small>
        </div>
      </div>
      <div className="gcp-vpc-architecture-arrow">↓</div>
      <div className="gcp-vpc-architecture-grid">
        {subnetworksByRegion.length === 0 ? (
          <div className="gcp-vpc-architecture-empty">No subnetworks were returned for this VPC.</div>
        ) : (
          subnetworksByRegion.map(([region, items]) => (
            <section key={region} className="gcp-vpc-architecture-column">
              <header>
                <strong>{region}</strong>
                <span>{items.length} subnetworks</span>
              </header>
              <div className="gcp-vpc-architecture-stack">
                {items.map((subnetwork) => (
                  <div key={subnetwork.name} className="gcp-vpc-architecture-node">
                    <strong>{subnetwork.name}</strong>
                    <span>{subnetwork.ipCidrRange || 'CIDR unavailable'}</span>
                    <small>{subnetwork.privateIpGoogleAccess ? 'Private Google Access enabled' : 'Private Google Access off'}</small>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <div className="gcp-vpc-architecture-arrow">↓</div>
      <div className="gcp-vpc-architecture-row gcp-vpc-architecture-row-wrap">
        {routers.map((router) => (
          <div key={router.name} className="gcp-vpc-architecture-node">
            <strong>Router: {router.name}</strong>
            <span>{router.region || 'region unavailable'}</span>
          </div>
        ))}
        {nats.map((nat) => (
          <div key={`${nat.router}:${nat.name}`} className="gcp-vpc-architecture-node gcp-vpc-architecture-node-accent">
            <strong>Cloud NAT: {nat.name}</strong>
            <span>{nat.router}</span>
            <small>{nat.natIpAllocateOption || 'allocation mode unavailable'}</small>
          </div>
        ))}
        {serviceConnections.map((connection) => (
          <div key={`${connection.service}:${connection.peering}`} className="gcp-vpc-architecture-node gcp-vpc-architecture-node-service">
            <strong>{connection.service}</strong>
            <span>{connection.peering || 'peering unavailable'}</span>
          </div>
        ))}
        {globalAddresses.map((address) => (
          <div key={address.name} className="gcp-vpc-architecture-node gcp-vpc-architecture-node-address">
            <strong>{address.name}</strong>
            <span>{address.address || 'address pending'}</span>
            <small>{address.purpose || address.addressType || 'global address'}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GcpVpcWorkspace({
  projectId,
  location,
  refreshNonce,
  focusNetworkName,
  onNavigate
}: {
  projectId: string
  location: string
  refreshNonce: number
  focusNetworkName?: { token: number; networkName: string } | null
  onNavigate: (service: ServiceId, resourceId?: string) => void
}) {
  const [tab, setTab] = useState<GcpVpcTab>('topology')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [networks, setNetworks] = useState<GcpNetworkSummary[]>([])
  const [selectedNetworkName, setSelectedNetworkName] = useState('')
  const [subnetworks, setSubnetworks] = useState<GcpSubnetworkSummary[]>([])
  const [firewallRules, setFirewallRules] = useState<GcpFirewallRuleSummary[]>([])
  const [routers, setRouters] = useState<GcpRouterSummary[]>([])
  const [nats, setNats] = useState<GcpRouterNatSummary[]>([])
  const [globalAddresses, setGlobalAddresses] = useState<GcpGlobalAddressSummary[]>([])
  const [serviceConnections, setServiceConnections] = useState<GcpServiceNetworkingConnectionSummary[]>([])
  const [loadingNetworkName, setLoadingNetworkName] = useState('')
  const loadRequestRef = useRef(0)
  const [appliedFocusToken, setAppliedFocusToken] = useState(0)

  const selectedNetwork = useMemo(
    () => networks.find((network) => network.name === selectedNetworkName) ?? null,
    [networks, selectedNetworkName]
  )
  const selectedSubnetworks = useMemo(
    () => filterSelected(subnetworks, selectedNetworkName),
    [selectedNetworkName, subnetworks]
  )
  const selectedFirewallRules = useMemo(
    () => filterSelected(firewallRules, selectedNetworkName),
    [firewallRules, selectedNetworkName]
  )
  const selectedRouters = useMemo(
    () => filterSelected(routers, selectedNetworkName),
    [routers, selectedNetworkName]
  )
  const selectedGlobalAddresses = useMemo(
    () => globalAddresses.filter((address) => !address.network || address.network === selectedNetworkName),
    [globalAddresses, selectedNetworkName]
  )
  const selectedServiceConnections = useMemo(
    () => serviceConnections.filter((connection) => connection.network === selectedNetworkName),
    [selectedNetworkName, serviceConnections]
  )
  const selectedNats = useMemo(() => {
    const routerNames = new Set(selectedRouters.map((router) => router.name))
    return nats.filter((nat) => routerNames.has(nat.router))
  }, [nats, selectedRouters])
  const selectedStatus = useMemo(() => summarizeNetworkMode(selectedNetwork), [selectedNetwork])
  const regionCount = useMemo(() => new Set(selectedSubnetworks.map((subnetwork) => subnetwork.region)).size, [selectedSubnetworks])
  const privateAccessCount = useMemo(
    () => selectedSubnetworks.filter((subnetwork) => subnetwork.privateIpGoogleAccess).length,
    [selectedSubnetworks]
  )

  async function loadNetworksInventory(): Promise<void> {
    setLoading(true)
    setError('')

    try {
      const nextNetworks = await listGcpNetworks(projectId)
      setNetworks(nextNetworks)
      setSelectedNetworkName((current) => {
        if (current && nextNetworks.some((network) => network.name === current)) {
          return current
        }

        if (focusNetworkName?.networkName && nextNetworks.some((network) => network.name === focusNetworkName.networkName)) {
          return focusNetworkName.networkName
        }

        return nextNetworks[0]?.name ?? ''
      })
    } catch (err) {
      setNetworks([])
      setSelectedNetworkName('')
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadSelectedNetwork(networkName: string): Promise<void> {
    if (!networkName) {
      setSubnetworks([])
      setFirewallRules([])
      setRouters([])
      setNats([])
      setGlobalAddresses([])
      setServiceConnections([])
      return
    }

    const requestId = ++loadRequestRef.current
    setLoading(true)
    setLoadingNetworkName(networkName)
    setError('')
    setMessage('')

    try {
      const [nextSubnetworks, nextFirewallRules, nextRouters, nextGlobalAddresses, nextServiceConnections] = await Promise.all([
        listGcpSubnetworks(projectId, location),
        listGcpFirewallRules(projectId),
        listGcpRouters(projectId, location),
        listGcpGlobalAddresses(projectId),
        listGcpServiceNetworkingConnections(projectId, [networkName])
      ])

      if (requestId !== loadRequestRef.current) {
        return
      }

      setSubnetworks(nextSubnetworks)
      setFirewallRules(nextFirewallRules)
      setRouters(nextRouters.routers)
      setNats(nextRouters.nats)
      setGlobalAddresses(nextGlobalAddresses)
      setServiceConnections(nextServiceConnections)
      setMessage(`Loaded VPC inventory for ${networkName}.`)
    } catch (err) {
      if (requestId !== loadRequestRef.current) {
        return
      }

      setSubnetworks([])
      setFirewallRules([])
      setRouters([])
      setNats([])
      setGlobalAddresses([])
      setServiceConnections([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestId !== loadRequestRef.current) {
        return
      }

      setLoading(false)
      setLoadingNetworkName('')
    }
  }

  useEffect(() => {
    void loadNetworksInventory()
  }, [projectId, refreshNonce])

  useEffect(() => {
    void loadSelectedNetwork(selectedNetworkName)
  }, [location, projectId, selectedNetworkName, refreshNonce])

  useEffect(() => {
    if (!focusNetworkName || focusNetworkName.token === appliedFocusToken) {
      return
    }

    setAppliedFocusToken(focusNetworkName.token)
    if (networks.some((network) => network.name === focusNetworkName.networkName)) {
      setSelectedNetworkName(focusNetworkName.networkName)
    }
  }, [appliedFocusToken, focusNetworkName, networks])

  return (
    <div className="vpc-console gcp-vpc-console">
      <section className="vpc-shell-hero gcp-vpc-hero">
        <div className="vpc-shell-hero-copy">
          <div className="eyebrow">Networking</div>
          <h2>GCP VPC workspace</h2>
          <p>
            Review network inventory with the same left-rail-plus-detail-pane model as the AWS VPC console,
            remapped to Google Cloud networks, subnetworks, firewall posture, Cloud Routers, Cloud NAT, and service networking.
          </p>
          <div className="vpc-shell-meta-strip">
            <div className="vpc-shell-meta-pill">
              <span>Project</span>
              <strong>{projectId}</strong>
            </div>
            <div className="vpc-shell-meta-pill">
              <span>Location</span>
              <strong>{location || 'global'}</strong>
            </div>
            <div className="vpc-shell-meta-pill">
              <span>Selected VPC</span>
              <strong>{selectedNetwork?.name || 'Choose a network'}</strong>
            </div>
            <div className="vpc-shell-meta-pill">
              <span>Current view</span>
              <strong>{TABS.find((item) => item.id === tab)?.label ?? 'Topology'}</strong>
            </div>
          </div>
        </div>
        <div className="vpc-shell-hero-stats">
          <div className={`vpc-shell-stat-card ${selectedStatus.tone}`}>
            <span>Network mode</span>
            <strong>{selectedStatus.label}</strong>
            <small>{selectedNetwork ? formatRoutingMode(selectedNetwork) : 'Waiting for selection'}</small>
          </div>
          <div className="vpc-shell-stat-card">
            <span>Tracked networks</span>
            <strong>{networks.length}</strong>
            <small>{networks.filter((network) => network.autoCreateSubnetworks).length} auto-mode networks</small>
          </div>
          <div className="vpc-shell-stat-card">
            <span>Subnetworks</span>
            <strong>{selectedSubnetworks.length}</strong>
            <small>{privateAccessCount} with Private Google Access</small>
          </div>
          <div className="vpc-shell-stat-card">
            <span>Security posture</span>
            <strong>{selectedFirewallRules.length}</strong>
            <small>{selectedFirewallRules.filter((rule) => rule.direction === 'INGRESS').length} ingress rules</small>
          </div>
        </div>
      </section>

      <div className="vpc-shell-toolbar">
        <div className="vpc-toolbar">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`vpc-toolbar-tab ${item.id === tab ? 'active' : ''}`}
              type="button"
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="vpc-shell-status">
          <div className="vpc-shell-status-card">
            <span>Selection</span>
            <strong>{selectedNetwork?.name || 'No VPC selected'}</strong>
          </div>
          <div className="vpc-shell-status-card">
            <span>State</span>
            <strong>{loadingNetworkName ? `Loading ${loadingNetworkName}...` : loading ? 'Loading inventory...' : 'Synchronized'}</strong>
          </div>
          <button className="vpc-toolbar-btn" type="button" onClick={() => onNavigate('gcp-compute-engine')}>
            Open Compute Engine
          </button>
          <button className="vpc-toolbar-btn" type="button" onClick={() => onNavigate('gcp-cloud-sql')}>
            Open Cloud SQL
          </button>
          <button
            className="vpc-toolbar-btn accent"
            type="button"
            onClick={() => {
              void loadNetworksInventory()
              if (selectedNetworkName) {
                void loadSelectedNetwork(selectedNetworkName)
              }
            }}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {message ? <div className="vpc-msg">{message}</div> : null}
      {error ? <SvcState variant="error" error={error} /> : null}

      <div className="vpc-main-layout">
        <aside className="vpc-inventory-pane">
          <div className="vpc-pane-head">
            <div>
              <span className="vpc-pane-kicker">Tracked networks</span>
              <h3>VPC inventory</h3>
            </div>
            <span className="vpc-pane-summary">{networks.length} total</span>
          </div>
          <label className="vpc-select-field">
            <span>Quick select</span>
            <select value={selectedNetworkName} onChange={(event) => setSelectedNetworkName(event.target.value)} disabled={loading && networks.length === 0}>
              {networks.map((network) => (
                <option key={network.name} value={network.name}>
                  {network.name} ({network.autoCreateSubnetworks ? 'auto' : 'custom'})
                </option>
              ))}
            </select>
          </label>
          {networks.length === 0 ? (
            <SvcState variant="empty" message={`No VPC networks were returned for ${projectId}.`} />
          ) : (
            <div className="vpc-inventory-list">
              {networks.map((network) => {
                const status = summarizeNetworkMode(network)

                return (
                  <button
                    key={network.name}
                    type="button"
                    className={`vpc-inventory-card ${network.name === selectedNetworkName ? 'active' : ''}`}
                    onClick={() => setSelectedNetworkName(network.name)}
                  >
                    <div className="vpc-inventory-card-top">
                      <div className="vpc-inventory-card-copy">
                        <strong>{network.name}</strong>
                        <span>{formatRoutingMode(network)}</span>
                      </div>
                      <span className={`vpc-status-badge ${status.tone}`}>{status.label}</span>
                    </div>
                    <div className="vpc-inventory-card-meta">
                      <span>{network.autoCreateSubnetworks ? 'auto subnetworks' : 'custom subnetworks'}</span>
                      <span>{network.routingMode || 'routing unavailable'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <section className="vpc-detail-pane">
          {!selectedNetwork ? (
            <SvcState variant="no-selection" resourceName="VPC network" message="Select a VPC network to inspect topology, firewall posture, Cloud NAT, and global addressing." />
          ) : (
            <>
              <section className="vpc-detail-hero gcp-vpc-detail-hero">
                <div className="vpc-detail-hero-copy">
                  <div className="eyebrow">Network posture</div>
                  <h3>{selectedNetwork.name}</h3>
                  <p>{selectedNetwork.autoCreateSubnetworks ? 'Auto subnet mode' : 'Custom subnet mode'} · {formatRoutingMode(selectedNetwork)}</p>
                  <div className="vpc-detail-meta-strip">
                    <div className="vpc-detail-meta-pill">
                      <span>Regions</span>
                      <strong>{regionCount || '-'}</strong>
                    </div>
                    <div className="vpc-detail-meta-pill">
                      <span>Cloud Routers</span>
                      <strong>{selectedRouters.length}</strong>
                    </div>
                    <div className="vpc-detail-meta-pill">
                      <span>Cloud NAT</span>
                      <strong>{selectedNats.length}</strong>
                    </div>
                    <div className="vpc-detail-meta-pill">
                      <span>Service networking</span>
                      <strong>{selectedServiceConnections.length}</strong>
                    </div>
                  </div>
                </div>
                <div className="vpc-detail-hero-stats">
                  <div className={`vpc-detail-stat-card ${selectedStatus.tone}`}>
                    <span>Subnetworks</span>
                    <strong>{selectedSubnetworks.length}</strong>
                    <small>{privateAccessCount} with Private Google Access</small>
                  </div>
                  <div className="vpc-detail-stat-card">
                    <span>Firewall rules</span>
                    <strong>{selectedFirewallRules.length}</strong>
                    <small>{selectedFirewallRules.filter((rule) => rule.direction === 'EGRESS').length} egress rules</small>
                  </div>
                  <div className="vpc-detail-stat-card">
                    <span>Global addresses</span>
                    <strong>{selectedGlobalAddresses.length}</strong>
                    <small>{selectedGlobalAddresses.filter((address) => address.purpose).length} reserved purposes</small>
                  </div>
                  <div className="vpc-detail-stat-card">
                    <span>Topology state</span>
                    <strong>{loadingNetworkName === selectedNetwork.name ? 'Syncing' : 'Ready'}</strong>
                    <small>Project-aware networking inventory</small>
                  </div>
                </div>
              </section>

              <div className="vpc-detail-tabs">
                {TABS.map((item) => (
                  <button key={item.id} className={tab === item.id ? 'active' : ''} type="button" onClick={() => setTab(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>

              {tab === 'topology' ? (
                <>
                  <div className="vpc-summary-grid">
                    <div className="vpc-summary-card"><span>Subnetworks</span><strong>{selectedSubnetworks.length}</strong></div>
                    <div className="vpc-summary-card"><span>Regions</span><strong>{regionCount}</strong></div>
                    <div className="vpc-summary-card"><span>Firewall rules</span><strong>{selectedFirewallRules.length}</strong></div>
                    <div className="vpc-summary-card"><span>Cloud NAT</span><strong>{selectedNats.length}</strong></div>
                    <div className="vpc-summary-card"><span>Global addresses</span><strong>{selectedGlobalAddresses.length}</strong></div>
                    <div className="vpc-summary-card"><span>Private service access</span><strong>{selectedServiceConnections.length}</strong></div>
                  </div>

                  <section className="vpc-section">
                    <div className="vpc-section-head">
                      <div>
                        <span className="vpc-section-kicker">Subnet inventory</span>
                        <h4>Subnetworks</h4>
                      </div>
                      <p>Subnetworks are filtered to the selected VPC and the current location scope.</p>
                    </div>
                    <div className="vpc-table-wrap">
                      <table className="vpc-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Region</th>
                            <th>CIDR</th>
                            <th>Private Google Access</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedSubnetworks.map((subnetwork) => (
                            <tr key={subnetwork.name}>
                              <td>{subnetwork.name}</td>
                              <td>{subnetwork.region || '-'}</td>
                              <td className="vpc-mono">{subnetwork.ipCidrRange || '-'}</td>
                              <td>
                                <span className={`vpc-status-badge ${subnetworkAccessTone(subnetwork)}`}>
                                  {subnetwork.privateIpGoogleAccess ? 'Enabled' : 'Disabled'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {selectedSubnetworks.length === 0 ? <SvcState variant="empty" message="No subnetworks matched the selected VPC." compact /> : null}
                  </section>

                  <section className="vpc-section">
                    <div className="vpc-section-head">
                      <div>
                        <span className="vpc-section-kicker">Routing surface</span>
                        <h4>Routers and NAT coverage</h4>
                      </div>
                    </div>
                    <div className="vpc-table-wrap">
                      <table className="vpc-table">
                        <thead>
                          <tr>
                            <th>Router</th>
                            <th>Region</th>
                            <th>Cloud NATs</th>
                            <th>NAT allocation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRouters.map((router) => {
                            const routerNats = selectedNats.filter((nat) => nat.router === router.name)
                            return (
                              <tr key={router.name}>
                                <td>{router.name}</td>
                                <td>{router.region || '-'}</td>
                                <td>{routerNats.length ? routerNats.map((nat) => nat.name).join(', ') : '-'}</td>
                                <td className="vpc-table-detail">
                                  {routerNats.length ? routerNats.map((nat) => nat.natIpAllocateOption || 'allocation unavailable').join('; ') : '-'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {selectedRouters.length === 0 ? <SvcState variant="empty" message="No Cloud Routers matched the selected VPC." compact /> : null}
                  </section>
                </>
              ) : null}

              {tab === 'flow' ? (
                <section className="vpc-section">
                  <div className="vpc-section-head">
                    <div>
                      <span className="vpc-section-kicker">Diagram</span>
                      <h4>VPC architecture</h4>
                    </div>
                    <p>
                      The architecture lens shows the selected VPC network, its regional subnetworks, router/NAT layer,
                      private service access, and any global addresses attached to the same topology.
                    </p>
                  </div>
                  <GcpVpcArchitectureDiagram
                    network={selectedNetwork}
                    subnetworks={selectedSubnetworks}
                    routers={selectedRouters}
                    nats={selectedNats}
                    serviceConnections={selectedServiceConnections}
                    globalAddresses={selectedGlobalAddresses}
                  />
                </section>
              ) : null}

              {tab === 'security' ? (
                <section className="vpc-section">
                  <div className="vpc-section-head">
                    <div>
                      <span className="vpc-section-kicker">Firewall posture</span>
                      <h4>Firewall rules</h4>
                    </div>
                    <p>Firewall rules are filtered to the selected VPC network and help approximate the AWS security view for this slice.</p>
                  </div>
                  <div className="vpc-table-wrap">
                    <table className="vpc-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Direction</th>
                          <th>Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFirewallRules.map((rule) => (
                          <tr key={rule.name}>
                            <td>{rule.name}</td>
                            <td>
                              <span className={`vpc-status-badge ${rule.direction === 'INGRESS' ? 'warning' : 'info'}`}>
                                {rule.direction || 'UNKNOWN'}
                              </span>
                            </td>
                            <td className="vpc-mono">{rule.priority || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedFirewallRules.length === 0 ? <SvcState variant="empty" message="No firewall rules matched the selected VPC." compact /> : null}
                </section>
              ) : null}

              {tab === 'gateways' ? (
                <>
                  <section className="vpc-section">
                    <div className="vpc-section-head">
                      <div>
                        <span className="vpc-section-kicker">Gateway layer</span>
                        <h4>Cloud Routers and NAT</h4>
                      </div>
                    </div>
                    <div className="vpc-table-wrap">
                      <table className="vpc-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Region</th>
                            <th>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRouters.map((router) => (
                            <tr key={`router:${router.name}`}>
                              <td>{router.name}</td>
                              <td>Cloud Router</td>
                              <td>{router.region || '-'}</td>
                              <td>{router.network || '-'}</td>
                            </tr>
                          ))}
                          {selectedNats.map((nat) => (
                            <tr key={`nat:${nat.router}:${nat.name}`}>
                              <td>{nat.name}</td>
                              <td>Cloud NAT</td>
                              <td>{nat.region || '-'}</td>
                              <td>{nat.router} · {nat.natIpAllocateOption || 'allocation unavailable'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {selectedRouters.length === 0 && selectedNats.length === 0 ? <SvcState variant="empty" message="No router or NAT resources matched the selected VPC." compact /> : null}
                  </section>

                  <section className="vpc-section">
                    <div className="vpc-section-head">
                      <div>
                        <span className="vpc-section-kicker">Private service access</span>
                        <h4>Service networking connections</h4>
                      </div>
                    </div>
                    <div className="vpc-table-wrap">
                      <table className="vpc-table">
                        <thead>
                          <tr>
                            <th>Service</th>
                            <th>Peering</th>
                            <th>Reserved ranges</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedServiceConnections.map((connection) => (
                            <tr key={`${connection.service}:${connection.peering}`}>
                              <td>{connection.service}</td>
                              <td>{connection.peering || '-'}</td>
                              <td className="vpc-table-detail">
                                {connection.reservedPeeringRanges.length ? connection.reservedPeeringRanges.join(', ') : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {selectedServiceConnections.length === 0 ? <SvcState variant="empty" message="No service networking connections were returned for the selected VPC." compact /> : null}
                  </section>
                </>
              ) : null}

              {tab === 'addresses' ? (
                <section className="vpc-section">
                  <div className="vpc-section-head">
                    <div>
                      <span className="vpc-section-kicker">Address surface</span>
                      <h4>Global addresses</h4>
                    </div>
                  </div>
                  <div className="vpc-table-wrap">
                    <table className="vpc-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Address</th>
                          <th>Type</th>
                          <th>Purpose</th>
                          <th>Prefix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGlobalAddresses.map((address) => (
                          <tr key={address.name}>
                            <td>{address.name}</td>
                            <td className="vpc-mono">{address.address || '-'}</td>
                            <td>{address.addressType || '-'}</td>
                            <td>{address.purpose || '-'}</td>
                            <td className="vpc-mono">{address.prefixLength || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedGlobalAddresses.length === 0 ? <SvcState variant="empty" message="No global addresses matched the selected VPC." compact /> : null}
                </section>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
