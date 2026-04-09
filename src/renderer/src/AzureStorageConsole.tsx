import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  AzureStorageAccountSummary,
  AzureStorageBlobSummary,
  AzureStorageContainerSummary
} from '@shared/types'
import {
  deleteAzureStorageBlob,
  downloadAzureStorageBlobToPath,
  getAzureStorageBlobContent,
  listAzureStorageAccounts,
  listAzureStorageBlobs,
  listAzureStorageContainers,
  putAzureStorageBlobContent,
  uploadAzureStorageBlob
} from './api'
import { SvcState } from './SvcState'

const TEXT_CONTENT_TYPES = [
  'application/json',
  'application/javascript',
  'application/sql',
  'application/xml',
  'application/yaml',
  'text/'
] as const

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBlobSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function parentBlobPrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/\/+$/, '')
  if (!normalized) return ''
  const next = normalized.split('/').slice(0, -1).join('/')
  return next ? `${next}/` : ''
}

function isPreviewableTextBlob(blob: AzureStorageBlobSummary | null, previewContentType: string): boolean {
  if (!blob || blob.isFolder) return false
  const contentType = (previewContentType || blob.contentType).trim().toLowerCase()
  if (!contentType) return /\.([a-z0-9]+)$/i.test(blob.key)
  return TEXT_CONTENT_TYPES.some((candidate) => contentType.startsWith(candidate))
}

export function AzureStorageAccountsConsole({
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
  const [accounts, setAccounts] = useState<AzureStorageAccountSummary[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountsError, setAccountsError] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [containers, setContainers] = useState<AzureStorageContainerSummary[]>([])
  const [containersLoading, setContainersLoading] = useState(false)
  const [containersError, setContainersError] = useState('')
  const [selectedContainer, setSelectedContainer] = useState('')
  const [blobs, setBlobs] = useState<AzureStorageBlobSummary[]>([])
  const [blobsLoading, setBlobsLoading] = useState(false)
  const [blobsError, setBlobsError] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [prefix, setPrefix] = useState('')
  const [previewContent, setPreviewContent] = useState('')
  const [previewContentType, setPreviewContentType] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [containerSearch, setContainerSearch] = useState('')
  const [blobSearch, setBlobSearch] = useState('')
  const [detailTab, setDetailTab] = useState<'objects' | 'posture'>('objects')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  )
  const selectedBlob = useMemo(
    () => blobs.find((blob) => blob.key === selectedKey) ?? null,
    [blobs, selectedKey]
  )
  const selectedContainerSummary = useMemo(
    () => containers.find((container) => container.name === selectedContainer) ?? null,
    [containers, selectedContainer]
  )

  async function browseContainer(account: AzureStorageAccountSummary, containerName: string, nextPrefix = ''): Promise<void> {
    setSelectedContainer(containerName)
    setPrefix(nextPrefix)
    setSelectedKey('')
    setPreviewContent('')
    setPreviewContentType('')
    setPreviewError('')
    setEditing(false)
    setEditContent('')
    setBlobsError('')
    setBlobsLoading(true)

    try {
      setBlobs(await listAzureStorageBlobs(
        subscriptionId,
        account.resourceGroup,
        account.name,
        containerName,
        nextPrefix,
        account.primaryBlobEndpoint
      ))
    } catch (error) {
      setBlobs([])
      setBlobsError(normalizeError(error))
    } finally {
      setBlobsLoading(false)
    }
  }

  async function browseAccount(account: AzureStorageAccountSummary, preferredContainerName = ''): Promise<void> {
    setSelectedAccountId(account.id)
    setSelectedContainer('')
    setContainers([])
    setContainersError('')
    setBlobs([])
    setBlobsError('')
    setSelectedKey('')
    setPrefix('')
    setPreviewContent('')
    setPreviewContentType('')
    setPreviewError('')
    setEditing(false)
    setEditContent('')
    setContainersLoading(true)

    try {
      const nextContainers = await listAzureStorageContainers(
        subscriptionId,
        account.resourceGroup,
        account.name,
        account.primaryBlobEndpoint
      )
      setContainers(nextContainers)
      const targetContainer = nextContainers.find((container) => container.name === preferredContainerName)?.name ?? nextContainers[0]?.name ?? ''
      if (!targetContainer) {
        setSelectedContainer('')
        setBlobs([])
        return
      }

      await browseContainer(account, targetContainer, '')
    } catch (error) {
      setContainers([])
      setContainersError(normalizeError(error))
      setBlobs([])
    } finally {
      setContainersLoading(false)
    }
  }

  async function previewBlob(account: AzureStorageAccountSummary, containerName: string, blob: AzureStorageBlobSummary): Promise<void> {
    setSelectedKey(blob.key)
    setPreviewContent('')
    setPreviewContentType(blob.contentType || '')
    setPreviewError('')
    setEditing(false)
    setEditContent('')

    if (blob.isFolder) {
      await browseContainer(account, containerName, blob.key)
      return
    }

    if (!isPreviewableTextBlob(blob, blob.contentType)) {
      setPreviewError('Preview is limited to text-based blobs. Use Download for binary content.')
      return
    }

    if (blob.size > 1024 * 1024) {
      setPreviewError('Preview is limited to text blobs smaller than 1 MB. Download the blob to inspect larger content.')
      return
    }

    setPreviewLoading(true)
    try {
      const content = await getAzureStorageBlobContent(
        subscriptionId,
        account.resourceGroup,
        account.name,
        containerName,
        blob.key,
        account.primaryBlobEndpoint
      )
      setPreviewContent(content.body)
      setPreviewContentType(content.contentType || blob.contentType || 'text/plain')
    } catch (error) {
      setPreviewError(normalizeError(error))
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    setAccountsLoading(true)
    setAccountsError('')

    void listAzureStorageAccounts(subscriptionId, location)
      .then(async (nextAccounts) => {
        if (cancelled) return
        setAccounts(nextAccounts)
        const targetAccount = nextAccounts.find((account) => account.id === selectedAccountId) ?? nextAccounts[0] ?? null
        if (!targetAccount) {
          setSelectedAccountId('')
          setContainers([])
          setBlobs([])
          return
        }

        await browseAccount(targetAccount, selectedContainer)
      })
      .catch((error) => {
        if (cancelled) return
        setAccounts([])
        setAccountsError(normalizeError(error))
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [location, refreshNonce, subscriptionId])

  const locationLabel = location.trim() || 'all visible regions'
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase()
    if (!query) return accounts
    return accounts.filter((account) =>
      account.name.toLowerCase().includes(query)
      || account.resourceGroup.toLowerCase().includes(query)
      || account.skuName.toLowerCase().includes(query)
    )
  }, [accountSearch, accounts])
  const filteredContainers = useMemo(() => {
    const query = containerSearch.trim().toLowerCase()
    if (!query) return containers
    return containers.filter((container) => container.name.toLowerCase().includes(query))
  }, [containerSearch, containers])
  const filteredBlobs = useMemo(() => {
    const query = blobSearch.trim().toLowerCase()
    if (!query) return blobs
    return blobs.filter((blob) => blob.key.toLowerCase().includes(query))
  }, [blobSearch, blobs])
  const blobFileCount = blobs.filter((blob) => !blob.isFolder).length
  const blobFolderCount = blobs.filter((blob) => blob.isFolder).length
  const previewableSelectedBlob = isPreviewableTextBlob(selectedBlob, previewContentType)

  return (
    <div className="gcp-storage-shell">
      {message ? <div className="s3-msg s3-msg-ok">{message}<button type="button" className="s3-msg-close" onClick={() => setMessage('')}>x</button></div> : null}
      <section className="s3-shell-hero">
        <div className="s3-shell-hero-copy">
          <div className="s3-eyebrow">Azure object storage</div>
          <h2>Storage Accounts</h2>
          <p>Account posture, container visibility, and blob workflows stay bound to the selected subscription and region context.</p>
          <div className="s3-shell-meta-strip">
            <div className="s3-shell-meta-pill"><span>Subscription</span><strong>{subscriptionId}</strong></div>
            <div className="s3-shell-meta-pill"><span>Region lens</span><strong>{locationLabel}</strong></div>
            <div className="s3-shell-meta-pill"><span>Account</span><strong>{selectedAccount?.name || 'Pending'}</strong></div>
            <div className="s3-shell-meta-pill"><span>Container</span><strong>{selectedContainer || 'Pending'}</strong></div>
          </div>
        </div>
        <div className="s3-shell-hero-stats">
          <div className="s3-shell-stat-card s3-shell-stat-card-accent"><span>Accounts</span><strong>{accounts.length}</strong><small>Storage accounts visible in the current Azure context.</small></div>
          <div className="s3-shell-stat-card"><span>Containers</span><strong>{containers.length}</strong><small>{containersLoading ? 'Loading container posture.' : 'Discovered on the selected account.'}</small></div>
          <div className="s3-shell-stat-card"><span>Blobs in view</span><strong>{blobFileCount}</strong><small>{blobFolderCount} virtual folders in the current prefix.</small></div>
          <div className="s3-shell-stat-card"><span>Selected blob</span><strong>{selectedBlob ? formatBlobSize(selectedBlob.size) : 'None'}</strong><small>{selectedBlob?.key || 'Choose a blob to preview, edit, or download.'}</small></div>
        </div>
      </section>
      {accountsError ? (
        <section className="panel stack">
          <div className="error-banner">{accountsError}</div>
          <div className="profile-catalog-empty">
            <div className="eyebrow">Azure Storage Access</div>
            <h3>Storage accounts could not be loaded</h3>
            <p className="hero-path">Verify that the selected Azure credential chain can enumerate storage accounts for this subscription and region.</p>
          </div>
        </section>
      ) : accountsLoading ? (
        <section className="panel stack">
          <SvcState variant="loading" resourceName="Azure storage accounts" compact />
        </section>
      ) : accounts.length === 0 ? (
        <section className="panel stack">
          <div className="profile-catalog-empty">
            <div className="eyebrow">No Accounts</div>
            <h3>No Azure storage accounts matched the current region lens</h3>
            <p className="hero-path">Change the Azure region selector or verify that the subscription exposes storage accounts in this view.</p>
          </div>
        </section>
      ) : (
        <div className="s3-layout">
          <section className="s3-bucket-panel">
            <div className="s3-pane-head">
              <div>
                <span className="s3-pane-kicker">Tracked accounts</span>
                <h3>Storage account inventory</h3>
              </div>
              <span className="s3-pane-summary">{filteredAccounts.length} visible</span>
            </div>
            <input className="s3-filter-input" placeholder="Filter storage accounts..." value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} />
            <div className="s3-bucket-list">
              {filteredAccounts.map((account) => (
                <button key={account.id} type="button" className={`s3-bucket-row ${selectedAccountId === account.id ? 'active' : ''}`} onClick={() => void browseAccount(account, selectedContainer)}>
                  <div className="s3-bucket-row-top">
                    <div className="s3-bucket-row-identity">
                      <div className="s3-bucket-row-glyph">AZ</div>
                      <div className="s3-bucket-row-copy">
                        <span className="s3-bucket-row-kicker">Storage account</span>
                        <strong>{account.name}</strong>
                        <span>{account.resourceGroup} | {account.location || 'Unknown location'}</span>
                      </div>
                    </div>
                    <span className={`s3-status-badge ${account.publicNetworkAccess.toLowerCase() === 'enabled' ? 'info' : 'success'}`}>
                      {account.publicNetworkAccess || 'Unknown'}
                    </span>
                  </div>
                  <div className="s3-bucket-row-meta">
                    <span>SKU: {account.skuName || 'Unknown'}</span>
                    <span>TLS: {account.minimumTlsVersion || 'Unknown'}</span>
                  </div>
                  <div className="s3-bucket-row-metrics">
                    <div className="s3-bucket-row-metric is-primary"><span>Blob public access</span><strong>{account.allowBlobPublicAccess ? 'Allowed' : 'Disabled'}</strong></div>
                    <div className="s3-bucket-row-metric"><span>Versioning</span><strong>{account.versioningEnabled ? 'Enabled' : 'Disabled'}</strong></div>
                    <div className="s3-bucket-row-metric"><span>HTTPS only</span><strong>{account.httpsOnly ? 'Enforced' : 'Off'}</strong></div>
                  </div>
                  <div className="s3-bucket-row-note">{account.notes[0] || 'Account posture ready for deeper blob workflows.'}</div>
                </button>
              ))}
            </div>
          </section>
          <div className="s3-browser-panel">
            {!selectedAccount ? (
              <SvcState variant="no-selection" resourceName="storage account" message="Select a storage account to inspect posture or browse blobs." />
            ) : (
              <>
                {containersError ? <div className="s3-msg s3-msg-error">{containersError}<button type="button" className="s3-msg-close" onClick={() => setContainersError('')}>x</button></div> : null}
                {blobsError ? <div className="s3-msg s3-msg-error">{blobsError}<button type="button" className="s3-msg-close" onClick={() => setBlobsError('')}>x</button></div> : null}
                <section className="s3-detail-hero">
                  <div className="s3-detail-hero-copy">
                    <div className="s3-eyebrow">Account posture</div>
                    <h3>{selectedAccount.name}</h3>
                    <p>{selectedAccount.resourceGroup} | {selectedAccount.location || 'Unknown region'} | /{prefix || ''}</p>
                    <div className="s3-detail-meta-strip">
                      <div className="s3-detail-meta-pill"><span>SKU</span><strong>{selectedAccount.skuName || 'Unknown'}</strong></div>
                      <div className="s3-detail-meta-pill"><span>Access tier</span><strong>{selectedAccount.accessTier || 'n/a'}</strong></div>
                      <div className="s3-detail-meta-pill"><span>Network default</span><strong>{selectedAccount.defaultNetworkAction || 'Unknown'}</strong></div>
                      <div className="s3-detail-meta-pill"><span>Shared key</span><strong>{selectedAccount.allowSharedKeyAccess ? 'Allowed' : 'Disabled'}</strong></div>
                    </div>
                  </div>
                  <div className="s3-detail-hero-stats">
                    <div className={`s3-detail-stat-card ${selectedAccount.publicNetworkAccess.toLowerCase() === 'enabled' ? 'info' : 'success'}`}>
                      <span>Public network</span>
                      <strong>{selectedAccount.publicNetworkAccess || 'Unknown'}</strong>
                      <small>{selectedAccount.notes[0] || 'Network posture loaded from the Azure management plane.'}</small>
                    </div>
                    <div className="s3-detail-stat-card"><span>Containers</span><strong>{containers.length}</strong><small>{containersLoading ? 'Refreshing container posture.' : 'Visible to the current data-plane credentials.'}</small></div>
                    <div className="s3-detail-stat-card"><span>Change feed</span><strong>{selectedAccount.changeFeedEnabled ? 'Enabled' : 'Disabled'}</strong><small>Blob service audit signal for this account.</small></div>
                    <div className="s3-detail-stat-card"><span>Delete retention</span><strong>{selectedAccount.blobDeleteRetentionDays || 0} days</strong><small>Blob soft-delete window configured at the account level.</small></div>
                  </div>
                </section>

                <div className="s3-detail-tabs">
                  <button className={detailTab === 'objects' ? 'active' : ''} type="button" onClick={() => setDetailTab('objects')}>Containers & blobs</button>
                  <button className={detailTab === 'posture' ? 'active' : ''} type="button" onClick={() => setDetailTab('posture')}>Account posture</button>
                </div>
                {detailTab === 'objects' ? (
                  <>
                    <div className="s3-shell-toolbar">
                      <div className="s3-toolbar">
                        <button className="s3-btn" type="button" onClick={() => void browseAccount(selectedAccount, selectedContainer)} disabled={containersLoading}>Refresh</button>
                        <button className="s3-btn" type="button" onClick={() => void browseContainer(selectedAccount, selectedContainerSummary?.name || '', parentBlobPrefix(prefix))} disabled={!selectedContainerSummary || !prefix}>Go Up</button>
                        <button className="s3-btn" type="button" disabled={!canRunTerminalCommand} onClick={() => onRunTerminalCommand(`az storage account show -g "${selectedAccount.resourceGroup}" -n "${selectedAccount.name}" --subscription "${subscriptionId}" --output jsonc`)}>Inspect account</button>
                        <button className="s3-btn" type="button" onClick={() => onOpenMonitor(`Microsoft.Storage ${selectedAccount.name}`)}>Open monitor</button>
                        <button className="s3-btn" type="button" onClick={onOpenDirectAccess}>Direct access</button>
                        <button className="s3-btn" type="button" disabled={!selectedBlob || selectedBlob.isFolder} onClick={() => selectedBlob && selectedContainerSummary && void previewBlob(selectedAccount, selectedContainerSummary.name, selectedBlob)}>Open / Preview</button>
                      </div>
                      <div className="s3-shell-status">
                        <div className="s3-inline-note">{containersLoading || blobsLoading ? 'Refreshing storage workflow...' : 'Storage workflow ready'}</div>
                      </div>
                    </div>
                    <div className="s3-layout">
                      <section className="s3-bucket-panel">
                        <div className="s3-pane-head">
                          <div>
                            <span className="s3-pane-kicker">Containers</span>
                            <h3>Data-plane entry points</h3>
                          </div>
                          <span className="s3-pane-summary">{filteredContainers.length} visible</span>
                        </div>
                        <input className="s3-filter-input" placeholder="Filter containers..." value={containerSearch} onChange={(event) => setContainerSearch(event.target.value)} />
                        <div className="s3-bucket-list">
                          {filteredContainers.map((container) => (
                            <button key={container.name} type="button" className={`s3-bucket-row ${selectedContainer === container.name ? 'active' : ''}`} onClick={() => void browseContainer(selectedAccount, container.name, '')}>
                              <div className="s3-bucket-row-top">
                                <div className="s3-bucket-row-identity">
                                  <div className="s3-bucket-row-glyph">BLB</div>
                                  <div className="s3-bucket-row-copy">
                                    <span className="s3-bucket-row-kicker">Container</span>
                                    <strong>{container.name}</strong>
                                    <span>{container.publicAccess} | {container.leaseStatus}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="s3-bucket-row-meta">
                                <span>Last modified: {container.lastModified ? formatTimestamp(container.lastModified) : 'Unknown'}</span>
                              </div>
                              <div className="s3-bucket-row-metrics">
                                <div className="s3-bucket-row-metric is-primary"><span>Metadata</span><strong>{container.metadataCount}</strong></div>
                                <div className="s3-bucket-row-metric"><span>Immutability</span><strong>{container.hasImmutabilityPolicy ? 'Enabled' : 'Off'}</strong></div>
                                <div className="s3-bucket-row-metric"><span>Legal hold</span><strong>{container.hasLegalHold ? 'On' : 'Off'}</strong></div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                      <div className="s3-browser-panel">
                        {!selectedContainerSummary ? (
                          <SvcState variant="no-selection" resourceName="container" message="Select a container to browse blobs, preview text, or perform object workflows." />
                        ) : (
                          <>
                            <div className="s3-path-bar">
                              <span className="s3-path-label">Container: {selectedContainerSummary.name} Path: /{prefix}</span>
                              <div className="s3-path-actions">
                                <button className="s3-btn" type="button" onClick={() => void browseContainer(selectedAccount, selectedContainerSummary.name, parentBlobPrefix(prefix))} disabled={!prefix}>Up</button>
                                <button className="s3-btn" type="button" disabled={!selectedBlob || selectedBlob.isFolder} onClick={() => selectedBlob && void previewBlob(selectedAccount, selectedContainerSummary.name, selectedBlob)}>Open / Preview</button>
                              </div>
                            </div>
                            <input className="s3-filter-input" value={blobSearch} onChange={(event) => setBlobSearch(event.target.value)} placeholder="Filter blobs..." />
                            <div className="s3-object-table-wrap">
                              <table className="s3-object-table">
                                <thead>
                                  <tr><th>Name</th><th>Type</th><th>Access tier</th><th>Last modified</th><th>Size</th></tr>
                                </thead>
                                <tbody>
                                  {filteredBlobs.map((blob) => (
                                    <tr key={blob.key} className={selectedKey === blob.key ? 'active' : ''} onClick={() => { setSelectedKey(blob.key) }}>
                                      <td><button type="button" className="link-button" onClick={() => void previewBlob(selectedAccount, selectedContainerSummary.name, blob)}>{blob.key.replace(prefix, '') || blob.key}</button></td>
                                      <td>{blob.isFolder ? 'Prefix' : blob.contentType || 'Blob'}</td>
                                      <td>{blob.accessTier || '-'}</td>
                                      <td>{blob.lastModified ? formatTimestamp(blob.lastModified) : '-'}</td>
                                      <td>{blob.isFolder ? '-' : formatBlobSize(blob.size)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="s3-actions-row">
                              <button className="s3-btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={!selectedContainerSummary}>Upload</button>
                              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(event) => {
                                const file = event.target.files?.[0]
                                if (file && selectedContainerSummary) {
                                  void (async () => {
                                    try {
                                      const localPath = (file as File & { path?: string }).path?.trim() ?? ''
                                      const blobKey = `${prefix}${file.name}`
                                      if (localPath) {
                                        await uploadAzureStorageBlob(subscriptionId, selectedAccount.resourceGroup, selectedAccount.name, selectedContainerSummary.name, blobKey, localPath, selectedAccount.primaryBlobEndpoint)
                                      } else if (isPreviewableTextBlob({ key: file.name, size: file.size, lastModified: '', contentType: file.type, accessTier: '', isFolder: false }, file.type)) {
                                        await putAzureStorageBlobContent(subscriptionId, selectedAccount.resourceGroup, selectedAccount.name, selectedContainerSummary.name, blobKey, await file.text(), selectedAccount.primaryBlobEndpoint)
                                      } else {
                                        throw new Error('The selected file could not be uploaded because the local filesystem path was not exposed to the app.')
                                      }

                                      setMessage(`Uploaded ${file.name}`)
                                      await browseContainer(selectedAccount, selectedContainerSummary.name, prefix)
                                    } catch (error) {
                                      setBlobsError(normalizeError(error))
                                    }
                                  })()
                                }

                                event.target.value = ''
                              }} />
                              <button className="s3-btn" type="button" disabled={!selectedBlob || selectedBlob.isFolder} onClick={() => void (async () => {
                                if (!selectedBlob || selectedBlob.isFolder) return
                                try {
                                  const filePath = await downloadAzureStorageBlobToPath(subscriptionId, selectedAccount.resourceGroup, selectedAccount.name, selectedContainerSummary.name, selectedBlob.key, selectedAccount.primaryBlobEndpoint)
                                  if (filePath) setMessage(`Downloaded to ${filePath}`)
                                } catch (error) {
                                  setBlobsError(normalizeError(error))
                                }
                              })()}>Download</button>
                              <button className="s3-btn" type="button" disabled={!selectedBlob || selectedBlob.isFolder || !canRunTerminalCommand} onClick={() => selectedBlob && onRunTerminalCommand(`az storage blob show --account-name "${selectedAccount.name}" --container-name "${selectedContainerSummary.name}" --name "${selectedBlob.key}" --auth-mode login --output jsonc`)}>Inspect blob</button>
                              <button className="s3-btn s3-btn-danger" type="button" disabled={!selectedBlob || selectedBlob.isFolder} onClick={() => void (async () => {
                                if (!selectedBlob || selectedBlob.isFolder) return
                                if (!window.confirm(`Delete ${selectedBlob.key}?`)) return

                                try {
                                  await deleteAzureStorageBlob(subscriptionId, selectedAccount.resourceGroup, selectedAccount.name, selectedContainerSummary.name, selectedBlob.key, selectedAccount.primaryBlobEndpoint)
                                  setMessage(`Deleted ${selectedBlob.key}`)
                                  setSelectedKey('')
                                  setPreviewContent('')
                                  setPreviewError('')
                                  await browseContainer(selectedAccount, selectedContainerSummary.name, prefix)
                                } catch (error) {
                                  setBlobsError(normalizeError(error))
                                }
                              })()}>Delete</button>
                            </div>
                            <section className="panel stack">
                              <div className="panel-header"><h3>Blob preview</h3></div>
                              {!selectedBlob ? (
                                <SvcState variant="no-selection" resourceName="blob" message="Select a blob to preview, edit, or download." />
                              ) : previewLoading ? (
                                <SvcState variant="loading" resourceName="Azure blob preview" compact />
                              ) : previewError ? (
                                <div className="error-banner">{previewError}</div>
                              ) : !previewableSelectedBlob ? (
                                <div className="profile-catalog-empty">
                                  <div className="eyebrow">Binary Content</div>
                                  <h3>Preview is disabled for this blob</h3>
                                  <p className="hero-path">Download the blob to inspect binary content safely.</p>
                                </div>
                              ) : (
                                <>
                                  <div className="s3-path-bar">
                                    <span className="s3-path-label">{selectedBlob.key} | {previewContentType || selectedBlob.contentType || 'text/plain'}</span>
                                    <div className="s3-path-actions">
                                      <button className="s3-btn" type="button" onClick={() => { setEditing((current) => !current); setEditContent(previewContent) }}>{editing ? 'Cancel edit' : 'Edit text'}</button>
                                      <button className="s3-btn" type="button" disabled={!editing || saving} onClick={() => void (async () => {
                                        if (!selectedBlob) return
                                        try {
                                          setSaving(true)
                                          await putAzureStorageBlobContent(subscriptionId, selectedAccount.resourceGroup, selectedAccount.name, selectedContainerSummary.name, selectedBlob.key, editContent, selectedAccount.primaryBlobEndpoint)
                                          setPreviewContent(editContent)
                                          setEditing(false)
                                          setMessage(`Saved ${selectedBlob.key}`)
                                          await browseContainer(selectedAccount, selectedContainerSummary.name, prefix)
                                        } catch (error) {
                                          setPreviewError(normalizeError(error))
                                        } finally {
                                          setSaving(false)
                                        }
                                      })()}>{saving ? 'Saving...' : 'Save'}</button>
                                    </div>
                                  </div>
                                  <textarea className="cw-query-editor" value={editing ? editContent : previewContent} onChange={(event) => setEditContent(event.target.value)} readOnly={!editing} rows={18} spellCheck={false} />
                                </>
                              )}
                            </section>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="s3-summary-strip">
                      <div className="s3-summary-card"><span>Kind</span><strong>{selectedAccount.kind || 'Unknown'}</strong></div>
                      <div className="s3-summary-card"><span>Blob public access</span><strong>{selectedAccount.allowBlobPublicAccess ? 'Allowed' : 'Disabled'}</strong></div>
                      <div className="s3-summary-card"><span>Shared key access</span><strong>{selectedAccount.allowSharedKeyAccess ? 'Allowed' : 'Disabled'}</strong></div>
                      <div className="s3-summary-card"><span>Versioning</span><strong>{selectedAccount.versioningEnabled ? 'Enabled' : 'Disabled'}</strong></div>
                      <div className="s3-summary-card"><span>Change feed</span><strong>{selectedAccount.changeFeedEnabled ? 'Enabled' : 'Disabled'}</strong></div>
                      <div className="s3-summary-card"><span>Container soft delete</span><strong>{selectedAccount.containerDeleteRetentionDays || 0} days</strong></div>
                    </div>
                    <div className="s3-bucket-focus">
                      <div className="s3-bucket-focus-main">
                        <div className="s3-bucket-focus-top">
                          <div>
                            <span className="s3-bucket-focus-kicker">Selected account</span>
                            <h3>{selectedAccount.name}</h3>
                            <p>Subscription {subscriptionId} | Region lens {locationLabel}</p>
                          </div>
                        </div>
                        <div className="s3-bucket-focus-summary">
                          <div className="s3-bucket-focus-stat"><span>Default network action</span><strong>{selectedAccount.defaultNetworkAction || 'Unknown'}</strong></div>
                          <div className="s3-bucket-focus-stat"><span>Minimum TLS</span><strong>{selectedAccount.minimumTlsVersion || 'Unknown'}</strong></div>
                          <div className="s3-bucket-focus-stat"><span>Tags</span><strong>{selectedAccount.tagCount}</strong></div>
                        </div>
                        <div className="s3-bucket-focus-badges">
                          <span className={`s3-mini-badge ${selectedAccount.httpsOnly ? 'ok' : 'warn'}`}>{selectedAccount.httpsOnly ? 'HTTPS Only' : 'HTTPS Not Enforced'}</span>
                          <span className={`s3-mini-badge ${selectedAccount.allowBlobPublicAccess ? 'warn' : 'ok'}`}>{selectedAccount.allowBlobPublicAccess ? 'Blob Public Access Allowed' : 'Blob Public Access Disabled'}</span>
                          <span className={`s3-mini-badge ${selectedAccount.publicNetworkAccess.toLowerCase() === 'enabled' ? 'warn' : 'ok'}`}>{selectedAccount.publicNetworkAccess || 'Unknown Network Access'}</span>
                        </div>
                        {selectedAccount.notes.length > 0 ? <div className="overview-note-list">{selectedAccount.notes.map((note) => <div key={note} className="overview-note-item">{note}</div>)}</div> : null}
                      </div>
                      <div className="s3-next-actions-panel">
                        <div className="s3-next-action-card editable">
                          <div className="s3-next-action-copy">
                            <span className="s3-action-mode editable">Operator</span>
                            <strong>Inspect account in terminal</strong>
                            <span>Run the equivalent `az storage account show` command against the same subscription and resource group.</span>
                          </div>
                          <button className="s3-btn s3-next-action-btn" type="button" disabled={!canRunTerminalCommand} onClick={() => onRunTerminalCommand(`az storage account show -g "${selectedAccount.resourceGroup}" -n "${selectedAccount.name}" --subscription "${subscriptionId}" --output jsonc`)}>
                            Open Account
                          </button>
                        </div>
                        <div className="s3-next-action-card editable">
                          <div className="s3-next-action-copy">
                            <span className="s3-action-mode editable">Diagnostics</span>
                            <strong>Open Monitor</strong>
                            <span>Carry the selected storage account context into the Monitor investigation workspace.</span>
                          </div>
                          <button className="s3-btn s3-next-action-btn" type="button" onClick={() => onOpenMonitor(`Microsoft.Storage ${selectedAccount.name}`)}>
                            Open Monitor
                          </button>
                        </div>
                        <div className="s3-next-action-card editable">
                          <div className="s3-next-action-copy">
                            <span className="s3-action-mode editable">Workflow</span>
                            <strong>Return to blob operations</strong>
                            <span>Jump back to container and blob browsing for preview, edit, upload, download, and delete flows.</span>
                          </div>
                          <button className="s3-btn s3-next-action-btn" type="button" onClick={() => setDetailTab('objects')}>
                            Open Objects
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
