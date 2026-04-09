import { useEffect, useMemo, useState } from 'react'

import type {
  AzureAksClusterSummary,
  AzureRbacOverview,
  AzureSubscriptionSummary,
  AzureVirtualMachineSummary
} from '@shared/types'
import {
  getAzureRbacOverview,
  listAzureAksClusters,
  listAzureSubscriptions,
  listAzureVirtualMachines
} from './api'
import { SvcState } from './SvcState'

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortByName<T extends { name?: string; displayName?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.name || left.displayName || '').localeCompare(right.name || right.displayName || ''))
}

function renderTableHeader(columns: string[], gridTemplateColumns: string): JSX.Element {
  return (
    <div className="table-row table-head" style={{ display: 'grid', gridTemplateColumns, gap: '1rem' }}>
      {columns.map((column) => <div key={column}>{column}</div>)}
    </div>
  )
}

function formatLocationHint(location: string): string {
  return location.trim() || 'all visible locations'
}

export function AzureSubscriptionsConsole({
  subscriptionId,
  location,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  onOpenCost,
  onOpenMonitor
}: {
  subscriptionId: string
  location: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  onOpenCost: () => void
  onOpenMonitor: () => void
}): JSX.Element {
  const [subscriptions, setSubscriptions] = useState<AzureSubscriptionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const next = await listAzureSubscriptions()
        if (!cancelled) {
          setSubscriptions(sortByName(next))
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError(err))
          setSubscriptions([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [refreshNonce])

  const selected = subscriptions.find((entry) => entry.subscriptionId === subscriptionId) ?? null
  const enabledCount = subscriptions.filter((entry) => entry.state.toLowerCase() === 'enabled').length

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Core Slice</div>
          <h2>Subscriptions</h2>
          <p>Tenant-linked subscription context for the active Azure shell. The selected location is {formatLocationHint(location)}.</p>
        </div>
      </div>

      {loading ? <SvcState variant="loading" resourceName="Azure subscriptions" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && subscriptions.length === 0 ? (
        <SvcState variant="empty" message="No Azure subscriptions were visible to the current credential chain." />
      ) : null}

      {!loading && !error && subscriptions.length > 0 ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight">
              <span className="overview-tile-kicker">Visible</span>
              <strong>{subscriptions.length}</strong>
              <span>subscriptions in scope</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Enabled</span>
              <strong>{enabledCount}</strong>
              <span>subscriptions currently enabled</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Selected</span>
              <strong>{selected?.displayName || 'Pending'}</strong>
              <span>{selected?.tenantId || 'Select a subscription from Connection Selector'}</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Location</span>
              <strong>{formatLocationHint(location)}</strong>
              <span>{selected?.locationCount ?? 0} visible regions on selected subscription</span>
            </div>
          </section>

          <section className="workspace-grid">
            <div className="column stack">
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Subscription Inventory</h3></div>
                <div className="table-grid overview-table-grid">
                  {renderTableHeader(['Subscription', 'State', 'Tenant', 'Locations'], '1.4fr 0.7fr 1fr 0.8fr')}
                  {subscriptions.map((entry) => (
                    <div key={entry.subscriptionId} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 1fr 0.8fr', gap: '1rem' }}>
                      <div>
                        <strong>{entry.displayName}</strong>
                        <div className="hero-path">{entry.subscriptionId}</div>
                      </div>
                      <div>{entry.state || '-'}</div>
                      <div>{entry.tenantId || '-'}</div>
                      <div>{entry.locationCount}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="column stack">
              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Selected Context</h3></div>
                <div className="overview-note-list">
                  <div className="overview-note-item">Subscription: {selected?.displayName || 'Not selected'}</div>
                  <div className="overview-note-item">Tenant: {selected?.tenantId || 'Not visible'}</div>
                  <div className="overview-note-item">Location: {formatLocationHint(location)}</div>
                  <div className="overview-note-item">Authorization source: {selected?.authorizationSource || 'Not reported'}</div>
                  <div className="overview-note-item">Spending limit: {selected?.spendingLimit || 'Unknown'}</div>
                </div>
              </div>

              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Terminal Handoff</h3></div>
                <div className="gcp-overview-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canRunTerminalCommand || !subscriptionId}
                    onClick={() => onRunTerminalCommand(`az account show --subscription "${subscriptionId}" --output jsonc`)}
                  >
                    Account snapshot
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canRunTerminalCommand || !subscriptionId}
                    onClick={() => onRunTerminalCommand(`az account list-locations --subscription "${subscriptionId}" --output table`)}
                  >
                    List locations
                  </button>
                  <button type="button" className="ghost" onClick={onOpenCost}>
                    Open cost
                  </button>
                  <button type="button" className="ghost" onClick={onOpenMonitor}>
                    Open monitor
                  </button>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function AzureRbacConsole({
  subscriptionId,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  onOpenCompliance,
  onOpenMonitor
}: {
  subscriptionId: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  onOpenCompliance: () => void
  onOpenMonitor: () => void
}): JSX.Element {
  const [overview, setOverview] = useState<AzureRbacOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const next = await getAzureRbacOverview(subscriptionId)
        if (!cancelled) {
          setOverview(next)
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError(err))
          setOverview(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [refreshNonce, subscriptionId])

  const riskyAssignments = overview?.assignments.filter((assignment) => assignment.risky).slice(0, 8) ?? []

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Core Slice</div>
          <h2>RBAC Posture</h2>
          <p>Subscription-scope role assignment visibility with inherited scope surfacing and risky-role prioritization.</p>
        </div>
      </div>

      {loading ? <SvcState variant="loading" resourceName="Azure RBAC posture" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && !overview ? <SvcState variant="empty" message="RBAC posture was not available for the selected subscription." /> : null}

      {overview ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight">
              <span className="overview-tile-kicker">Assignments</span>
              <strong>{overview.assignmentCount}</strong>
              <span>role assignments visible</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Risky Roles</span>
              <strong>{overview.riskyAssignmentCount}</strong>
              <span>high-privilege assignments</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Inherited</span>
              <strong>{overview.inheritedAssignmentCount}</strong>
              <span>below subscription scope</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Principals</span>
              <strong>{overview.principalCount}</strong>
              <span>unique principals in scope</span>
            </div>
          </section>

          <section className="workspace-grid">
            <div className="column stack">
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Priority Assignments</h3></div>
                <div className="table-grid overview-table-grid">
                  {renderTableHeader(['Role', 'Principal', 'Type', 'Scope'], '1fr 1.1fr 0.7fr 1.2fr')}
                  {(riskyAssignments.length ? riskyAssignments : overview.assignments.slice(0, 12)).map((assignment) => (
                    <div key={assignment.id} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 0.7fr 1.2fr', gap: '1rem' }}>
                      <div>
                        <strong>{assignment.roleName}</strong>
                        <div className="hero-path">{assignment.risky ? 'High privilege' : 'Standard visibility'}</div>
                      </div>
                      <div>{assignment.principalId}</div>
                      <div>{assignment.principalType}</div>
                      <div>{assignment.scopeKind}{assignment.inherited ? ' (inherited)' : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="column stack">
              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Scope Notes</h3></div>
                <div className="overview-note-list">
                  {overview.notes.length > 0
                    ? overview.notes.map((note) => <div key={note} className="overview-note-item">{note}</div>)
                    : (
                      <>
                        <div className="overview-note-item">{overview.riskyAssignmentCount} risky assignments should be reviewed before widening operator access.</div>
                        <div className="overview-note-item">{overview.roleCount} unique roles are visible under the selected subscription.</div>
                        <div className="overview-note-item">Inherited scope entries indicate role bindings attached below the subscription root.</div>
                      </>
                    )}
                </div>
              </div>

              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Terminal Handoff</h3></div>
                <div className="gcp-overview-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canRunTerminalCommand}
                    onClick={() => onRunTerminalCommand(`az role assignment list --subscription "${subscriptionId}" --all --output table`)}
                  >
                    List assignments
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!canRunTerminalCommand}
                    onClick={() => onRunTerminalCommand(`az role definition list --subscription "${subscriptionId}" --output table`)}
                  >
                    List roles
                  </button>
                  <button type="button" className="ghost" onClick={onOpenCompliance}>
                    Open compliance
                  </button>
                  <button type="button" className="ghost" onClick={onOpenMonitor}>
                    Open monitor
                  </button>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function AzureVirtualMachinesConsole({
  subscriptionId,
  location,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  onOpenMonitor,
  onOpenDirectAccess
}: {
  subscriptionId: string
  location: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  onOpenMonitor: (query: string) => void
  onOpenDirectAccess: () => void
}): JSX.Element {
  const [machines, setMachines] = useState<AzureVirtualMachineSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const next = await listAzureVirtualMachines(subscriptionId, location)
        if (!cancelled) {
          setMachines(sortByName(next))
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError(err))
          setMachines([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [location, refreshNonce, subscriptionId])

  const runningCount = machines.filter((machine) => machine.powerState.toLowerCase().includes('running')).length
  const publicCount = machines.filter((machine) => machine.hasPublicIp).length
  const identityCount = machines.filter((machine) => machine.identityType !== 'None').length

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Core Slice</div>
          <h2>Virtual Machines</h2>
          <p>Live VM posture for the selected subscription and {formatLocationHint(location)} with power, identity, network, and diagnostics hints.</p>
        </div>
      </div>

      {loading ? <SvcState variant="loading" resourceName="Azure virtual machines" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && machines.length === 0 ? (
        <SvcState variant="empty" message="No Azure virtual machines were discovered for the selected subscription/location." />
      ) : null}

      {machines.length > 0 ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight">
              <span className="overview-tile-kicker">Visible</span>
              <strong>{machines.length}</strong>
              <span>virtual machines in scope</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Running</span>
              <strong>{runningCount}</strong>
              <span>currently powered on</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Public Exposure</span>
              <strong>{publicCount}</strong>
              <span>VMs with a public IP</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Identity</span>
              <strong>{identityCount}</strong>
              <span>VMs with managed identity</span>
            </div>
          </section>

          <div className="panel overview-data-panel">
            <div className="panel-header"><h3>VM Inventory</h3></div>
            <div className="table-grid overview-table-grid">
              {renderTableHeader(['Name', 'Power', 'Network', 'Identity', 'Actions'], '1.2fr 0.7fr 1fr 0.8fr 0.9fr')}
              {machines.map((machine) => (
                <div key={machine.id} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 1fr 0.8fr 0.9fr', gap: '1rem' }}>
                  <div>
                    <strong>{machine.name}</strong>
                    <div className="hero-path">{machine.resourceGroup} | {machine.vmSize || 'size unknown'}</div>
                  </div>
                  <div>{machine.powerState || machine.provisioningState}</div>
                  <div>{machine.privateIp || '-'}{machine.publicIp ? ` / ${machine.publicIp}` : ''}</div>
                  <div>{machine.identityType || 'None'}</div>
                  <div>
                    <button
                      type="button"
                      className="ghost"
                      disabled={!canRunTerminalCommand}
                      onClick={() => onRunTerminalCommand(`az vm show -g "${machine.resourceGroup}" -n "${machine.name}" --subscription "${subscriptionId}" -d --output jsonc`)}
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel overview-insights-panel">
            <div className="panel-header"><h3>Cross-links</h3></div>
            <div className="gcp-overview-actions">
              <button type="button" className="ghost" onClick={() => onOpenMonitor('Microsoft.Compute virtualMachines')}>
                Open monitor
              </button>
              <button type="button" className="ghost" onClick={onOpenDirectAccess}>
                Open direct access
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function AzureAksConsole({
  subscriptionId,
  location,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  onOpenMonitor
}: {
  subscriptionId: string
  location: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  onOpenMonitor: (query: string) => void
}): JSX.Element {
  const [clusters, setClusters] = useState<AzureAksClusterSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const next = await listAzureAksClusters(subscriptionId, location)
        if (!cancelled) {
          setClusters(sortByName(next))
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError(err))
          setClusters([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [location, refreshNonce, subscriptionId])

  const privateCount = clusters.filter((cluster) => cluster.privateCluster).length
  const workloadIdentityCount = clusters.filter((cluster) => cluster.workloadIdentityEnabled).length

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Core Slice</div>
          <h2>AKS</h2>
          <p>Cluster posture for the selected subscription and {formatLocationHint(location)} with node pool, identity, and network signals.</p>
        </div>
      </div>

      {loading ? <SvcState variant="loading" resourceName="Azure AKS clusters" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && clusters.length === 0 ? (
        <SvcState variant="empty" message="No AKS clusters were discovered for the selected subscription/location." />
      ) : null}

      {clusters.length > 0 ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight">
              <span className="overview-tile-kicker">Clusters</span>
              <strong>{clusters.length}</strong>
              <span>AKS clusters in scope</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Private API</span>
              <strong>{privateCount}</strong>
              <span>clusters with private API endpoint</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Workload Identity</span>
              <strong>{workloadIdentityCount}</strong>
              <span>clusters with workload identity enabled</span>
            </div>
            <div className="overview-tile">
              <span className="overview-tile-kicker">Node Pools</span>
              <strong>{clusters.reduce((total, cluster) => total + cluster.nodePoolCount, 0)}</strong>
              <span>visible pools across current location</span>
            </div>
          </section>

          <div className="panel overview-data-panel">
            <div className="panel-header"><h3>Cluster Inventory</h3></div>
            <div className="table-grid overview-table-grid">
              {renderTableHeader(['Cluster', 'Version', 'Nodes', 'Network', 'Actions'], '1.2fr 0.7fr 0.7fr 1fr 0.9fr')}
              {clusters.map((cluster) => (
                <div key={cluster.id} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.7fr 0.7fr 1fr 0.9fr', gap: '1rem' }}>
                  <div>
                    <strong>{cluster.name}</strong>
                    <div className="hero-path">{cluster.resourceGroup} | {cluster.location}</div>
                  </div>
                  <div>{cluster.kubernetesVersion || '-'}</div>
                  <div>{cluster.nodeCount}</div>
                  <div>{cluster.privateCluster ? 'Private API' : 'Public API'} | {cluster.networkPlugin || '-'}</div>
                  <div>
                    <button
                      type="button"
                      className="ghost"
                      disabled={!canRunTerminalCommand}
                      onClick={() => onRunTerminalCommand(`az aks get-credentials -g "${cluster.resourceGroup}" -n "${cluster.name}" --subscription "${subscriptionId}" --overwrite-existing`)}
                    >
                      Kubeconfig
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel overview-insights-panel">
            <div className="panel-header"><h3>Cross-links</h3></div>
            <div className="gcp-overview-actions">
              <button type="button" className="ghost" onClick={() => onOpenMonitor('Microsoft.ContainerService managedClusters')}>
                Open monitor
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
