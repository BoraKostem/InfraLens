import { ipcMain } from 'electron'

import type { ComparisonRequest } from '@shared/types'
import { runComparison } from './compare'

type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function wrap<T>(fn: () => Promise<T> | T): Promise<HandlerResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerCompareIpcHandlers(): void {
  ipcMain.handle('compare:run', async (_event, request: ComparisonRequest) =>
    wrap(() => runComparison(request))
  )
}
