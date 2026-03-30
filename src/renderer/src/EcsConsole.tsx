import { useEffect, useMemo, useState } from 'react'
import './ecs.css'
import { SvcState } from './SvcState'

import type {
  AwsConnection,
  CorrelatedSignalReference,
  EcsContainerSummary,
  EcsDiagnosticsIndicator,
  EcsDiagnosticsTaskRow,
  EcsServiceDiagnostics,
  EcsServiceSummary,
  GeneratedArtifact,
  ObservabilityPostureReport
} from '@shared/types'
import {
  forceEcsRedeploy,
  getEcsContainerLogs,
  getEcsDiagnostics,
  getEcsObservabilityReport,
  listEcsClusters,
  listEcsServices,
  stopEcsTask,
  updateEcsDesiredCount
} from './api'
import { ConfirmButton } from './ConfirmButton'
import { ObservabilityResilienceLab } from './ObservabilityResilienceLab'
import { FreshnessIndicator, useFreshnessState } from './freshness'

type MainTab = 'services' | 'tasks' | 'lab'
type ServiceColumnKey = 'serviceName' | 'status' | 'running' | 'launchType' | 'taskDefinition' | 'deploymentStatus'
type TaskColumnKey = 'taskId' | 'lastStatus' | 'health' | 'startedAt' | 'stoppedReason' | 'containers'

const SERVICE_COLUMNS: { key: ServiceColumnKey; label: string; color: string }[] = [
  { key: 'serviceName', label: 'Service', color: '#3b82f6' },
  { key: 'status', label: 'Status', color: '#22c55e' },
  { key: 'running', label: 'Running', color: '#14b8a6' },
  { key: 'launchType', label: 'Launch Type', color: '#8b5cf6' },
  { key: 'taskDefinition', label: 'Task Def', color: '#f59e0b' },
  { key: 'deploymentStatus', label: 'Deployment', color: '#06b6d4' }
]

const TASK_COLUMNS: { key: TaskColumnKey; label: string; color: string }[] = [
  { key: 'taskId', label: 'Task ID', color: '#3b82f6' },
  { key: 'lastStatus', label: 'Status', color: '#22c55e' },
  { key: 'health', label: 'Health', color: '#e11d48' },
  { key: 'startedAt', label: 'Started', color: '#14b8a6' },
  { key: 'stoppedReason', label: 'Stop Reason', color: '#f59e0b' },
  { key: 'containers', label: 'Containers', color: '#06b6d4' }
]

function fmtTs(v: string): string {
  return v && v !== '-' ? new Date(v).toLocaleString() : '-'
}

function taskStateTone(task: EcsDiagnosticsTaskRow): string {
  if (task.isFailed) return 'FAILED'
  if (task.isPending) return 'PENDING'
  return task.lastStatus
}

function diagnosticsCommand(clusterArn: string, serviceName: string): string {
  return `aws ecs describe-services --cluster "${clusterArn}" --services "${serviceName}" --include TAGS`
}

function getServiceCellValue(svc: EcsServiceSummary, key: ServiceColumnKey): string {
  switch (key) {
    case 'serviceName': return svc.serviceName
    case 'status': return svc.status
    case 'running': return `${svc.runningCount}/${svc.desiredCount}`
    case 'launchType': return svc.launchType
    case 'taskDefinition': return svc.taskDefinition.split('/').pop() ?? svc.taskDefinition
    case 'deploymentStatus': return svc.deploymentStatus
  }
}

function healthTone(severity: EcsDiagnosticsIndicator['severity']): string {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function KV({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="ecs-kv">
      {items.map(([label, value]) => (
        <div key={label} className="ecs-kv-row">
          <div className="ecs-kv-label">{label}</div>
          <div className="ecs-kv-value">{value}</div>
        </div>
      ))}
    </div>
  )
}

export function EcsConsole({
  connection,
  refreshNonce = 0,
  focusService,
  onRunTerminalCommand
}: {
  connection: AwsConnection
  refreshNonce?: number
  focusService?: { token: number; clusterArn: string; serviceName: string } | null
  onRunTerminalCommand?: (command: string) => void
}) {
  const [mainTab, setMainTab] = useState<MainTab>('services')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [visibleServiceCols, setVisibleServiceCols] = useState<Set<ServiceColumnKey>>(
    new Set(SERVICE_COLUMNS.map((column) => column.key))
  )
  const [visibleTaskCols, setVisibleTaskCols] = useState<Set<TaskColumnKey>>(
    new Set(TASK_COLUMNS.map((column) => column.key))
  )
  const [clusters, setClusters] = useState<Array<{ clusterArn: string; clusterName: string; activeServicesCount: number; runningTasksCount: number }>>([])
  const [selectedClusterArn, setSelectedClusterArn] = useState('')
  const [services, setServices] = useState<EcsServiceSummary[]>([])
  const [selectedServiceName, setSelectedServiceName] = useState('')
  const [diagnostics, setDiagnostics] = useState<EcsServiceDiagnostics | null>(null)
  const [selectedTaskArn, setSelectedTaskArn] = useState('')
  const [selectedLogTargetKey, setSelectedLogTargetKey] = useState('')
  const [logs, setLogs] = useState<Array<{ timestamp: number; message: string }>>([])
  const [logStatus, setLogStatus] = useState('')
  const [desiredCount, setDesiredCount] = useState('1')
  const [appliedFocusToken, setAppliedFocusToken] = useState(0)
  const [labReport, setLabReport] = useState<ObservabilityPostureReport | null>(null)
  const [labLoading, setLabLoading] = useState(false)
  const [labError, setLabError] = useState('')
  const {
    freshness: diagnosticsFreshness,
    beginRefresh: beginDiagnosticsRefresh,
    completeRefresh: completeDiagnosticsRefresh,
    failRefresh: failDiagnosticsRefresh
  } = useFreshnessState({ staleAfterMs: 2 * 60 * 1000 })
  const {
    freshness: labFreshness,
    beginRefresh: beginLabRefresh,
    completeRefresh: completeLabRefresh,
    failRefresh: failLabRefresh
  } = useFreshnessState({ staleAfterMs: 5 * 60 * 1000 })

  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.clusterArn === selectedClusterArn) ?? null,
    [clusters, selectedClusterArn]
  )
  const selectedClusterTarget = selectedCluster?.clusterName || selectedClusterArn

  const activeServiceCols = SERVICE_COLUMNS.filter((column) => visibleServiceCols.has(column.key))
  const activeTaskCols = TASK_COLUMNS.filter((column) => visibleTaskCols.has(column.key))

  const filteredServices = useMemo(() => {
    if (!search) return services
    const query = search.toLowerCase()
    return services.filter((service) =>
      Array.from(visibleServiceCols).some((key) => getServiceCellValue(service, key).toLowerCase().includes(query))
    )
  }, [search, services, visibleServiceCols])

  const taskRows = diagnostics?.taskRows ?? []
  const filteredTasks = useMemo(() => {
    if (!search) return taskRows
    const query = search.toLowerCase()
    return taskRows.filter((task) =>
      task.taskId.toLowerCase().includes(query) ||
      task.lastStatus.toLowerCase().includes(query) ||
      task.stoppedReason.toLowerCase().includes(query) ||
      task.containers.some((container) => container.name.toLowerCase().includes(query) || container.image.toLowerCase().includes(query))
    )
  }, [search, taskRows])

  const selectedTask = useMemo(() => {
    if (!diagnostics) return null
    return diagnostics.taskRows.find((task) => task.taskArn === selectedTaskArn) ?? diagnostics.taskRows[0] ?? diagnostics.selectedTask
  }, [diagnostics, selectedTaskArn])

  const selectedLogTarget = useMemo(() => {
    if (!diagnostics) return null
    const fallback = selectedTask
      ? diagnostics.logTargets.find((target) => target.taskArn === selectedTask.taskArn && target.available) ?? null
      : diagnostics.logTargets.find((target) => target.available) ?? null
    return diagnostics.logTargets.find((target) => `${target.taskArn}:${target.containerName}` === selectedLogTargetKey) ?? fallback
  }, [diagnostics, selectedLogTargetKey, selectedTask])

  async function load(
    clusterArn?: string,
    serviceName?: string,
    reason: 'initial' | 'manual' | 'background' | 'selection' = 'manual'
  ) {
    beginDiagnosticsRefresh(reason)
    setLoading(true)
    setError('')
    try {
      const nextClusters = await listEcsClusters(connection)
      setClusters(nextClusters)
      const resolvedCluster = clusterArn ?? selectedClusterArn ?? nextClusters[0]?.clusterArn ?? ''
      setSelectedClusterArn(resolvedCluster)

      if (!resolvedCluster) {
        setServices([])
        setDiagnostics(null)
        return
      }

      const resolvedClusterSummary = nextClusters.find((cluster) => cluster.clusterArn === resolvedCluster) ?? null
      const resolvedClusterTarget = resolvedClusterSummary?.clusterName || resolvedCluster
      const nextServices = await listEcsServices(connection, resolvedClusterTarget)
      setServices(nextServices)
      const requestedService = serviceName ?? selectedServiceName
      const resolvedService = requestedService && nextServices.some((service) => service.serviceName === requestedService)
        ? requestedService
        : nextServices[0]?.serviceName ?? ''
      setSelectedServiceName(resolvedService)

      if (!resolvedService) {
        setDiagnostics(null)
        setLogs([])
        setLogStatus('')
        return
      }

      const nextDiagnostics = await getEcsDiagnostics(connection, resolvedClusterTarget, resolvedService)
      setDiagnostics(nextDiagnostics)
      setLabReport(null)
      setLabError('')
      setDesiredCount(String(nextDiagnostics.service.desiredCount))
      const nextSelectedTaskArn = nextDiagnostics.taskRows.some((task) => task.taskArn === selectedTaskArn)
        ? selectedTaskArn
        : (nextDiagnostics.taskRows[0]?.taskArn ?? '')
      setSelectedTaskArn(nextSelectedTaskArn)
      const nextLogTarget = nextDiagnostics.logTargets.find((target) => `${target.taskArn}:${target.containerName}` === selectedLogTargetKey && target.available) ??
        nextDiagnostics.logTargets.find((target) => target.taskArn === nextSelectedTaskArn && target.available) ??
        nextDiagnostics.logTargets.find((target) => target.available)
      setSelectedLogTargetKey(nextLogTarget ? `${nextLogTarget.taskArn}:${nextLogTarget.containerName}` : '')
      setLogs([])
      setLogStatus('')
      completeDiagnosticsRefresh()
    } catch (e) {
      failDiagnosticsRefresh()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(undefined, undefined, 'initial')
  }, [connection.sessionId, connection.region])

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void load(selectedClusterArn, selectedServiceName, 'manual')
  }, [refreshNonce, selectedClusterArn, selectedServiceName])

  useEffect(() => {
    if (!focusService || focusService.token === appliedFocusToken) return

    if (focusService.clusterArn && focusService.clusterArn !== selectedClusterArn) {
      setAppliedFocusToken(focusService.token)
      void load(focusService.clusterArn, focusService.serviceName)
      return
    }

    const match = services.find((service) => service.serviceName === focusService.serviceName)
    if (!match) return

    setAppliedFocusToken(focusService.token)
    setMainTab('services')
    void selectService(match.serviceName)
  }, [appliedFocusToken, focusService, selectedClusterArn, services])

  useEffect(() => {
    if (!selectedLogTarget || !selectedLogTarget.available) {
      setLogs([])
      setLogStatus(selectedLogTarget ? selectedLogTarget.reason : '')
      return
    }

    const logTarget = selectedLogTarget
    let cancelled = false
    async function run() {
      setLogStatus('Loading logs...')
      try {
        const nextLogs = await getEcsContainerLogs(connection, logTarget.logGroup, logTarget.logStream)
        if (cancelled) return
        setLogs(nextLogs)
        setLogStatus(nextLogs.length > 0 ? '' : 'No recent log lines were returned for this container.')
      } catch (e) {
        if (cancelled) return
        setLogs([])
        setLogStatus(e instanceof Error ? e.message : String(e))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [connection, selectedLogTarget])

  async function loadLab() {
    if (!selectedClusterTarget || !selectedServiceName) return
    beginLabRefresh('background')
    setLabLoading(true)
    setLabError('')
    try {
      const report = await getEcsObservabilityReport(connection, selectedClusterTarget, selectedServiceName)
      setLabReport(report)
      completeLabRefresh()
    } catch (e) {
      failLabRefresh()
      setLabError(e instanceof Error ? e.message : 'Failed to load observability lab')
    } finally {
      setLabLoading(false)
    }
  }

  useEffect(() => {
    if (mainTab !== 'lab' || !selectedServiceName) return
    if (labReport?.scope.kind === 'ecs' && labReport.scope.serviceName === selectedServiceName) return
    void loadLab()
  }, [connection, labReport, mainTab, selectedClusterTarget, selectedServiceName])

  async function selectService(serviceName: string) {
    setSelectedServiceName(serviceName)
    beginDiagnosticsRefresh('selection')
    setMsg('')
    setError('')
    setLogs([])
    setLogStatus('')
    try {
      const nextDiagnostics = await getEcsDiagnostics(connection, selectedClusterTarget, serviceName)
      setDiagnostics(nextDiagnostics)
      setDesiredCount(String(nextDiagnostics.service.desiredCount))
      const nextSelectedTaskArn = nextDiagnostics.taskRows.some((task) => task.taskArn === selectedTaskArn)
        ? selectedTaskArn
        : (nextDiagnostics.taskRows[0]?.taskArn ?? '')
      setSelectedTaskArn(nextSelectedTaskArn)
      const nextLogTarget = nextDiagnostics.logTargets.find((target) => `${target.taskArn}:${target.containerName}` === selectedLogTargetKey && target.available) ??
        nextDiagnostics.logTargets.find((target) => target.taskArn === nextSelectedTaskArn && target.available) ??
        nextDiagnostics.logTargets.find((target) => target.available)
      setSelectedLogTargetKey(nextLogTarget ? `${nextLogTarget.taskArn}:${nextLogTarget.containerName}` : '')
      completeDiagnosticsRefresh()
    } catch (e) {
      failDiagnosticsRefresh()
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function doScale() {
    setBusy(true)
    setMsg('')
    try {
      await updateEcsDesiredCount(connection, selectedClusterTarget, selectedServiceName, Number(desiredCount) || 0)
      setMsg('Desired count updated')
      await load(selectedClusterArn, selectedServiceName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doRedeploy() {
    setBusy(true)
    setMsg('')
    try {
      await forceEcsRedeploy(connection, selectedClusterTarget, selectedServiceName)
      setMsg('Force redeploy initiated')
      await load(selectedClusterArn, selectedServiceName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doStopTask(taskArn: string) {
    setBusy(true)
    setMsg('')
    try {
      await stopEcsTask(connection, selectedClusterTarget, taskArn)
      setMsg('Task stopped')
      await load(selectedClusterArn, selectedServiceName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function selectTask(taskArn: string) {
    setSelectedTaskArn(taskArn)
    const logTarget = diagnostics?.logTargets.find((target) => target.taskArn === taskArn && target.available) ?? null
    setSelectedLogTargetKey(logTarget ? `${logTarget.taskArn}:${logTarget.containerName}` : '')
  }

  function selectContainerLog(container: EcsContainerSummary) {
    if (!selectedTask) return
    setSelectedLogTargetKey(`${selectedTask.taskArn}:${container.name}`)
  }

  function toggleServiceCol(key: ServiceColumnKey) {
    setVisibleServiceCols((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleTaskCol(key: TaskColumnKey) {
    setVisibleTaskCols((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleLabArtifactRun(artifact: GeneratedArtifact) {
    onRunTerminalCommand?.(artifact.content)
    setMsg('Artifact command opened in terminal')
  }

  function handleLabSignalNavigate(signal: CorrelatedSignalReference) {
    if (signal.targetView === 'logs' || signal.targetView === 'services') {
      setMainTab(signal.targetView === 'logs' ? 'tasks' : 'services')
    }
  }

  if (loading && !diagnostics && services.length === 0) {
    return <SvcState variant="loading" resourceName="ECS deployment diagnostics" />
  }

  return (
    <div className="ecs-console">
      <div className="ecs-tab-bar">
        <button className={`ecs-tab ${mainTab === 'services' ? 'active' : ''}`} type="button" onClick={() => setMainTab('services')}>Services</button>
        <button className={`ecs-tab ${mainTab === 'tasks' ? 'active' : ''}`} type="button" onClick={() => setMainTab('tasks')}>Tasks ({taskRows.length})</button>
        <button className={`ecs-tab ${mainTab === 'lab' ? 'active' : ''}`} type="button" onClick={() => setMainTab('lab')}>Resilience Lab</button>
        <button className="ecs-tab" type="button" onClick={() => void load(selectedClusterArn, selectedServiceName, 'manual')} style={{ marginLeft: 'auto' }}>Refresh</button>
      </div>

      <FreshnessIndicator
        freshness={mainTab === 'lab' ? labFreshness : diagnosticsFreshness}
        label={mainTab === 'lab' ? 'Lab last updated' : 'Diagnostics last updated'}
        staleLabel={mainTab === 'lab' ? 'Refresh lab' : 'Refresh diagnostics'}
      />
      {error && <SvcState variant="error" error={error} />}
      {msg && <div className="ecs-msg">{msg}</div>}

      <div className="ecs-filter-bar">
        <span className="ecs-filter-label">Cluster</span>
        <select className="ecs-select" value={selectedClusterArn} onChange={(event) => void load(event.target.value)}>
          {clusters.map((cluster) => (
            <option key={cluster.clusterArn} value={cluster.clusterArn}>
              {cluster.clusterName} ({cluster.activeServicesCount} svc / {cluster.runningTasksCount} tasks)
            </option>
          ))}
          {!clusters.length && <option value="">No clusters</option>}
        </select>
      </div>

      {mainTab !== 'lab' && (
        <>
          <input
            className="ecs-search-input"
            placeholder="Filter services, tasks, reasons, and images..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="ecs-column-chips">
            {(mainTab === 'services' ? SERVICE_COLUMNS : TASK_COLUMNS).map((column) => {
              const active = mainTab === 'services'
                ? visibleServiceCols.has(column.key as ServiceColumnKey)
                : visibleTaskCols.has(column.key as TaskColumnKey)

              return (
                <button
                  key={column.key}
                  className={`ecs-chip ${active ? 'active' : ''}`}
                  type="button"
                  style={active ? { background: column.color, borderColor: column.color, color: '#fff' } : undefined}
                  onClick={() => mainTab === 'services'
                    ? toggleServiceCol(column.key as ServiceColumnKey)
                    : toggleTaskCol(column.key as TaskColumnKey)}
                >
                  {column.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="ecs-summary-grid">
        {(diagnostics?.summaryTiles ?? []).map((tile) => (
          <div key={tile.key} className={`ecs-summary-tile tone-${tile.tone}`}>
            <div className="ecs-summary-label">{tile.label}</div>
            <div className="ecs-summary-value">{tile.value}</div>
            <div className="ecs-summary-detail">{tile.detail}</div>
          </div>
        ))}
      </div>

      {!diagnostics && !loading && services.length === 0 && (
        <SvcState variant="no-selection" message="Select a cluster and service to inspect deployment diagnostics." />
      )}

      {mainTab === 'lab' && (
        <div className="ecs-lab-panel">
          <ObservabilityResilienceLab
            report={labReport}
            loading={labLoading}
            error={labError}
            onRefresh={() => void loadLab()}
            onRunArtifact={handleLabArtifactRun}
            onNavigateSignal={handleLabSignalNavigate}
          />
        </div>
      )}

      {mainTab !== 'lab' && (
        <div className={`ecs-diagnostics-layout ${diagnostics ? '' : 'full-width'}`}>
          <div className="ecs-diagnostics-main">
            <div className="ecs-main-layout">
              <div className="ecs-table-area">
                {mainTab === 'services' ? (
                  <>
                    <table className="ecs-data-table">
                      <thead>
                        <tr>
                          {activeServiceCols.map((column) => <th key={column.key}>{column.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredServices.map((service) => (
                          <tr
                            key={service.serviceName}
                            className={service.serviceName === selectedServiceName ? 'active' : ''}
                            onClick={() => void selectService(service.serviceName)}
                          >
                            {activeServiceCols.map((column) => (
                              <td key={column.key}>
                                {column.key === 'status'
                                  ? <span className={`ecs-badge ${service.status}`}>{service.status}</span>
                                  : column.key === 'deploymentStatus'
                                  ? <span className={`ecs-badge ${service.deploymentStatus}`}>{service.deploymentStatus}</span>
                                  : getServiceCellValue(service, column.key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filteredServices.length && <SvcState variant="no-filter-matches" resourceName="services" compact />}
                  </>
                ) : (
                  <>
                    <table className="ecs-data-table">
                      <thead>
                        <tr>
                          {activeTaskCols.map((column) => <th key={column.key}>{column.label}</th>)}
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTasks.map((task) => (
                          <tr
                            key={task.taskArn}
                            className={task.taskArn === selectedTask?.taskArn ? 'active' : ''}
                            onClick={() => selectTask(task.taskArn)}
                          >
                            {activeTaskCols.map((column) => (
                              <td key={column.key}>
                                {column.key === 'taskId' ? task.taskId
                                  : column.key === 'lastStatus' ? <span className={`ecs-badge ${taskStateTone(task)}`}>{task.lastStatus}</span>
                                  : column.key === 'health' ? <span className={`ecs-badge ${task.healthStatus}`}>{task.healthStatus}</span>
                                  : column.key === 'startedAt' ? fmtTs(task.startedAt)
                                  : column.key === 'stoppedReason' ? (task.stoppedReason || '-')
                                  : (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      {task.containers.map((container) => (
                                        <button
                                          key={`${task.taskArn}:${container.name}`}
                                          type="button"
                                          className={`ecs-container-pill ${selectedLogTargetKey === `${task.taskArn}:${container.name}` ? 'active' : ''}`}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            setSelectedTaskArn(task.taskArn)
                                            selectContainerLog(container)
                                          }}
                                        >
                                          {container.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                              </td>
                            ))}
                            <td>
                              <ConfirmButton
                                className="ecs-action-btn stop"
                                type="button"
                                disabled={busy || task.lastStatus === 'STOPPED'}
                                confirmLabel="Stop task?"
                                onConfirm={() => void doStopTask(task.taskArn)}
                                style={{ padding: '3px 8px', fontSize: 11 }}
                              >
                                Stop
                              </ConfirmButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!diagnostics && <SvcState variant="no-selection" resourceName="service" message="Select a service to load tasks and diagnostics." compact />}
                    {diagnostics && !filteredTasks.length && <SvcState variant="no-filter-matches" resourceName="tasks" compact />}
                  </>
                )}
              </div>
            </div>

            {diagnostics && (
              <div className="ecs-panel-grid">
              <section className="ecs-panel">
                <div className="ecs-panel-header">
                  <h3>Diagnostics Summary</h3>
                  <span className="ecs-panel-subtitle">{diagnostics.service.serviceName}</span>
                </div>
                <div className="ecs-pattern-list">
                  {diagnostics.likelyPatterns.map((pattern, index) => (
                    <div key={`${index}-${pattern}`} className="ecs-pattern-item">{pattern}</div>
                  ))}
                </div>
                <div className="ecs-health-list">
                  {diagnostics.indicators.map((indicator) => (
                    <div key={indicator.id} className={`ecs-health-item ${healthTone(indicator.severity)} ${indicator.status}`}>
                      <div className="ecs-health-title-row">
                        <div className="ecs-health-title">{indicator.title}</div>
                        <span className={`ecs-status-pill ${indicator.status}`}>{indicator.status}</span>
                      </div>
                      <div className="ecs-health-detail">{indicator.detail}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="ecs-panel">
                <div className="ecs-panel-header">
                  <h3>Failure and Event Timeline</h3>
                  <span className="ecs-panel-subtitle">{diagnostics.timeline.length} recent signals</span>
                </div>
                <div className="ecs-timeline">
                  {diagnostics.timeline.map((item) => (
                    <div key={item.id} className={`ecs-timeline-item ${item.severity}`}>
                      <div className="ecs-timeline-meta">
                        <span className="ecs-timeline-time">{fmtTs(item.timestamp)}</span>
                        <span className={`ecs-status-pill ${item.category}`}>{item.category}</span>
                      </div>
                      <div className="ecs-timeline-title">{item.title}</div>
                      <div className="ecs-timeline-detail">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </section>
              </div>
            )}
          </div>

          {diagnostics && (
            <aside className="ecs-sidebar">
            <div className="ecs-sidebar-section">
              <h3>Operator Actions</h3>
              <div className="ecs-actions-grid">
                <ConfirmButton className="ecs-action-btn redeploy" type="button" disabled={busy} confirmLabel="Deploy now?" onConfirm={() => void doRedeploy()}>
                  Force Deployment
                </ConfirmButton>
                <button className="ecs-action-btn apply" type="button" disabled={!onRunTerminalCommand} onClick={() => onRunTerminalCommand?.(diagnosticsCommand(selectedClusterTarget, selectedServiceName))}>
                  Open Command
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="ecs-sidebar-hint">Update desired count explicitly</div>
                <div className="ecs-inline-form">
                  <input value={desiredCount} onChange={(event) => setDesiredCount(event.target.value)} style={{ width: 60, flex: 'none' }} />
                  <button className="ecs-action-btn apply" type="button" disabled={busy} onClick={() => void doScale()}>Apply</button>
                </div>
              </div>
            </div>

            <div className="ecs-sidebar-section">
              <h3>Service Detail</h3>
              <KV items={[
                ['Service', diagnostics.service.serviceName],
                ['Status', diagnostics.service.status],
                ['Task Def', diagnostics.service.taskDefinition.split('/').pop() ?? diagnostics.service.taskDefinition],
                ['Rollout', diagnostics.service.deployments[0]?.rolloutState ?? '-'],
                ['Running', `${diagnostics.service.runningCount}/${diagnostics.service.desiredCount}`],
                ['Pending', String(diagnostics.service.pendingCount)],
                ['Launch Type', diagnostics.service.launchType],
                ['Created', fmtTs(diagnostics.service.createdAt)]
              ]} />
            </div>

            <div className="ecs-sidebar-section">
              <h3>Recent Deployments</h3>
              {diagnostics.recentDeployments.length > 0 ? (
                <table className="ecs-deploy-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>State</th>
                      <th>Counts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.recentDeployments.map((deployment) => (
                      <tr key={deployment.id}>
                        <td title={deployment.taskDefinition}>{deployment.id.slice(0, 8)}</td>
                        <td><span className={`ecs-badge ${deployment.rolloutState}`}>{deployment.rolloutState}</span></td>
                        <td>{deployment.runningCount}/{deployment.desiredCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <SvcState variant="empty" resourceName="deployment history" compact />
              )}
            </div>

            <div className="ecs-sidebar-section">
              <h3>Selected Task</h3>
              {selectedTask ? (
                <>
                  <KV items={[
                    ['Task ID', selectedTask.taskId],
                    ['Status', selectedTask.lastStatus],
                    ['Desired', selectedTask.desiredStatus],
                    ['Health', selectedTask.healthStatus],
                    ['Started', fmtTs(selectedTask.startedAt)],
                    ['Stopped', fmtTs(selectedTask.stoppedAt)],
                    ['Stop Reason', selectedTask.stoppedReason || '-']
                  ]} />
                  <div className="ecs-task-detail-list">
                    {selectedTask.containers.map((container) => (
                      <div key={`${selectedTask.taskArn}:${container.name}`} className="ecs-task-detail-card">
                        <div className="ecs-task-detail-header">
                          <strong>{container.name}</strong>
                          <button
                            type="button"
                            className={`ecs-container-pill ${selectedLogTargetKey === `${selectedTask.taskArn}:${container.name}` ? 'active' : ''}`}
                            onClick={() => selectContainerLog(container)}
                          >
                            Logs
                          </button>
                        </div>
                        <KV items={[
                          ['Image', container.image],
                          ['Exit Code', container.exitCode === null ? '-' : String(container.exitCode)],
                          ['Reason', container.reason || '-'],
                          ['Health', container.healthStatus],
                          ['Log Group', container.logGroup || '-'],
                          ['Log Stream', container.logStream || '-']
                        ]} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <SvcState variant="no-selection" resourceName="task" compact />
              )}
            </div>

            <div className="ecs-sidebar-section">
              <h3>Task Definition and Images</h3>
              {diagnostics.taskDefinition ? (
                <>
                  <KV items={[
                    ['Family', diagnostics.taskDefinition.family],
                    ['Revision', String(diagnostics.taskDefinition.revision)],
                    ['Network', diagnostics.taskDefinition.networkMode],
                    ['Execution Role', diagnostics.taskDefinition.executionRoleArn || '-'],
                    ['Task Role', diagnostics.taskDefinition.taskRoleArn || '-']
                  ]} />
                  <div className="ecs-image-list">
                    {diagnostics.taskDefinition.containerImages.map((container) => (
                      <div key={container.name} className="ecs-image-item">
                        <div className="ecs-image-title">{container.name}</div>
                        <div className="ecs-image-ref">{container.image}</div>
                        <div className="ecs-image-meta">
                          {container.logGroup ? `logs: ${container.logGroup}` : 'logs: not configured'}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <SvcState variant="empty" message="Task definition details were not returned." compact />
              )}
            </div>

            <div className="ecs-sidebar-section">
              <h3>Focused Logs</h3>
              {selectedLogTarget && (
                <div className="ecs-sidebar-hint">
                  {selectedLogTarget.taskId} / {selectedLogTarget.containerName}
                </div>
              )}
              {logs.length > 0 ? (
                <div className="ecs-log-viewer">
                  {logs.map((item, index) => (
                    <div key={`${item.timestamp}-${index}`} className="ecs-log-line">
                      <span className="ecs-log-timestamp">{new Date(item.timestamp).toLocaleTimeString()}</span>
                      {item.message}
                    </div>
                  ))}
                </div>
              ) : (
                <SvcState variant={logStatus ? 'loading' : 'no-selection'} message={logStatus || 'Select a task or container with logs to inspect output.'} compact />
              )}
            </div>

            <div className="ecs-sidebar-section">
              <h3>Recent Service Events</h3>
              {diagnostics.service.events.length > 0 ? (
                <div className="ecs-event-list">
                  {diagnostics.service.events.map((event) => (
                    <div key={event.id} className="ecs-event-item">
                      <span className="ecs-event-time">{fmtTs(event.createdAt)}</span>
                      {event.message}
                    </div>
                  ))}
                </div>
              ) : (
                <SvcState variant="empty" resourceName="recent service events" compact />
              )}
            </div>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
