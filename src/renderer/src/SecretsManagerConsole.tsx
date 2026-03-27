import { useEffect, useMemo, useState } from 'react'

import {
  createSecret,
  deleteSecret,
  describeSecret,
  getSecretDependencyReport,
  getSecretValue,
  listSecrets,
  putSecretResourcePolicy,
  restoreSecret,
  rotateSecret,
  tagSecret,
  untagSecret,
  updateSecretDescription,
  updateSecretValue
} from './api'
import type {
  AwsConnection,
  SecretDependencyReport,
  SecretsManagerSecretDetail,
  SecretsManagerSecretSummary,
  SecretsManagerSecretValue
} from '@shared/types'
import { ConfirmButton } from './ConfirmButton'

type ColKey = 'name' | 'description' | 'rotation' | 'versions' | 'lastChanged' | 'lastAccessed'

const COLUMNS: { key: ColKey; label: string; color: string }[] = [
  { key: 'name', label: 'Name', color: '#3b82f6' },
  { key: 'description', label: 'Description', color: '#14b8a6' },
  { key: 'rotation', label: 'Rotation', color: '#22c55e' },
  { key: 'versions', label: 'Versions', color: '#f59e0b' },
  { key: 'lastChanged', label: 'Last Changed', color: '#8b5cf6' },
  { key: 'lastAccessed', label: 'Last Accessed', color: '#a855f7' }
]

function getColValue(secret: SecretsManagerSecretSummary, key: ColKey): string {
  switch (key) {
    case 'name': return secret.name
    case 'description': return secret.description || '-'
    case 'rotation': return secret.rotationEnabled ? 'Enabled' : 'Disabled'
    case 'versions': return String(secret.versionCount)
    case 'lastChanged': return fmtTs(secret.lastChangedDate)
    case 'lastAccessed': return fmtTs(secret.lastAccessedDate)
  }
}

function fmtTs(value: string) {
  return value && value !== '-' ? new Date(value).toLocaleString() : '-'
}

function confidenceTone(value: 'high' | 'medium' | 'low') {
  if (value === 'high') return 'enabled'
  if (value === 'medium') return 'warn'
  return 'muted'
}

function riskTone(value: 'info' | 'warning' | 'critical') {
  if (value === 'critical') return 'deleted'
  if (value === 'warning') return 'disabled'
  return 'ok'
}

type MainTab = 'secrets' | 'create'
type SideTab = 'overview' | 'dependencies' | 'value' | 'versions' | 'policy' | 'tags'

type SecretDependencyNavigation =
  | { service: 'lambda'; functionName: string }
  | { service: 'ecs'; clusterArn: string; serviceName: string }
  | { service: 'eks'; clusterName: string }

export function SecretsManagerConsole({
  connection,
  onNavigate
}: {
  connection: AwsConnection
  onNavigate?: (target: SecretDependencyNavigation) => void
}) {
  const [mainTab, setMainTab] = useState<MainTab>('secrets')
  const [sideTab, setSideTab] = useState<SideTab>('overview')
  const [loading, setLoading] = useState(false)
  const [dependencyLoading, setDependencyLoading] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const [filter, setFilter] = useState('')
  const [visCols, setVisCols] = useState<Set<ColKey>>(() => new Set(COLUMNS.map((col) => col.key)))

  const [secrets, setSecrets] = useState<SecretsManagerSecretSummary[]>([])
  const [selectedSecretId, setSelectedSecretId] = useState('')
  const [detail, setDetail] = useState<SecretsManagerSecretDetail | null>(null)
  const [secretValue, setSecretValueState] = useState<SecretsManagerSecretValue | null>(null)
  const [dependencyReport, setDependencyReport] = useState<SecretDependencyReport | null>(null)
  const [valueDraft, setValueDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [policyDraft, setPolicyDraft] = useState('')

  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newKmsKeyId, setNewKmsKeyId] = useState('')

  const [tagKey, setTagKey] = useState('')
  const [tagValue, setTagValue] = useState('')

  async function loadDependencyReport(secretId: string) {
    setDependencyLoading(true)
    try {
      setDependencyReport(await getSecretDependencyReport(connection, secretId))
    } catch (e) {
      setDependencyReport(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDependencyLoading(false)
    }
  }

  async function refresh(nextSecretId?: string) {
    setError('')
    setLoading(true)
    try {
      const list = await listSecrets(connection)
      setSecrets(list)
      const target = nextSecretId ?? list.find((item) => item.arn === selectedSecretId)?.arn ?? list[0]?.arn ?? ''
      setSelectedSecretId(target)
      if (!target) {
        setDetail(null)
        setSecretValueState(null)
        setDependencyReport(null)
        return
      }

      const [nextDetail, nextValue] = await Promise.all([
        describeSecret(connection, target),
        getSecretValue(connection, target)
      ])
      setDetail(nextDetail)
      setSecretValueState(nextValue)
      setValueDraft(nextValue.secretString || nextValue.secretBinary)
      setDescriptionDraft(nextDetail.description)
      setPolicyDraft(nextDetail.policy)
      void loadDependencyReport(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [connection.sessionId, connection.region])

  async function selectSecret(arn: string) {
    setSelectedSecretId(arn)
    setError('')
    setDependencyReport(null)
    try {
      const [nextDetail, nextValue] = await Promise.all([
        describeSecret(connection, arn),
        getSecretValue(connection, arn)
      ])
      setDetail(nextDetail)
      setSecretValueState(nextValue)
      setValueDraft(nextValue.secretString || nextValue.secretBinary)
      setDescriptionDraft(nextDetail.description)
      setPolicyDraft(nextDetail.policy)
      void loadDependencyReport(arn)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doCreate() {
    if (!newName) return
    setError('')
    try {
      const arn = await createSecret(connection, {
        name: newName,
        description: newDescription,
        secretString: newValue,
        kmsKeyId: newKmsKeyId,
        tags: []
      })
      setNewName('')
      setNewDescription('')
      setNewValue('')
      setNewKmsKeyId('')
      setMsg('Secret created')
      setMainTab('secrets')
      await refresh(arn)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doUpdateValue() {
    if (!selectedSecretId) return
    try {
      await updateSecretValue(connection, selectedSecretId, valueDraft)
      setMsg('Value updated')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doUpdateDescription() {
    if (!selectedSecretId) return
    try {
      await updateSecretDescription(connection, selectedSecretId, descriptionDraft)
      setMsg('Description updated')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doRotate() {
    if (!selectedSecretId) return
    try {
      await rotateSecret(connection, selectedSecretId)
      setMsg('Rotation triggered')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doDelete() {
    if (!selectedSecretId) return
    try {
      await deleteSecret(connection, selectedSecretId, false)
      setMsg('Secret deleted')
      setSelectedSecretId('')
      setDetail(null)
      setSecretValueState(null)
      setDependencyReport(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doRestore() {
    if (!selectedSecretId) return
    try {
      await restoreSecret(connection, selectedSecretId)
      setMsg('Secret restored')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doSavePolicy() {
    if (!selectedSecretId) return
    try {
      await putSecretResourcePolicy(connection, selectedSecretId, policyDraft)
      setMsg('Policy saved')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doAddTag() {
    if (!selectedSecretId || !tagKey) return
    try {
      await tagSecret(connection, selectedSecretId, [{ key: tagKey, value: tagValue }])
      setTagKey('')
      setTagValue('')
      setMsg('Tag added')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doRemoveTag(key: string) {
    if (!selectedSecretId) return
    try {
      await untagSecret(connection, selectedSecretId, [key])
      setMsg('Tag removed')
      await refresh(selectedSecretId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doLoadVersion(versionId: string) {
    if (!selectedSecretId) return
    try {
      const value = await getSecretValue(connection, selectedSecretId, versionId)
      setSecretValueState(value)
      setValueDraft(value.secretString || value.secretBinary)
      setMsg(`Loaded version ${versionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const activeCols = COLUMNS.filter((col) => visCols.has(col.key))

  const filteredSecrets = useMemo(() => {
    if (!filter) return secrets
    const query = filter.toLowerCase()
    return secrets.filter((secret) => activeCols.some((col) => getColValue(secret, col.key).toLowerCase().includes(query)))
  }, [secrets, filter, activeCols])

  if (mainTab === 'create') {
    return (
      <div className="svc-console">
        <div className="svc-tab-bar">
          <button className="svc-tab" type="button" onClick={() => setMainTab('secrets')}>Cancel</button>
          <button className="svc-tab active" type="button">Create Secret</button>
        </div>
        {error && <div className="svc-error">{error}</div>}
        <div className="svc-panel">
          <div className="svc-form">
            <label><span>Name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="my-secret" /></label>
            <label><span>Description</span><input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Optional description" /></label>
            <label><span>KMS Key ID</span><input value={newKmsKeyId} onChange={(event) => setNewKmsKeyId(event.target.value)} placeholder="Optional KMS key" /></label>
            <label><span>Initial Value</span><textarea value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="Secret string value" /></label>
          </div>
          <div className="svc-btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="svc-btn success" disabled={!newName} onClick={() => void doCreate()}>Create Secret</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="svc-console">
      <div className="svc-tab-bar">
        <button className={`svc-tab ${mainTab === 'secrets' ? 'active' : ''}`} type="button" onClick={() => setMainTab('secrets')}>Secrets</button>
        <button className="svc-tab right" type="button" onClick={() => void refresh()}>Refresh</button>
      </div>

      {msg && <div className="svc-msg">{msg}</div>}
      {error && <div className="svc-error">{error}</div>}

      <input className="svc-search" placeholder="Filter rows across selected columns..." value={filter} onChange={(event) => setFilter(event.target.value)} />

      <div className="svc-chips">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            className={`svc-chip ${visCols.has(col.key) ? 'active' : ''}`}
            type="button"
            style={visCols.has(col.key) ? { background: col.color, borderColor: col.color } : undefined}
            onClick={() => setVisCols((previous) => {
              const next = new Set(previous)
              if (next.has(col.key)) next.delete(col.key)
              else next.add(col.key)
              return next
            })}
          >{col.label}</button>
        ))}
      </div>

      <div className="svc-layout">
        <div className="svc-table-area">
          <table className="svc-table">
            <thead>
              <tr>{activeCols.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={activeCols.length}>Gathering data</td></tr>}
              {!loading && filteredSecrets.map((secret) => (
                <tr key={secret.arn} className={secret.arn === selectedSecretId ? 'active' : ''} onClick={() => void selectSecret(secret.arn)}>
                  {activeCols.map((col) => (
                    <td key={col.key}>
                      {col.key === 'rotation'
                        ? <span className={`svc-badge ${secret.rotationEnabled ? 'enabled' : 'disabled'}`}>{secret.rotationEnabled ? 'Enabled' : 'Disabled'}</span>
                        : getColValue(secret, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loading && filteredSecrets.length === 0 && <div className="svc-empty">Gathering data</div>}
          {!loading && !filteredSecrets.length && <div className="svc-empty">No secrets found.</div>}
        </div>

        <div className="svc-sidebar">
          <div className="svc-side-tabs">
            <button className={sideTab === 'overview' ? 'active' : ''} type="button" onClick={() => setSideTab('overview')}>Overview</button>
            <button className={sideTab === 'dependencies' ? 'active' : ''} type="button" onClick={() => setSideTab('dependencies')}>Dependencies</button>
            <button className={sideTab === 'value' ? 'active' : ''} type="button" onClick={() => setSideTab('value')}>Value</button>
            <button className={sideTab === 'versions' ? 'active' : ''} type="button" onClick={() => setSideTab('versions')}>Versions</button>
            <button className={sideTab === 'policy' ? 'active' : ''} type="button" onClick={() => setSideTab('policy')}>Policy</button>
            <button className={sideTab === 'tags' ? 'active' : ''} type="button" onClick={() => setSideTab('tags')}>Tags</button>
          </div>
          <div className="svc-sidebar-body">

          {sideTab === 'overview' && (
            <>
              <div className="svc-section">
                <h3>Actions</h3>
                <div className="svc-actions">
                  <button className="svc-btn success" type="button" onClick={() => setMainTab('create')}>New Secret</button>
                  <button className="svc-btn primary" type="button" disabled={!selectedSecretId} onClick={() => void doRotate()}>Rotate</button>
                  {detail?.deletedDate ? (
                    <button className="svc-btn warn" type="button" onClick={() => void doRestore()}>Restore</button>
                  ) : (
                    <ConfirmButton className="svc-btn danger" onConfirm={() => void doDelete()} confirmLabel="Confirm Delete?">Delete</ConfirmButton>
                  )}
                </div>
              </div>

              <div className="svc-section">
                <h3>Secret Details</h3>
                {detail ? (
                  <div className="svc-kv">
                    <div className="svc-kv-row"><div className="svc-kv-label">Name</div><div className="svc-kv-value">{detail.name}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">ARN</div><div className="svc-kv-value">{detail.arn}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Status</div><div className="svc-kv-value">{detail.deletedDate ? <span className="svc-badge deleted">Deleted {fmtTs(detail.deletedDate)}</span> : <span className="svc-badge ok">Active</span>}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Rotation</div><div className="svc-kv-value">{detail.rotationEnabled ? <span className="svc-badge enabled">Enabled</span> : <span className="svc-badge disabled">Disabled</span>}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Next Rotation</div><div className="svc-kv-value">{fmtTs(detail.nextRotationDate)}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">KMS Key</div><div className="svc-kv-value">{detail.kmsKeyId || '-'}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Primary Region</div><div className="svc-kv-value">{detail.primaryRegion || '-'}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Owning Service</div><div className="svc-kv-value">{detail.owningService || '-'}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Last Changed</div><div className="svc-kv-value">{fmtTs(detail.lastChangedDate)}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Last Accessed</div><div className="svc-kv-value">{fmtTs(detail.lastAccessedDate)}</div></div>
                  </div>
                ) : <div className="svc-empty">Select a secret to inspect it.</div>}
              </div>

              {detail && (
                <div className="svc-section">
                  <h3>Description</h3>
                  <div className="svc-form">
                    <textarea value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} style={{ width: '100%' }} />
                  </div>
                  <div className="svc-btn-row">
                    <button type="button" className="svc-btn primary" onClick={() => void doUpdateDescription()}>Update Description</button>
                  </div>
                </div>
              )}
            </>
          )}

          {sideTab === 'dependencies' && (
            <div className="svc-section">
              <h3>Dependency Map</h3>
              <p style={{ marginTop: 0, color: '#9ca7b7', fontSize: 12 }}>
                Detection is conservative and heuristic unless the evidence shows a direct secret ARN or explicit task-definition secret mapping.
              </p>
              {dependencyLoading && <div className="svc-empty">Scanning likely consumers...</div>}
              {!dependencyLoading && !dependencyReport && <div className="svc-empty">Select a secret to analyze likely consumers.</div>}
              {!dependencyLoading && dependencyReport && (
                <>
                  <div className="svc-kv" style={{ marginBottom: 12 }}>
                    <div className="svc-kv-row"><div className="svc-kv-label">Likely Consumers</div><div className="svc-kv-value">{dependencyReport.dependencies.length}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Generated</div><div className="svc-kv-value">{fmtTs(dependencyReport.generatedAt)}</div></div>
                    <div className="svc-kv-row"><div className="svc-kv-label">Region</div><div className="svc-kv-value">{dependencyReport.region}</div></div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {dependencyReport.risks.length > 0
                      ? dependencyReport.risks.map((risk) => <span key={risk.id} className={`svc-badge ${riskTone(risk.level)}`}>{risk.title}</span>)
                      : <span className="svc-badge ok">No immediate dependency risks</span>}
                  </div>

                  {dependencyReport.risks.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {dependencyReport.risks.map((risk) => (
                        <div key={risk.id} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
                          <strong>{risk.title}:</strong> {risk.detail}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="svc-table-wrap secrets-dependency-table-wrap" style={{ maxHeight: 'calc(100vh - 600px)', marginBottom: 12 }}>
                    <table className="svc-table secrets-dependency-table">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Resource</th>
                          <th>Region</th>
                          <th>Signal</th>
                          <th>Evidence</th>
                          <th>Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dependencyReport.dependencies.map((dependency) => (
                          <tr key={dependency.id}>
                            <td>{dependency.serviceType}</td>
                            <td>
                              <div>{dependency.resourceName}</div>
                              <div style={{ fontSize: 11, color: '#9ca7b7' }}>{dependency.resourceId}</div>
                            </td>
                            <td>{dependency.region}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <span className={`svc-badge ${dependency.signal === 'confirmed' ? 'enabled' : 'warn'}`}>
                                  {dependency.signal === 'confirmed' ? 'Strong signal' : 'Heuristic'}
                                </span>
                                <span className={`svc-badge ${confidenceTone(dependency.confidence)}`}>{dependency.confidence}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>{dependency.reason}</div>
                              <div style={{ fontSize: 11, color: '#9ca7b7' }}>
                                {dependency.evidence.map((item) => `${item.field}: ${item.summary}`).join(' | ')}
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="svc-btn muted"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                disabled={!dependency.navigation || !onNavigate}
                                onClick={() => {
                                  if (!dependency.navigation || !onNavigate) return
                                  if (dependency.navigation.service === 'lambda') {
                                    onNavigate({ service: 'lambda', functionName: dependency.navigation.resourceId })
                                    return
                                  }
                                  if (dependency.navigation.service === 'ecs') {
                                    onNavigate({
                                      service: 'ecs',
                                      clusterArn: dependency.navigation.clusterArn,
                                      serviceName: dependency.navigation.serviceName
                                    })
                                    return
                                  }
                                  onNavigate({ service: 'eks', clusterName: dependency.navigation.clusterName })
                                }}
                              >Open</button>
                            </td>
                          </tr>
                        ))}
                        {dependencyReport.dependencies.length === 0 && (
                          <tr>
                            <td colSpan={6}>No likely consumers found in the current scan.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="svc-section" style={{ padding: 0, border: 'none' }}>
                    <h3>Secret Posture</h3>
                    <div className="svc-kv">
                      <div className="svc-kv-row"><div className="svc-kv-label">Rotation</div><div className="svc-kv-value">{dependencyReport.posture.rotationEnabled ? <span className="svc-badge enabled">Enabled</span> : <span className="svc-badge disabled">Disabled</span>}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Next Rotation</div><div className="svc-kv-value">{fmtTs(dependencyReport.posture.nextRotationDate)}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Versions</div><div className="svc-kv-value">{dependencyReport.posture.versionCount}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Policy</div><div className="svc-kv-value">{dependencyReport.posture.hasPolicy ? 'Present' : 'Missing'}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Last Accessed</div><div className="svc-kv-value">{fmtTs(dependencyReport.posture.lastAccessedDate)}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Tags</div><div className="svc-kv-value">{Object.keys(dependencyReport.posture.tags).length}</div></div>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {Object.entries(dependencyReport.posture.tags).length > 0
                        ? Object.entries(dependencyReport.posture.tags).map(([key, value]) => <span key={key} className="svc-badge ok">{key}={value}</span>)
                        : <span className="svc-badge muted">No tags</span>}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    {dependencyReport.notes.map((note) => (
                      <div key={note} style={{ fontSize: 12, color: '#9ca7b7', marginBottom: 4 }}>{note}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {sideTab === 'value' && (
            <div className="svc-section">
              <h3>Secret Value</h3>
              {detail ? (
                <>
                  {secretValue && (
                    <div className="svc-kv" style={{ marginBottom: 12 }}>
                      <div className="svc-kv-row"><div className="svc-kv-label">Version</div><div className="svc-kv-value">{secretValue.versionId || 'current'}</div></div>
                      <div className="svc-kv-row"><div className="svc-kv-label">Stages</div><div className="svc-kv-value">{secretValue.versionStages.join(', ') || '-'}</div></div>
                    </div>
                  )}
                  <textarea
                    value={valueDraft}
                    onChange={(event) => setValueDraft(event.target.value)}
                    rows={10}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, background: '#0f1318', border: '1px solid #3b4350', borderRadius: 4, color: '#edf1f6', padding: 10, resize: 'vertical' }}
                  />
                  <div className="svc-btn-row" style={{ marginTop: 10 }}>
                    <button type="button" className="svc-btn success" onClick={() => void doUpdateValue()}>Update Value</button>
                  </div>
                </>
              ) : <div className="svc-empty">Select a secret to view its value.</div>}
            </div>
          )}

          {sideTab === 'versions' && (
            <div className="svc-section">
              <h3>Versions</h3>
              {detail && detail.versions.length > 0 ? (
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
                  <table className="svc-table">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Stages</th>
                        <th>Created</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.versions.map((version) => (
                        <tr key={version.versionId}>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{version.versionId}</td>
                          <td>{version.stages.join(', ') || '-'}</td>
                          <td>{fmtTs(version.createdDate)}</td>
                          <td>
                            <button type="button" className="svc-btn muted" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => void doLoadVersion(version.versionId)}>Load</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : detail ? (
                <div className="svc-empty">No versions available.</div>
              ) : (
                <div className="svc-empty">Select a secret to view versions.</div>
              )}
            </div>
          )}

          {sideTab === 'policy' && (
            <div className="svc-section">
              <h3>Resource Policy</h3>
              {detail ? (
                <>
                  <textarea
                    value={policyDraft}
                    onChange={(event) => setPolicyDraft(event.target.value)}
                    rows={12}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, background: '#0f1318', border: '1px solid #3b4350', borderRadius: 4, color: '#edf1f6', padding: 10, resize: 'vertical' }}
                  />
                  <div className="svc-btn-row" style={{ marginTop: 10 }}>
                    <button type="button" className="svc-btn primary" onClick={() => void doSavePolicy()}>Save Policy</button>
                  </div>
                </>
              ) : <div className="svc-empty">Select a secret to edit its policy.</div>}
            </div>
          )}

          {sideTab === 'tags' && (
            <div className="svc-section">
              <h3>Tags</h3>
              {detail ? (
                <>
                  {Object.keys(detail.tags).length > 0 ? (
                    <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 500px)', marginBottom: 12 }}>
                      <table className="svc-table">
                        <thead>
                          <tr>
                            <th>Key</th>
                            <th>Value</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(detail.tags).map(([key, value]) => (
                            <tr key={key}>
                              <td>{key}</td>
                              <td>{value}</td>
                              <td>
                                <button type="button" className="svc-btn danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => void doRemoveTag(key)}>Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="svc-empty" style={{ padding: '8px 0' }}>No tags.</div>
                  )}
                  <div className="svc-inline">
                    <input value={tagKey} onChange={(event) => setTagKey(event.target.value)} placeholder="Key" style={{ width: 120 }} />
                    <input value={tagValue} onChange={(event) => setTagValue(event.target.value)} placeholder="Value" style={{ width: 160 }} />
                    <button type="button" className="svc-btn primary" onClick={() => void doAddTag()}>Add Tag</button>
                  </div>
                </>
              ) : <div className="svc-empty">Select a secret to manage tags.</div>}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
