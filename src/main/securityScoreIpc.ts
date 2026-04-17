import { ipcMain } from 'electron'

import type { AwsConnection, SecurityScoreWeights } from '@shared/types'
import { getSecurityScoreReport } from './aws/securityScore'
import { createHandlerWrapper } from './operations'

type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: string }
const wrap: <T>(fn: () => Promise<T> | T, label?: string) => Promise<HandlerResult<T>> =
  createHandlerWrapper('security-score-ipc', { timeoutMs: 120000 })

export function registerSecurityScoreIpcHandlers(): void {
  ipcMain.handle(
    'security-score:report',
    async (_event, connection: AwsConnection, weights?: Partial<SecurityScoreWeights>) =>
      wrap(() => getSecurityScoreReport(connection, weights))
  )
}
