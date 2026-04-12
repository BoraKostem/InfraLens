/**
 * Persistent query history store for Azure Log Analytics.
 * Stores the last 50 queries per workspace using secureJson storage.
 * Follows the same pattern as azureFoundationStore.ts.
 */

import path from 'node:path'
import { app } from 'electron'
import { readSecureJsonFile, writeSecureJsonFile } from '../secureJson'
import type { AzureLogAnalyticsHistoryEntry } from '@shared/types'

// ── Constants ───────────────────────────────────────────────────────────────────

const MAX_HISTORY_PER_WORKSPACE = 50

// ── Store Shape ─────────────────────────────────────────────────────────────────

interface MonitorStoreData {
  queryHistory: Record<string, AzureLogAnalyticsHistoryEntry[]>
}

const DEFAULT_STORE: MonitorStoreData = {
  queryHistory: {}
}

function monitorStorePath(): string {
  return path.join(app.getPath('userData'), 'azure-monitor.json')
}

// ── Sanitization ────────────────────────────────────────────────────────────────

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sanitizeEntry(value: unknown): AzureLogAnalyticsHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>

  const id = sanitizeString(raw.id)
  const workspaceId = sanitizeString(raw.workspaceId)
  const query = sanitizeString(raw.query)
  if (!id || !workspaceId || !query) return null

  return {
    id,
    workspaceId,
    query,
    executedAt: sanitizeString(raw.executedAt),
    success: raw.success === true,
    executionTimeMs: typeof raw.executionTimeMs === 'number' ? raw.executionTimeMs : undefined,
    errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined
  }
}

function sanitizeStore(value: unknown): MonitorStoreData {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

  const history = raw.queryHistory && typeof raw.queryHistory === 'object' && !Array.isArray(raw.queryHistory)
    ? (raw.queryHistory as Record<string, unknown>)
    : {}

  const sanitized: Record<string, AzureLogAnalyticsHistoryEntry[]> = {}
  for (const [wsId, entries] of Object.entries(history)) {
    if (!Array.isArray(entries)) continue
    const valid = entries
      .map(sanitizeEntry)
      .filter((e): e is AzureLogAnalyticsHistoryEntry => e !== null)
      .slice(0, MAX_HISTORY_PER_WORKSPACE)
    if (valid.length > 0) {
      sanitized[wsId] = valid
    }
  }

  return { queryHistory: sanitized }
}

// ── Cache ───────────────────────────────────────────────────────────────────────

let storeCache: MonitorStoreData | null = null

function readStore(): MonitorStoreData {
  if (storeCache) return storeCache
  const parsed = readSecureJsonFile<Record<string, unknown>>(monitorStorePath(), {
    fallback: DEFAULT_STORE as unknown as Record<string, unknown>,
    fileLabel: 'Azure monitor'
  })
  storeCache = sanitizeStore(parsed)
  return storeCache
}

function writeStore(data: MonitorStoreData): void {
  const sanitized = sanitizeStore(data)
  storeCache = sanitized
  writeSecureJsonFile(monitorStorePath(), sanitized, 'Azure monitor')
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Returns the query history for a given workspace, newest first.
 */
export function getAzureLogAnalyticsHistory(workspaceId: string): AzureLogAnalyticsHistoryEntry[] {
  if (!workspaceId) return []
  const data = readStore()
  return data.queryHistory[workspaceId] ?? []
}

/**
 * Adds a new history entry for a workspace, maintaining the cap.
 */
export function addAzureLogAnalyticsHistoryEntry(
  workspaceId: string,
  query: string,
  success: boolean,
  executionTimeMs?: number,
  errorMessage?: string
): void {
  if (!workspaceId || !query) return

  const data = readStore()
  const existing = data.queryHistory[workspaceId] ?? []

  const entry: AzureLogAnalyticsHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    query: query.trim(),
    executedAt: new Date().toISOString(),
    success,
    executionTimeMs,
    errorMessage
  }

  data.queryHistory[workspaceId] = [entry, ...existing].slice(0, MAX_HISTORY_PER_WORKSPACE)
  writeStore(data)
}

/**
 * Clears query history for a specific workspace, or all workspaces if no ID given.
 */
export function clearAzureLogAnalyticsHistory(workspaceId?: string): void {
  if (workspaceId) {
    const data = readStore()
    delete data.queryHistory[workspaceId]
    writeStore(data)
  } else {
    writeStore({ queryHistory: {} })
  }
}
