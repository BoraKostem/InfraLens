import path from 'node:path'

import { app } from 'electron'

import type {
  DbConnectionEngine,
  DbVaultCredentialInput,
  DbVaultCredentialSummary
} from '@shared/types'
import { readSecureJsonFile, writeSecureJsonFile } from './secureJson'

type VaultEntryKind = 'aws-profile' | 'ssh-key' | 'pem' | 'access-key' | 'generic' | 'db-credential'

type VaultEntry = {
  id: string
  kind: VaultEntryKind
  name: string
  secret: string
  metadata: Record<string, string>
  createdAt: string
  updatedAt: string
}

type VaultState = {
  entries: VaultEntry[]
}

export type AwsProfileVaultSecret = {
  accessKeyId: string
  secretAccessKey: string
}

type DbVaultCredentialSecret = {
  password: string
  usernameHint: string
  engine: DbConnectionEngine
  notes: string
}

export function getVaultEntryCounts(): {
  all: number
  awsProfiles: number
  sshKeys: number
  pem: number
  accessKeys: number
} {
  return {
    all: listVaultEntries().length,
    awsProfiles: listVaultEntries('aws-profile').length,
    sshKeys: listVaultEntries('ssh-key').length,
    pem: listVaultEntries('pem').length,
    accessKeys: listVaultEntries('access-key').length
  }
}

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'local-vault.json')
}

function readVaultState(): VaultState {
  return readSecureJsonFile<VaultState>(vaultPath(), {
    fallback: { entries: [] },
    fileLabel: 'Local secret vault'
  })
}

function writeVaultState(state: VaultState): void {
  writeSecureJsonFile(vaultPath(), state, 'Local secret vault')
}

function upsertEntry(nextEntry: VaultEntry): void {
  const state = readVaultState()
  const nextEntries = state.entries.filter((entry) => entry.id !== nextEntry.id)
  nextEntries.push(nextEntry)
  nextEntries.sort((left, right) => left.name.localeCompare(right.name))
  writeVaultState({ entries: nextEntries })
}

function getEntry(kind: VaultEntryKind, name: string): VaultEntry | null {
  const normalizedName = name.trim()
  return readVaultState().entries.find((entry) => entry.kind === kind && entry.name === normalizedName) ?? null
}

function deleteEntry(kind: VaultEntryKind, name: string): void {
  const normalizedName = name.trim()
  const state = readVaultState()
  writeVaultState({
    entries: state.entries.filter((entry) => !(entry.kind === kind && entry.name === normalizedName))
  })
}

export function listVaultEntries(kind?: VaultEntryKind): Array<Omit<VaultEntry, 'secret'>> {
  const entries = readVaultState().entries
  return entries
    .filter((entry) => !kind || entry.kind === kind)
    .map(({ secret: _secret, ...entry }) => entry)
}

export function setVaultSecret(kind: VaultEntryKind, name: string, secret: string, metadata: Record<string, string> = {}): void {
  const normalizedName = name.trim()
  if (!normalizedName) {
    throw new Error('Vault entry name is required.')
  }

  const now = new Date().toISOString()
  const existing = getEntry(kind, normalizedName)
  upsertEntry({
    id: existing?.id ?? `${kind}:${normalizedName}`,
    kind,
    name: normalizedName,
    secret,
    metadata,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
}

export function getVaultSecret(kind: VaultEntryKind, name: string): string | null {
  return getEntry(kind, name)?.secret ?? null
}

export function deleteVaultSecret(kind: VaultEntryKind, name: string): void {
  deleteEntry(kind, name)
}

export function listAwsProfileVaultSecrets(): string[] {
  return listVaultEntries('aws-profile').map((entry) => entry.name)
}

export function getAwsProfileVaultSecret(profileName: string): AwsProfileVaultSecret | null {
  const raw = getVaultSecret('aws-profile', profileName)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AwsProfileVaultSecret>
    if (typeof parsed.accessKeyId !== 'string' || typeof parsed.secretAccessKey !== 'string') {
      return null
    }
    return {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey
    }
  } catch {
    return null
  }
}

export function setAwsProfileVaultSecret(profileName: string, secret: AwsProfileVaultSecret): void {
  setVaultSecret('aws-profile', profileName, JSON.stringify(secret), {
    profileName: profileName.trim()
  })
}

export function deleteAwsProfileVaultSecret(profileName: string): void {
  deleteVaultSecret('aws-profile', profileName)
}

function sanitizeDbEngine(value: unknown): DbConnectionEngine {
  switch (value) {
    case 'postgres':
    case 'mysql':
    case 'mariadb':
    case 'sqlserver':
    case 'oracle':
    case 'aurora-postgresql':
    case 'aurora-mysql':
      return value
    default:
      return 'unknown'
  }
}

function toDbVaultCredentialSummary(entry: Omit<VaultEntry, 'secret'>): DbVaultCredentialSummary {
  return {
    name: entry.name,
    engine: sanitizeDbEngine(entry.metadata.engine),
    usernameHint: entry.metadata.usernameHint?.trim() ?? '',
    notes: entry.metadata.notes?.trim() ?? '',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }
}

export function listDbVaultCredentials(): DbVaultCredentialSummary[] {
  return listVaultEntries('db-credential').map((entry) => toDbVaultCredentialSummary(entry))
}

export function getDbVaultCredentialSecret(name: string): DbVaultCredentialSecret | null {
  const raw = getVaultSecret('db-credential', name)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DbVaultCredentialSecret>
    if (typeof parsed.password !== 'string' || !parsed.password.trim()) {
      return null
    }

    return {
      password: parsed.password,
      usernameHint: typeof parsed.usernameHint === 'string' ? parsed.usernameHint.trim() : '',
      engine: sanitizeDbEngine(parsed.engine),
      notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : ''
    }
  } catch {
    return null
  }
}

export function setDbVaultCredential(input: DbVaultCredentialInput): DbVaultCredentialSummary {
  const name = input.name.trim()
  const password = input.password.trim()

  if (!name) {
    throw new Error('Vault credential name is required.')
  }
  if (!password) {
    throw new Error('Vault credential password is required.')
  }

  const secret: DbVaultCredentialSecret = {
    password,
    usernameHint: input.usernameHint.trim(),
    engine: sanitizeDbEngine(input.engine),
    notes: input.notes.trim()
  }

  setVaultSecret('db-credential', name, JSON.stringify(secret), {
    usernameHint: secret.usernameHint,
    engine: secret.engine,
    notes: secret.notes
  })

  const saved = listVaultEntries('db-credential').find((entry) => entry.name === name)
  if (!saved) {
    throw new Error('Vault credential could not be saved.')
  }

  return toDbVaultCredentialSummary(saved)
}

export function deleteDbVaultCredential(name: string): void {
  deleteVaultSecret('db-credential', name)
}
