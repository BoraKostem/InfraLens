import { ipcMain } from 'electron'

import type { AwsConnection } from '@shared/types'
import { archiveGuardDutyFindings, getGuardDutyReport, unarchiveGuardDutyFindings } from './aws/guardduty'
import { createHandlerWrapper } from './operations'

type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: string }
const wrap: <T>(fn: () => Promise<T> | T, label?: string) => Promise<HandlerResult<T>> =
  createHandlerWrapper('guardduty-ipc', { timeoutMs: 120000 })

export function registerGuardDutyIpcHandlers(): void {
  ipcMain.handle('guardduty:report', async (_event, connection: AwsConnection) =>
    wrap(() => getGuardDutyReport(connection))
  )
  ipcMain.handle(
    'guardduty:archive-findings',
    async (_event, connection: AwsConnection, findingIds: string[]) =>
      wrap(() => archiveGuardDutyFindings(connection, findingIds))
  )
  ipcMain.handle(
    'guardduty:unarchive-findings',
    async (_event, connection: AwsConnection, findingIds: string[]) =>
      wrap(() => unarchiveGuardDutyFindings(connection, findingIds))
  )
}
