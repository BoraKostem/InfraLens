import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'

import type { AwsConnection } from '@shared/types'
import { buildAwsContextCommand, getResolvedProcessEnv, getShellConfig, getTerminalCwd } from './shell'
import { getConnectionEnv } from './sessionHub'

type TerminalEvent =
  | { sessionId: string; type: 'output'; text: string }
  | { sessionId: string; type: 'exit'; code: number | null }

type TerminalOpenResult = {
  created: boolean
  history: string
}

type TerminalSession = {
  id: string
  pty: IPty
  ownerId: number
  connection: AwsConnection
  contextKey: string
  history: string
}

const sessions = new Map<string, TerminalSession>()
const MAX_HISTORY_CHARS = 200_000

function emitToOwner(ownerId: number, payload: TerminalEvent): void {
  const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.id === ownerId)
  window?.webContents.send('terminal:event', payload)
}

function getContextKey(connection: AwsConnection): string {
  return `${connection.sessionId}:${connection.region}`
}

function buildContextCommand(connection: AwsConnection): string {
  return buildAwsContextCommand(connection)
}

function appendHistory(targetSession: TerminalSession, text: string): void {
  const nextHistory = `${targetSession.history}${text}`
  targetSession.history =
    nextHistory.length > MAX_HISTORY_CHARS ? nextHistory.slice(nextHistory.length - MAX_HISTORY_CHARS) : nextHistory
}

function updateContext(targetSession: TerminalSession, connection: AwsConnection): void {
  const nextKey = getContextKey(connection)
  targetSession.connection = connection

  if (targetSession.contextKey === nextKey) {
    return
  }

  targetSession.contextKey = nextKey
  targetSession.connection = connection
  targetSession.pty.write(`${buildContextCommand(connection)}\r`)
}

function runCommandInSession(targetSession: TerminalSession, command: string, delayMs = 0): void {
  const normalized = command.trim()
  if (!normalized) {
    return
  }

  const write = () => {
    if (!sessions.has(targetSession.id)) {
      return
    }

    targetSession.pty.write(`${normalized}\r`)
  }

  if (delayMs > 0) {
    setTimeout(write, delayMs)
    return
  }

  write()
}

async function createSession(sessionId: string, sender: WebContents, connection: AwsConnection): Promise<TerminalSession> {
  const shell = getShellConfig()
  const resolvedEnv = await getResolvedProcessEnv()
  const pty = spawn(shell.command, shell.args, {
    name: 'xterm-color',
    cols: 120,
    rows: 24,
    cwd: getTerminalCwd(),
    env: {
      ...resolvedEnv,
      ...getConnectionEnv(connection),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PYTHONIOENCODING: 'utf-8'
    }
  })

  const nextSession: TerminalSession = {
    id: sessionId,
    pty,
    ownerId: sender.id,
    connection,
    contextKey: getContextKey(connection),
    history: ''
  }

  pty.onData((text) => {
    appendHistory(nextSession, text)
    emitToOwner(nextSession.ownerId, { sessionId, type: 'output', text })
  })

  pty.onExit(({ exitCode }) => {
    sessions.delete(sessionId)
    appendHistory(nextSession, `\r\n[terminal exited with code ${exitCode ?? 'null'}]\r\n`)
    emitToOwner(nextSession.ownerId, { sessionId, type: 'exit', code: exitCode })
  })

  pty.write(`${buildContextCommand(connection)}\r`)
  return nextSession
}

async function ensureSession(sessionId: string, sender: WebContents, connection: AwsConnection): Promise<{ session: TerminalSession; created: boolean }> {
  const existing = sessions.get(sessionId)
  if (!existing) {
    const created = await createSession(sessionId, sender, connection)
    sessions.set(sessionId, created)
    return { session: created, created: true }
  }

  existing.ownerId = sender.id
  updateContext(existing, connection)
  return { session: existing, created: false }
}

function requireSession(sessionId: string): TerminalSession {
  const session = sessions.get(sessionId)
  if (!session) {
    throw new Error('Terminal session is not running.')
  }

  return session
}

function closeSession(sessionId: string): void {
  const current = sessions.get(sessionId)
  if (!current) {
    return
  }

  sessions.delete(sessionId)
  current.pty.kill()
}

function closeAllSessions(): void {
  for (const sessionId of Array.from(sessions.keys())) {
    closeSession(sessionId)
  }
}

export function registerTerminalIpcHandlers(): void {
  ipcMain.handle('terminal:open-aws', async (event, sessionId: string, connection: AwsConnection, initialCommand?: string): Promise<TerminalOpenResult> => {
    const { session: currentSession, created } = await ensureSession(sessionId, event.sender, connection)

    if (created) {
      runCommandInSession(currentSession, initialCommand ?? '', 120)
    }

    return {
      created,
      history: currentSession.history
    }
  })

  ipcMain.handle('terminal:update-aws-context', async (_event, sessionId: string, connection: AwsConnection) => {
    updateContext(requireSession(sessionId), connection)
  })

  ipcMain.handle('terminal:input', async (_event, sessionId: string, input: string) => {
    requireSession(sessionId).pty.write(input)
  })

  ipcMain.handle('terminal:run-command', async (_event, sessionId: string, command: string) => {
    runCommandInSession(requireSession(sessionId), command)
  })

  ipcMain.handle('terminal:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    const session = sessions.get(sessionId)
    if (!session) {
      return
    }

    session.pty.resize(Math.max(20, cols), Math.max(8, rows))
  })

  ipcMain.handle('terminal:close', async (_event, sessionId?: string) => {
    if (sessionId) {
      closeSession(sessionId)
      return
    }

    closeAllSessions()
  })
}
