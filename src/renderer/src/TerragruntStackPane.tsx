import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  AwsConnection,
  TerraformProject,
  TerragruntProjectInfo,
  TerragruntRunAllCommand,
  TerragruntRunAllEvent,
  TerragruntRunAllSummary,
  TerragruntUnit
} from '@shared/types'
import {
  cancelTerragruntRunAll,
  resolveTerragruntStack,
  startTerragruntRunAll,
  subscribeTerragruntRunAll,
  unsubscribeTerragruntRunAll,
  type ResolvedStackResult
} from './terragruntApi'

type UnitStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'

type TerragruntStackPaneProps = {
  project: TerraformProject
  profileName: string
  connection?: AwsConnection
}

function isStackInfo(info: TerragruntProjectInfo | null | undefined): info is Extract<TerragruntProjectInfo, { kind: 'terragrunt-stack' }> {
  return info?.kind === 'terragrunt-stack'
}

function relativePath(unit: TerragruntUnit): string {
  return unit.relativePath || '.'
}

export function TerragruntStackPane({ project, profileName, connection }: TerragruntStackPaneProps): JSX.Element {
  const stackInfo = isStackInfo(project.terragrunt) ? project.terragrunt.stack : null
  const [resolvedStack, setResolvedStack] = useState<ResolvedStackResult | null>(null)
  const [resolveBusy, setResolveBusy] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [runCommand, setRunCommand] = useState<TerragruntRunAllCommand | null>(null)
  const [unitStatuses, setUnitStatuses] = useState<Record<string, UnitStatus>>({})
  const [summary, setSummary] = useState<TerragruntRunAllSummary | null>(null)
  const [confirmCommand, setConfirmCommand] = useState<TerragruntRunAllCommand | null>(null)
  const [runError, setRunError] = useState('')

  const effectiveStack = resolvedStack?.stack ?? stackInfo
  const phases = effectiveStack?.dependencyOrder ?? []
  const units = effectiveStack?.units ?? []
  const cycles = effectiveStack?.cycles ?? []

  const unitByPath = useMemo(() => {
    const map = new Map<string, TerragruntUnit>()
    for (const unit of units) map.set(unit.unitPath, unit)
    return map
  }, [units])

  const resolve = useCallback(async () => {
    if (!project.rootPath) return
    setResolveBusy(true)
    setResolveError('')
    try {
      const result = await resolveTerragruntStack(project.rootPath)
      setResolvedStack(result)
    } catch (err) {
      setResolveError((err as Error).message)
    } finally {
      setResolveBusy(false)
    }
  }, [project.rootPath])

  useEffect(() => {
    const listener = (event: TerragruntRunAllEvent): void => {
      switch (event.type) {
        case 'stack-started':
          setRunId(event.runId)
          setRunCommand(event.command)
          setSummary(null)
          setUnitStatuses({})
          break
        case 'unit-started':
          setUnitStatuses((prev) => ({ ...prev, [event.unitPath]: 'running' }))
          break
        case 'unit-completed':
          setUnitStatuses((prev) => ({ ...prev, [event.unitPath]: event.success ? 'succeeded' : 'failed' }))
          break
        case 'unit-blocked':
          setUnitStatuses((prev) => ({ ...prev, [event.unitPath]: 'blocked' }))
          break
        case 'unit-cancelled':
          setUnitStatuses((prev) => ({ ...prev, [event.unitPath]: 'cancelled' }))
          break
        case 'stack-completed':
          setSummary(event.summary)
          setRunId(null)
          setRunCommand(null)
          break
        default:
          break
      }
    }
    subscribeTerragruntRunAll(listener)
    return () => unsubscribeTerragruntRunAll(listener)
  }, [])

  const handleStart = useCallback(async (command: TerragruntRunAllCommand) => {
    setRunError('')
    setSummary(null)
    try {
      const result = await startTerragruntRunAll(profileName, project.id, command, connection)
      setRunId(result.runId)
      setRunCommand(command)
    } catch (err) {
      setRunError((err as Error).message)
    }
  }, [connection, profileName, project.id])

  const handleCancel = useCallback(async () => {
    if (!runId) return
    try {
      await cancelTerragruntRunAll(runId)
    } catch (err) {
      setRunError((err as Error).message)
    }
  }, [runId])

  const handleConfirm = useCallback(async () => {
    const command = confirmCommand
    setConfirmCommand(null)
    if (command) await handleStart(command)
  }, [confirmCommand, handleStart])

  const running = Boolean(runId)
  const unitCount = units.length
  const phaseCount = phases.length

  return (
    <div className="tg-stack-pane">
      <section className="tg-stack-summary">
        <div className="tg-stack-summary-stat">
          <span>Units</span>
          <strong>{unitCount}</strong>
        </div>
        <div className="tg-stack-summary-stat">
          <span>Phases</span>
          <strong>{phaseCount}</strong>
        </div>
        <div className="tg-stack-summary-stat">
          <span>Stack root</span>
          <strong title={effectiveStack?.stackRoot ?? ''}>{effectiveStack?.stackRoot ?? '-'}</strong>
        </div>
      </section>

      <section className="tg-stack-actions">
        <div className="tg-stack-action-group">
          <button type="button" onClick={() => handleStart('plan')} disabled={running}>
            Run all plan
          </button>
          <button type="button" className="accent" onClick={() => setConfirmCommand('apply')} disabled={running}>
            Run all apply
          </button>
          <button type="button" className="danger" onClick={() => setConfirmCommand('destroy')} disabled={running}>
            Run all destroy
          </button>
          <button type="button" onClick={resolve} disabled={resolveBusy || running}>
            {resolveBusy ? 'Resolving…' : 'Re-resolve stack'}
          </button>
          {running && (
            <button type="button" className="danger" onClick={handleCancel}>
              Cancel run-all
            </button>
          )}
        </div>
        <div className="tg-stack-action-meta">
          {runCommand && running && <span className="tg-tag info">Running: {runCommand}</span>}
          {resolveError && <span className="tg-tag danger">Resolve error: {resolveError}</span>}
          {runError && <span className="tg-tag danger">{runError}</span>}
        </div>
      </section>

      {cycles.length > 0 && (
        <section className="tg-stack-cycle-warning">
          <strong>Dependency cycles detected:</strong>
          {cycles.map((cycle, i) => (
            <div key={i} className="tg-stack-cycle">{cycle.join(' → ')}</div>
          ))}
          <p>Cannot run-all while cycles exist. Resolve cycles then re-resolve the stack.</p>
        </section>
      )}

      {summary && <PartialFailureSummary summary={summary} /> }

      <section className="tg-stack-topology">
        <h3>Topology</h3>
        {phases.length === 0 && <p className="tg-muted">No runnable phases. Try re-resolving the stack.</p>}
        {phases.map((phase, phaseIdx) => (
          <div key={phaseIdx} className="tg-phase">
            <div className="tg-phase-header">
              <span className="tg-phase-index">Phase {phaseIdx}</span>
              <span className="tg-muted">{phase.length} unit{phase.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tg-phase-units">
              {phase.map((unitPath) => {
                const unit = unitByPath.get(unitPath)
                const status = unitStatuses[unitPath] ?? 'idle'
                return (
                  <div key={unitPath} className={`tg-unit-card status-${status}`}>
                    <div className="tg-unit-header">
                      <strong>{unit ? relativePath(unit) : unitPath}</strong>
                      <span className={`tg-status-badge status-${status}`}>{statusLabel(status)}</span>
                    </div>
                    <div className="tg-unit-meta">
                      <span title={unitPath}>{shortenPath(unitPath)}</span>
                      {unit?.terraformSource && <span>source: {unit.terraformSource}</span>}
                    </div>
                    {unit && unit.dependencies.length > 0 && (
                      <div className="tg-unit-deps">
                        <span className="tg-muted">depends on</span>
                        {unit.dependencies.map((dep) => (
                          <span key={dep.name} className="tg-dep-chip">{dep.name}</span>
                        ))}
                      </div>
                    )}
                    {unit && unit.resolveError && (
                      <div className="tg-unit-error">Resolve error: {unit.resolveError}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      {confirmCommand && (
        <RunAllConfirmModal
          command={confirmCommand}
          units={units}
          phases={phases}
          onCancel={() => setConfirmCommand(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}

function statusLabel(status: UnitStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'succeeded': return 'Succeeded'
    case 'failed': return 'Failed'
    case 'blocked': return 'Blocked'
    case 'cancelled': return 'Cancelled'
    default: return 'Idle'
  }
}

function shortenPath(p: string): string {
  if (p.length < 60) return p
  return `…${p.slice(-60)}`
}

function PartialFailureSummary({ summary }: { summary: TerragruntRunAllSummary }): JSX.Element {
  const total = summary.succeeded.length + summary.failed.length + summary.blocked.length + summary.cancelled.length
  return (
    <section className="tg-summary-panel">
      <div className="tg-summary-header">
        <strong>Last run summary</strong>
        <span className="tg-muted">{total} unit{total === 1 ? '' : 's'}</span>
      </div>
      <div className="tg-summary-grid">
        <SummaryCell label="Succeeded" tone="success" items={summary.succeeded} />
        <SummaryCell label="Failed" tone="danger" items={summary.failed} />
        <SummaryCell label="Blocked" tone="warning" items={summary.blocked} />
        <SummaryCell label="Cancelled" tone="info" items={summary.cancelled} />
      </div>
    </section>
  )
}

function SummaryCell({ label, tone, items }: { label: string; tone: 'success' | 'danger' | 'warning' | 'info'; items: string[] }): JSX.Element {
  return (
    <div className={`tg-summary-cell tone-${tone}`}>
      <div className="tg-summary-cell-header">
        <span>{label}</span>
        <strong>{items.length}</strong>
      </div>
      {items.length > 0 && (
        <ul>
          {items.slice(0, 6).map((p) => <li key={p} title={p}>{shortenPath(p)}</li>)}
          {items.length > 6 && <li className="tg-muted">+ {items.length - 6} more</li>}
        </ul>
      )}
    </div>
  )
}

function RunAllConfirmModal(props: {
  command: TerragruntRunAllCommand
  units: TerragruntUnit[]
  phases: string[][]
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const { command, units, phases, onCancel, onConfirm } = props
  const unitCount = units.length
  const verb = command === 'apply' ? 'apply' : command === 'destroy' ? 'destroy' : command
  return (
    <div className="tg-modal-backdrop" onClick={onCancel}>
      <div className="tg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tg-modal-header">
          <strong>Confirm run-all {verb}</strong>
        </div>
        <div className="tg-modal-body">
          <p>
            This will <strong>{verb}</strong> across {unitCount} unit{unitCount === 1 ? '' : 's'} in {phases.length} phase{phases.length === 1 ? '' : 's'}.
            {command === 'destroy' && ' Destroy is irreversible — ensure you have backups and understand the blast radius.'}
          </p>
          <div className="tg-modal-phase-list">
            {phases.map((phase, idx) => (
              <div key={idx} className="tg-modal-phase">
                <span className="tg-modal-phase-label">Phase {idx}</span>
                <span className="tg-modal-phase-count">{phase.length} unit{phase.length === 1 ? '' : 's'}</span>
                <ul>
                  {phase.slice(0, 8).map((unitPath) => <li key={unitPath} title={unitPath}>{shortenPath(unitPath)}</li>)}
                  {phase.length > 8 && <li className="tg-muted">+ {phase.length - 8} more</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="tg-modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={command === 'destroy' ? 'danger' : 'accent'}
            onClick={onConfirm}
          >
            {command === 'destroy' ? 'Destroy all' : command === 'apply' ? 'Apply all' : 'Plan all'}
          </button>
        </div>
      </div>
    </div>
  )
}
