import { useEffect, useMemo, useState } from 'react'
import { SvcState } from './SvcState'

import type {
  ComparisonDiffRow,
  ComparisonDiffStatus,
  ComparisonFocusMode,
  ComparisonRequest,
  ComparisonResult,
  ServiceId
} from '@shared/types'
import { runComparison } from './api'
import type { useAwsPageConnection } from './AwsPage'

type CompareSeed = {
  token: number
  request: ComparisonRequest
}

type SelectorOption = {
  key: string
  label: string
  requestBase:
    | { kind: 'profile'; profile: string; label?: string }
    | { kind: 'assumed-role'; sessionId: string; label?: string }
}

type CompareViewMode = 'flat' | 'grouped'

const FOCUS_OPTIONS: Array<{ value: ComparisonFocusMode; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'security', label: 'Security' },
  { value: 'compute', label: 'Compute' },
  { value: 'networking', label: 'Networking' },
  { value: 'storage', label: 'Storage' },
  { value: 'drift-compliance', label: 'Drift / Compliance' },
  { value: 'cost', label: 'Cost' }
]

function defaultLeftKey(state: ReturnType<typeof useAwsPageConnection>, options: SelectorOption[]): string {
  if (state.activeSession) {
    const sessionKey = `session:${state.activeSession.id}`
    if (options.some((option) => option.key === sessionKey)) {
      return sessionKey
    }
  }

  const profileKey = state.profile ? `profile:${state.profile}` : ''
  if (profileKey && options.some((option) => option.key === profileKey)) {
    return profileKey
  }

  return options[0]?.key ?? ''
}

function defaultRightKey(leftKey: string, options: SelectorOption[]): string {
  return options.find((option) => option.key !== leftKey)?.key ?? leftKey
}

export function CompareWorkspace({
  connectionState,
  seed,
  refreshNonce = 0,
  onNavigate
}: {
  connectionState: ReturnType<typeof useAwsPageConnection>
  seed: CompareSeed | null
  refreshNonce?: number
  onNavigate: (serviceId: ServiceId, resourceId?: string, region?: string) => void
}) {
  const options = useMemo<SelectorOption[]>(() => {
    const profileOptions = connectionState.profiles.map((profile) => ({
      key: `profile:${profile.name}`,
      label: `Profile: ${profile.name}`,
      requestBase: { kind: 'profile' as const, profile: profile.name, label: profile.name }
    }))
    const sessionOptions = connectionState.sessions
      .filter((session) => session.status === 'active')
      .map((session) => ({
        key: `session:${session.id}`,
        label: `Session: ${session.label} (${session.accountId || 'unknown'})`,
        requestBase: { kind: 'assumed-role' as const, sessionId: session.id, label: session.label }
      }))

    return [...profileOptions, ...sessionOptions]
  }, [connectionState.profiles, connectionState.sessions])

  const [leftKey, setLeftKey] = useState('')
  const [rightKey, setRightKey] = useState('')
  const [leftRegion, setLeftRegion] = useState(connectionState.region)
  const [rightRegion, setRightRegion] = useState(connectionState.region)
  const [focusMode, setFocusMode] = useState<ComparisonFocusMode>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ComparisonDiffStatus>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [selectedRowId, setSelectedRowId] = useState('')
  const [viewMode, setViewMode] = useState<CompareViewMode>('flat')

  useEffect(() => {
    if (!options.length) {
      setLeftKey('')
      setRightKey('')
      return
    }

    setLeftKey((current) => current || defaultLeftKey(connectionState, options))
    setRightKey((current) => current || defaultRightKey(defaultLeftKey(connectionState, options), options))
  }, [connectionState, options])

  useEffect(() => {
    setLeftRegion(connectionState.region)
    setRightRegion(connectionState.region)
  }, [connectionState.region])

  useEffect(() => {
    if (!seed) {
      return
    }

    const nextLeftKey = seed.request.left.kind === 'profile'
      ? `profile:${seed.request.left.profile}`
      : `session:${seed.request.left.sessionId}`
    const nextRightKey = seed.request.right.kind === 'profile'
      ? `profile:${seed.request.right.profile}`
      : `session:${seed.request.right.sessionId}`

    setLeftKey(nextLeftKey)
    setRightKey(nextRightKey)
    setLeftRegion(seed.request.left.region)
    setRightRegion(seed.request.right.region)
    void handleCompare(seed.request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.token])

  const selectedRow = useMemo(() => {
    return result?.groups.flatMap((group) => group.rows).find((row) => row.id === selectedRowId) ?? null
  }, [result, selectedRowId])

  const filteredGroups = useMemo(() => {
    if (!result) return []
    const query = search.trim().toLowerCase()

    return result.groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (focusMode !== 'all' && !row.focusModes.includes(focusMode)) return false
          if (statusFilter !== 'all' && row.status !== statusFilter) return false
          if (!query) return true
          return `${row.title} ${row.subtitle} ${row.left.value} ${row.right.value} ${row.resourceType} ${row.rationale}`.toLowerCase().includes(query)
        })
      }))
      .filter((group) => group.rows.length > 0)
  }, [focusMode, result, search, statusFilter])

  const flatRows = useMemo(() => {
    return filteredGroups.flatMap((group) =>
      group.rows.map((row) => ({
        ...row,
        sectionLabel: group.label
      }))
    )
  }, [filteredGroups])

  function buildRequest(): ComparisonRequest | null {
    const left = options.find((option) => option.key === leftKey)
    const right = options.find((option) => option.key === rightKey)
    if (!left || !right) return null

    return {
      left: { ...left.requestBase, region: leftRegion },
      right: { ...right.requestBase, region: rightRegion }
    }
  }

  async function handleCompare(prebuilt?: ComparisonRequest): Promise<void> {
    const request = prebuilt ?? buildRequest()
    if (!request) {
      setError('Choose two contexts to compare.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const next = await runComparison(request)
      setResult(next)
      setSelectedRowId((current) => {
        const rows = next.groups.flatMap((group) => group.rows)
        return rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? '')
      })
    } catch (compareError) {
      setResult(null)
      setSelectedRowId('')
      setError(compareError instanceof Error ? compareError.message : String(compareError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (refreshNonce === 0 || !result) {
      return
    }

    void handleCompare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce])

  function renderRow(row: ComparisonDiffRow) {
    return (
      <div
        key={row.id}
        className={`table-row compare-grid ${selectedRowId === row.id ? 'compare-row-active' : ''}`}
        onClick={() => setSelectedRowId(row.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setSelectedRowId(row.id)
          }
        }}
      >
        <div>
          <strong>{row.title}</strong>
          <div className="hero-path">{row.subtitle}</div>
          <div className="hero-path">{row.rationale}</div>
        </div>
        <div>
          <strong>{row.left.value}</strong>
          <div className="hero-path">{row.left.secondary}</div>
        </div>
        <div>
          <strong>{row.right.value}</strong>
          <div className="hero-path">{row.right.secondary}</div>
        </div>
        <div>
          <span className={`status-chip ${row.status}`}>{row.status}</span>
          <div className="hero-path">Risk: {row.risk}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      {error && <SvcState variant="error" error={error} />}

      <section className="hero catalog-hero">
        <div>
          <div className="eyebrow">Compare</div>
          <h2>Cross-Account Diff Mode</h2>
          <p className="hero-path">Compare two profile or assumed-session contexts across inventory, posture, ownership tags, cost signals, and operational risk.</p>
        </div>
      </section>

      <section className="panel stack">
        <div className="panel-header">
          <h3>Contexts</h3>
          <button type="button" className="accent" disabled={loading} onClick={() => void handleCompare()}>
            {loading ? 'Comparing...' : 'Run Diff'}
          </button>
        </div>
        <div className="session-hub-form-grid">
          <label className="field">
            <span>Left Context</span>
            <select value={leftKey} onChange={(event) => setLeftKey(event.target.value)}>
              {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Left Region</span>
            <select value={leftRegion} onChange={(event) => setLeftRegion(event.target.value)}>
              {connectionState.regions.map((region) => <option key={region.id} value={region.id}>{region.id}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Right Context</span>
            <select value={rightKey} onChange={(event) => setRightKey(event.target.value)}>
              {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Right Region</span>
            <select value={rightRegion} onChange={(event) => setRightRegion(event.target.value)}>
              {connectionState.regions.map((region) => <option key={region.id} value={region.id}>{region.id}</option>)}
            </select>
          </label>
        </div>
      </section>

      {result ? (
        <>
          <section className="overview-tiles">
            {result.summary.totals.map((item) => (
              <div key={item.id} className="overview-tile">
                <strong>{item.leftValue} / {item.rightValue}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </section>

          <section className="workspace-grid compare-layout">
            <div className="column stack">
              {selectedRow && (
                <section className="panel stack">
                  <div className="panel-header">
                    <h3>Detail</h3>
                    {selectedRow.navigation && (
                      <button
                        type="button"
                        onClick={() => onNavigate(selectedRow.navigation!.serviceId, selectedRow.navigation!.resourceLabel, selectedRow.navigation!.region)}
                      >
                        Open {selectedRow.navigation.serviceId}
                      </button>
                    )}
                  </div>
                  <div className="table-grid">
                    <div className="table-row table-head compare-detail-grid">
                      <div>Field</div>
                      <div>Left</div>
                      <div>Right</div>
                    </div>
                    {selectedRow.detailFields.map((field) => (
                      <div key={field.key} className="table-row compare-detail-grid">
                        <div>{field.label}</div>
                        <div>{field.leftValue || '-'}</div>
                        <div>{field.rightValue || '-'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="column stack">
              <section className="panel stack">
                <div className="panel-header">
                  <h3>Filters</h3>
                </div>
                <div className="overview-chip-row">
                  <button
                    type="button"
                    className={`overview-service-chip ${viewMode === 'flat' ? 'active' : ''}`}
                    onClick={() => setViewMode('flat')}
                  >
                    <span>Single Table</span>
                  </button>
                  <button
                    type="button"
                    className={`overview-service-chip ${viewMode === 'grouped' ? 'active' : ''}`}
                    onClick={() => setViewMode('grouped')}
                  >
                    <span>Grouped Tables</span>
                  </button>
                </div>
                <div className="overview-chip-row">
                  {FOCUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`overview-service-chip ${focusMode === option.value ? 'active' : ''}`}
                      onClick={() => setFocusMode(option.value)}
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
                <div className="session-hub-form-grid">
                  <label className="field">
                    <span>Status</span>
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ComparisonDiffStatus)}>
                      <option value="all">All</option>
                      <option value="different">Different</option>
                      <option value="left-only">Only in left</option>
                      <option value="right-only">Only in right</option>
                      <option value="same">Same</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Search</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter rows" />
                  </label>
                </div>
              </section>

              {viewMode === 'flat' ? (
                <section className="panel stack">
                  <div className="panel-header">
                    <h3>All Differences</h3>
                    <span className="hero-path">{flatRows.length} row{flatRows.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="table-grid">
                    <div className="table-row table-head compare-flat-grid">
                      <div>Section</div>
                      <div>Resource</div>
                      <div>{result.leftContext.label}</div>
                      <div>{result.rightContext.label}</div>
                      <div>Status</div>
                    </div>
                    {flatRows.map((row) => (
                      <div
                        key={row.id}
                        className={`table-row compare-flat-grid ${selectedRowId === row.id ? 'compare-row-active' : ''}`}
                        onClick={() => setSelectedRowId(row.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedRowId(row.id)
                          }
                        }}
                      >
                        <div>
                          <strong>{row.sectionLabel}</strong>
                          <div className="hero-path">{row.resourceType}</div>
                        </div>
                        <div>
                          <strong>{row.title}</strong>
                          <div className="hero-path">{row.subtitle}</div>
                          <div className="hero-path">{row.rationale}</div>
                        </div>
                        <div>
                          <strong>{row.left.value}</strong>
                          <div className="hero-path">{row.left.secondary}</div>
                        </div>
                        <div>
                          <strong>{row.right.value}</strong>
                          <div className="hero-path">{row.right.secondary}</div>
                        </div>
                        <div>
                          <span className={`status-chip ${row.status}`}>{row.status}</span>
                          <div className="hero-path">Risk: {row.risk}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                filteredGroups.map((group) => (
                  <section key={group.id} className="panel stack">
                    <div className="panel-header">
                      <h3>{group.label}</h3>
                      <span className="hero-path">{group.rows.length} row{group.rows.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="table-grid">
                      <div className="table-row table-head compare-grid">
                        <div>Resource</div>
                        <div>{result.leftContext.label}</div>
                        <div>{result.rightContext.label}</div>
                        <div>Status</div>
                      </div>
                      {group.rows.map(renderRow)}
                    </div>
                  </section>
                ))
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <SvcState variant="no-selection" message="Choose two contexts, then run the diff to load summary totals, inventory deltas, posture changes, ownership tags, and cost signals." />
        </section>
      )}
    </div>
  )
}
