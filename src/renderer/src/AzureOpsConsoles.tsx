import { useEffect, useMemo, useState } from 'react'

import type {
  AzureCostOverview,
  AzureMonitorActivityResult,
  AzureSqlEstateOverview
} from '@shared/types'
import { getAzureCostOverview, getAzureSqlEstate, listAzureMonitorActivity } from './api'
import { SvcState } from './SvcState'

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2
    }).format(amount)
  } catch {
    return `${currency || 'USD'} ${amount.toFixed(2)}`
  }
}

function formatDateTime(value: string): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function inferAzureServiceFromMonitor(resourceType: string): 'azure-virtual-machines' | 'azure-aks' | 'azure-storage-accounts' | 'azure-sql' | 'azure-rbac' | null {
  const normalized = resourceType.trim().toLowerCase()
  if (normalized.includes('microsoft.compute')) return 'azure-virtual-machines'
  if (normalized.includes('microsoft.containerservice')) return 'azure-aks'
  if (normalized.includes('microsoft.storage')) return 'azure-storage-accounts'
  if (normalized.includes('microsoft.sql')) return 'azure-sql'
  if (normalized.includes('microsoft.authorization')) return 'azure-rbac'
  return null
}

export function AzureSqlConsole({
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
  const [overview, setOverview] = useState<AzureSqlEstateOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedServerName, setSelectedServerName] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void getAzureSqlEstate(subscriptionId, location)
      .then((next) => {
        if (cancelled) return
        setOverview(next)
        setSelectedServerName((current) => current || next.servers[0]?.name || '')
      })
      .catch((err) => {
        if (cancelled) return
        setOverview(null)
        setError(normalizeError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [location, refreshNonce, subscriptionId])

  const selectedServer = overview?.servers.find((server) => server.name === selectedServerName) ?? overview?.servers[0] ?? null
  const selectedDatabases = useMemo(
    () => overview?.databases.filter((database) => database.serverName === selectedServer?.name) ?? [],
    [overview, selectedServer]
  )

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Data Slice</div>
          <h2>Azure SQL</h2>
          <p>Server posture, database inventory, and connection-ready context for the active subscription and region lens.</p>
        </div>
      </div>
      {loading ? <SvcState variant="loading" resourceName="Azure SQL estate" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && !overview ? <SvcState variant="empty" message="Azure SQL estate was not visible for the selected subscription." /> : null}
      {overview ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight"><span className="overview-tile-kicker">Servers</span><strong>{overview.serverCount}</strong><span>visible SQL servers</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Databases</span><strong>{overview.databaseCount}</strong><span>databases across the current region lens</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Public</span><strong>{overview.publicServerCount}</strong><span>servers with public network enabled</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Selected</span><strong>{selectedServer?.name || 'Pending'}</strong><span>{selectedServer?.fullyQualifiedDomainName || 'Choose a server'}</span></div>
          </section>
          <section className="workspace-grid">
            <div className="column stack">
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Server Inventory</h3></div>
                <div className="table-grid overview-table-grid">
                  <div className="table-row table-head" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr', gap: '1rem' }}>
                    <div>Server</div><div>Network</div><div>Databases</div><div>TLS</div>
                  </div>
                  {overview.servers.map((server) => (
                    <button key={server.id} type="button" className={`table-row overview-table-row ${selectedServer?.id === server.id ? 'active' : ''}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr', gap: '1rem', textAlign: 'left' }} onClick={() => setSelectedServerName(server.name)}>
                      <div><strong>{server.name}</strong><div className="hero-path">{server.resourceGroup}</div></div>
                      <div>{server.publicNetworkAccess || '-'}</div>
                      <div>{server.databaseCount}</div>
                      <div>{server.minimalTlsVersion || '-'}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="column stack">
              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Selected Server</h3></div>
                {!selectedServer ? <SvcState variant="no-selection" resourceName="SQL server" message="Select a server to inspect its databases and posture." /> : (
                  <div className="overview-note-list">
                    <div className="overview-note-item">FQDN: {selectedServer.fullyQualifiedDomainName || 'Unavailable'}</div>
                    <div className="overview-note-item">Administrator: {selectedServer.administratorType || 'Local admin'}</div>
                    <div className="overview-note-item">Outbound restriction: {selectedServer.outboundNetworkRestriction || 'Not reported'}</div>
                    <div className="overview-note-item">Elastic pools: {selectedServer.elasticPoolCount}</div>
                    {selectedServer.notes.map((note) => <div key={note} className="overview-note-item">{note}</div>)}
                  </div>
                )}
              </div>
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Databases</h3></div>
                {!selectedServer ? null : (
                  <div className="table-grid overview-table-grid">
                    <div className="table-row table-head" style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 0.8fr 0.8fr', gap: '1rem' }}>
                      <div>Database</div><div>Status</div><div>SKU</div><div>Backup</div>
                    </div>
                    {selectedDatabases.map((database) => (
                      <div key={database.id} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 0.8fr 0.8fr', gap: '1rem' }}>
                        <div><strong>{database.name}</strong><div className="hero-path">{database.maxSizeGb ? `${database.maxSizeGb} GB max` : 'Sizing pending'}</div></div>
                        <div>{database.status || '-'}</div>
                        <div>{database.skuName || database.edition || '-'}</div>
                        <div>{database.backupStorageRedundancy || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Terminal Handoff</h3></div>
                <div className="gcp-overview-actions">
                  <button type="button" className="ghost" disabled={!canRunTerminalCommand || !selectedServer} onClick={() => selectedServer && onRunTerminalCommand(`az sql server show -g "${selectedServer.resourceGroup}" -n "${selectedServer.name}" --subscription "${subscriptionId}" --output jsonc`)}>Server snapshot</button>
                  <button type="button" className="ghost" disabled={!canRunTerminalCommand || !selectedServer} onClick={() => selectedServer && onRunTerminalCommand(`az sql db list -g "${selectedServer.resourceGroup}" -s "${selectedServer.name}" --subscription "${subscriptionId}" --output table`)}>List databases</button>
                  <button type="button" className="ghost" disabled={!selectedServer} onClick={() => selectedServer && onOpenMonitor(`Microsoft.Sql ${selectedServer.name}`)}>Open monitor</button>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function AzureMonitorConsole({
  subscriptionId,
  location,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  initialQuery,
  seedToken,
  onOpenCompliance,
  onOpenDirectAccess,
  onOpenService
}: {
  subscriptionId: string
  location: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  initialQuery: string
  seedToken: number
  onOpenCompliance: () => void
  onOpenDirectAccess: () => void
  onOpenService: (serviceId: 'azure-virtual-machines' | 'azure-aks' | 'azure-storage-accounts' | 'azure-sql' | 'azure-rbac') => void
}): JSX.Element {
  const storageKey = `cloud-lens:azure-monitor-saved:${subscriptionId}`
  const [queryDraft, setQueryDraft] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [savedQueries, setSavedQueries] = useState<string[]>([])
  const [result, setResult] = useState<AzureMonitorActivityResult | null>(null)
  const [selectedEventId, setSelectedEventId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      const parsed = raw ? JSON.parse(raw) : []
      setSavedQueries(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
    } catch {
      setSavedQueries([])
    }
  }, [storageKey])

  useEffect(() => {
    if (!initialQuery.trim()) return
    setQueryDraft(initialQuery)
    setAppliedQuery(initialQuery)
  }, [initialQuery, seedToken])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void listAzureMonitorActivity(subscriptionId, location, appliedQuery, 24)
      .then((next) => {
        if (cancelled) return
        setResult(next)
        setSelectedEventId((current) => current || next.events[0]?.id || '')
      })
      .catch((err) => {
        if (cancelled) return
        setResult(null)
        setError(normalizeError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [appliedQuery, location, refreshNonce, subscriptionId])

  const selectedEvent = result?.events.find((event) => event.id === selectedEventId) ?? result?.events[0] ?? null
  const relatedService = inferAzureServiceFromMonitor(selectedEvent?.resourceType || '')

  function persistQueries(nextQueries: string[]): void {
    setSavedQueries(nextQueries)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextQueries))
    } catch {
      // ignore local storage failures
    }
  }

  return (
    <div className="cw-console gcp-logging-console">
      {message ? <div className="s3-msg s3-msg-ok">{message}<button type="button" className="s3-msg-close" onClick={() => setMessage('')}>x</button></div> : null}
      <div className="cw-shell-hero">
        <div className="cw-shell-hero-copy">
          <div className="cw-shell-kicker">Azure Monitor</div>
          <h2>Activity Investigations</h2>
          <p>Recent management-plane activity log with reusable investigation queries and operator handoff.</p>
          <div className="cw-shell-meta-strip">
            <div className="cw-shell-meta-pill"><span>Subscription</span><strong>{subscriptionId}</strong></div>
            <div className="cw-shell-meta-pill"><span>Region lens</span><strong>{location || 'All regions'}</strong></div>
            <div className="cw-shell-meta-pill"><span>Window</span><strong>24 hours</strong></div>
            <div className="cw-shell-meta-pill"><span>Saved</span><strong>{savedQueries.length}</strong></div>
          </div>
        </div>
        <div className="cw-shell-hero-stats">
          <div className="cw-shell-stat-card cw-shell-stat-card-accent"><span>Events</span><strong>{result?.events.length.toLocaleString() ?? '0'}</strong><small>Activity rows in the current result set.</small></div>
          <div className="cw-shell-stat-card"><span>Statuses</span><strong>{result?.statusCounts.length.toLocaleString() ?? '0'}</strong><small>Distinct status facets in the current window.</small></div>
          <div className="cw-shell-stat-card"><span>Resource types</span><strong>{result?.resourceTypeCounts.length.toLocaleString() ?? '0'}</strong><small>Providers represented in the events.</small></div>
          <div className="cw-shell-stat-card"><span>Selected</span><strong>{selectedEvent?.status || 'Pending'}</strong><small>{selectedEvent?.operationName || 'Choose an event for detail.'}</small></div>
        </div>
      </div>
      <div className="cw-section">
        <div className="cw-query-layout">
          <div className="cw-query-main">
            <div className="cw-query-target-bar">
              <span className="cw-query-source">{subscriptionId}</span>
              <span className="cw-query-source">{location || 'global'}</span>
              <button type="button" className="cw-toggle" onClick={() => { setQueryDraft(''); setAppliedQuery('') }}>Reset</button>
              <button type="button" className="cw-toggle" disabled={!canRunTerminalCommand} onClick={() => onRunTerminalCommand(`az monitor activity-log list --subscription "${subscriptionId}" --offset 24h --max-events 50 --output jsonc`)}>Rerun in terminal</button>
            </div>
            <textarea className="cw-query-editor" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} rows={8} spellCheck={false} placeholder={'virtualmachine\nFailed\nresourceGroups/my-rg'} />
            <div className="cw-query-actions">
              <button type="button" className="cw-refresh-btn" onClick={() => setAppliedQuery(queryDraft.trim())}>Run Query</button>
              <button type="button" className="cw-expand-btn" disabled={!queryDraft.trim()} onClick={() => { const next = [queryDraft.trim(), ...savedQueries.filter((entry) => entry !== queryDraft.trim())].slice(0, 6); persistQueries(next); setMessage('Investigation saved.') }}>Save Query</button>
            </div>
            {loading ? <SvcState variant="loading" resourceName="Azure Monitor activity" compact /> : null}
            {!loading && error ? <SvcState variant="error" error={error} /> : null}
            {!loading && !error && !result ? <SvcState variant="empty" message="No Azure Monitor result was returned." /> : null}
            {result ? (
              <div className="cw-results-table">
                {result.events.map((event) => (
                  <button key={event.id} type="button" className={`cw-result-row ${selectedEvent?.id === event.id ? 'active' : ''}`} onClick={() => setSelectedEventId(event.id)}>
                    <strong>{event.operationName}</strong>
                    <span>{event.status} | {event.resourceGroup || 'no-rg'} | {formatDateTime(event.timestamp)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="cw-query-side">
            <div className="panel overview-insights-panel">
              <div className="panel-header"><h3>Saved Queries</h3></div>
              <div className="overview-note-list">
                {savedQueries.length === 0 ? <div className="overview-note-item">No saved investigations yet.</div> : savedQueries.map((query) => (
                  <button key={query} type="button" className="ghost" onClick={() => { setQueryDraft(query); setAppliedQuery(query) }}>{query}</button>
                ))}
              </div>
            </div>
            <div className="panel overview-insights-panel">
              <div className="panel-header"><h3>Selected Event</h3></div>
              {!selectedEvent ? <SvcState variant="no-selection" resourceName="activity event" message="Choose an event to review operation, caller, and correlation data." /> : (
                <>
                  <div className="overview-note-list">
                    <div className="overview-note-item">Status: {selectedEvent.status || 'Unknown'}</div>
                    <div className="overview-note-item">Level: {selectedEvent.level || 'Unknown'}</div>
                    <div className="overview-note-item">Caller: {selectedEvent.caller || 'Unknown caller'}</div>
                    <div className="overview-note-item">Resource group: {selectedEvent.resourceGroup || 'Unknown group'}</div>
                    <div className="overview-note-item">Resource type: {selectedEvent.resourceType || 'Unknown type'}</div>
                    <div className="overview-note-item">Correlation: {selectedEvent.correlationId || 'Unavailable'}</div>
                    <div className="overview-note-item">Summary: {selectedEvent.summary || 'No sub-status provided.'}</div>
                  </div>
                  <div className="gcp-overview-actions">
                    {relatedService ? <button type="button" className="ghost" onClick={() => onOpenService(relatedService)}>Open related service</button> : null}
                    <button type="button" className="ghost" onClick={onOpenDirectAccess}>Direct access</button>
                    <button type="button" className="ghost" onClick={onOpenCompliance}>Compliance</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AzureCostConsole({
  subscriptionId,
  refreshNonce,
  onRunTerminalCommand,
  canRunTerminalCommand,
  onOpenCompliance
}: {
  subscriptionId: string
  refreshNonce: number
  onRunTerminalCommand: (command: string) => void
  canRunTerminalCommand: boolean
  onOpenCompliance: () => void
}): JSX.Element {
  const [overview, setOverview] = useState<AzureCostOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void getAzureCostOverview(subscriptionId)
      .then((next) => {
        if (!cancelled) setOverview(next)
      })
      .catch((err) => {
        if (!cancelled) {
          setOverview(null)
          setError(normalizeError(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [refreshNonce, subscriptionId])

  return (
    <div className="overview-surface">
      <div className="catalog-page-header">
        <div>
          <div className="eyebrow">Azure Cost Slice</div>
          <h2>Cost Posture</h2>
          <p>Month-to-date spend visibility with service and resource-group breakdown for the active subscription.</p>
        </div>
      </div>
      {loading ? <SvcState variant="loading" resourceName="Azure cost posture" compact /> : null}
      {!loading && error ? <SvcState variant="error" error={error} /> : null}
      {!loading && !error && !overview ? <SvcState variant="empty" message="Azure cost posture was not available for the selected subscription." /> : null}
      {overview ? (
        <>
          <section className="overview-tiles overview-tiles-summary">
            <div className="overview-tile highlight"><span className="overview-tile-kicker">Spend</span><strong>{formatCurrency(overview.totalAmount, overview.currency)}</strong><span>{overview.timeframeLabel}</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Services</span><strong>{overview.topServices.length}</strong><span>top cost categories in view</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Resource groups</span><strong>{overview.topResourceGroups.length}</strong><span>cost-attributed groups returned</span></div>
            <div className="overview-tile"><span className="overview-tile-kicker">Subscription</span><strong>{subscriptionId}</strong><span>cost scope</span></div>
          </section>
          <section className="workspace-grid">
            <div className="column stack">
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Top Services</h3></div>
                <div className="table-grid overview-table-grid">
                  <div className="table-row table-head" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr', gap: '1rem' }}>
                    <div>Service</div><div>Amount</div><div>Share</div>
                  </div>
                  {overview.topServices.map((entry) => (
                    <div key={entry.label} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr', gap: '1rem' }}>
                      <div>{entry.label}</div>
                      <div>{formatCurrency(entry.amount, entry.currency)}</div>
                      <div>{entry.sharePercent}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="column stack">
              <div className="panel overview-data-panel">
                <div className="panel-header"><h3>Top Resource Groups</h3></div>
                <div className="table-grid overview-table-grid">
                  <div className="table-row table-head" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr', gap: '1rem' }}>
                    <div>Resource group</div><div>Amount</div><div>Share</div>
                  </div>
                  {overview.topResourceGroups.map((entry) => (
                    <div key={entry.label} className="table-row overview-table-row" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr', gap: '1rem' }}>
                      <div>{entry.label}</div>
                      <div>{formatCurrency(entry.amount, entry.currency)}</div>
                      <div>{entry.sharePercent}%</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel overview-insights-panel">
                <div className="panel-header"><h3>Operator Handoff</h3></div>
                <div className="overview-note-list">
                  {overview.notes.map((note) => <div key={note} className="overview-note-item">{note}</div>)}
                </div>
                <div className="gcp-overview-actions">
                  <button type="button" className="ghost" disabled={!canRunTerminalCommand} onClick={() => onRunTerminalCommand(`az costmanagement query --scope "/subscriptions/${subscriptionId}" --type Usage --timeframe MonthToDate --output jsonc`)}>Run cost query in terminal</button>
                  <button type="button" className="ghost" onClick={onOpenCompliance}>Open compliance</button>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
