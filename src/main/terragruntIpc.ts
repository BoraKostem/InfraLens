import path from 'node:path'
import { ipcMain } from 'electron'

import { createHandlerWrapper, type OperationOptions } from './operations'
import { detectTerragruntCli, getCachedTerragruntCliInfo, resolveStack } from './terragrunt'
import { scanForTerragrunt } from './terragruntDiscovery'

type HandlerResult<T> = { ok: true; data: T } | { ok: false; error: string }
const wrap: <T>(
  fn: () => Promise<T> | T,
  label?: string,
  options?: OperationOptions
) => Promise<HandlerResult<T>> = createHandlerWrapper('terragrunt-ipc', { timeoutMs: 60000 })

let registered = false

export function registerTerragruntIpcHandlers(): void {
  if (registered) return
  registered = true

  ipcMain.handle('terragrunt:cli:detect', async () => wrap(() => detectTerragruntCli()))
  ipcMain.handle('terragrunt:cli:info', async () => wrap(() => getCachedTerragruntCliInfo()))
  ipcMain.handle('terragrunt:discovery:scan', async (_event, rootPath: string) =>
    wrap(() => scanForTerragrunt(path.resolve(rootPath)))
  )
  ipcMain.handle('terragrunt:stack:resolve', async (_event, rootPath: string) =>
    wrap(() => resolveStack(path.resolve(rootPath)))
  )
}
