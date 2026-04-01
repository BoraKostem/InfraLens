import { ipcMain } from 'electron'

import type {
  AwsCapabilitySubject,
  CloudWatchQueryFilter,
  CloudWatchQueryHistoryInput,
  CloudWatchSavedQueryInput,
  DbConnectionResolveInput,
  DbConnectionPresetFilter,
  DbConnectionPresetInput,
  DbVaultCredentialInput,
  AwsConnection,
  GovernanceTagDefaultsUpdate
} from '@shared/types'
import { getAwsCapabilitySnapshot } from './aws/capabilities'
import { resolveDbConnectionMaterial } from './dbConnectionResolver'
import {
  deleteDbVaultCredential,
  listDbVaultCredentials,
  setDbVaultCredential
} from './localVault'
import { createHandlerWrapper } from './operations'
import {
  clearCloudWatchQueryHistory,
  deleteCloudWatchSavedQuery,
  deleteDbConnectionPreset,
  getGovernanceTagDefaults,
  listCloudWatchQueryHistory,
  listCloudWatchSavedQueries,
  listDbConnectionPresets,
  markDbConnectionPresetUsed,
  recordCloudWatchQueryHistory,
  saveCloudWatchSavedQuery,
  saveDbConnectionPreset,
  updateGovernanceTagDefaults
} from './phase1FoundationStore'

type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: string }
const wrap: <T>(fn: () => Promise<T> | T, label?: string) => Promise<HandlerResult<T>> =
  createHandlerWrapper('phase1-foundations', { timeoutMs: 30000 })

export function registerFoundationIpcHandlers(): void {
  ipcMain.handle('phase1:get-governance-tag-defaults', async () =>
    wrap(() => getGovernanceTagDefaults())
  )
  ipcMain.handle('phase1:update-governance-tag-defaults', async (_event, update: GovernanceTagDefaultsUpdate) =>
    wrap(() => updateGovernanceTagDefaults(update))
  )
  ipcMain.handle('phase1:list-cloudwatch-saved-queries', async (_event, filter?: CloudWatchQueryFilter) =>
    wrap(() => listCloudWatchSavedQueries(filter))
  )
  ipcMain.handle('phase1:save-cloudwatch-saved-query', async (_event, input: CloudWatchSavedQueryInput) =>
    wrap(() => saveCloudWatchSavedQuery(input))
  )
  ipcMain.handle('phase1:delete-cloudwatch-saved-query', async (_event, id: string) =>
    wrap(() => deleteCloudWatchSavedQuery(id))
  )
  ipcMain.handle('phase1:list-cloudwatch-query-history', async (_event, filter?: CloudWatchQueryFilter) =>
    wrap(() => listCloudWatchQueryHistory(filter))
  )
  ipcMain.handle('phase1:record-cloudwatch-query-history', async (_event, input: CloudWatchQueryHistoryInput) =>
    wrap(() => recordCloudWatchQueryHistory(input))
  )
  ipcMain.handle('phase1:clear-cloudwatch-query-history', async (_event, filter?: CloudWatchQueryFilter) =>
    wrap(() => clearCloudWatchQueryHistory(filter))
  )
  ipcMain.handle('phase1:list-db-connection-presets', async (_event, filter?: DbConnectionPresetFilter) =>
    wrap(() => listDbConnectionPresets(filter))
  )
  ipcMain.handle('phase1:save-db-connection-preset', async (_event, input: DbConnectionPresetInput) =>
    wrap(() => saveDbConnectionPreset(input))
  )
  ipcMain.handle('phase1:delete-db-connection-preset', async (_event, id: string) =>
    wrap(() => deleteDbConnectionPreset(id))
  )
  ipcMain.handle('phase1:mark-db-connection-preset-used', async (_event, id: string) =>
    wrap(() => markDbConnectionPresetUsed(id))
  )
  ipcMain.handle('phase1:list-db-vault-credentials', async () =>
    wrap(() => listDbVaultCredentials())
  )
  ipcMain.handle('phase1:save-db-vault-credential', async (_event, input: DbVaultCredentialInput) =>
    wrap(() => setDbVaultCredential(input))
  )
  ipcMain.handle('phase1:delete-db-vault-credential', async (_event, name: string) =>
    wrap(() => deleteDbVaultCredential(name))
  )
  ipcMain.handle('phase1:resolve-db-connection-material', async (_event, connection: AwsConnection, input: DbConnectionResolveInput) =>
    wrap(() => resolveDbConnectionMaterial(connection, input))
  )
  ipcMain.handle('phase1:get-aws-capability-snapshot', async (_event, region: string, subjects?: AwsCapabilitySubject[]) =>
    wrap(() => getAwsCapabilitySnapshot(region, subjects))
  )
}
