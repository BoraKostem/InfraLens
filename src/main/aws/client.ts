import type { AwsConnection } from '@shared/types'
import { getSessionCredentials } from '../sessionHub'
import { createProfileCredentialsProvider } from './profileCredentials'

type AwsCredentialsProvider = () => Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}>

// ── SDK Client Pool ────────────────────────────────────────────────────────────
// Clients are cached per (serviceClass, profile/sessionId, region) to avoid
// re-initialising middleware stacks on every API call.

type AnyConstructor<T> = new (config: ReturnType<typeof awsClientConfig>) => T

interface PoolEntry {
  client: unknown
  lastUsedAt: number
}

const CLIENT_TTL_MS = 10 * 60 * 1000 // 10 minutes idle TTL
const clientPool = new Map<string, PoolEntry>()

function connectionKey(connection: AwsConnection): string {
  const id = connection.kind === 'assumed-role' ? connection.sessionId : connection.profile
  return `${id}::${connection.region}`
}

/**
 * Returns a cached SDK client for the given service class and connection.
 * Clients are reused across calls and evicted after CLIENT_TTL_MS of inactivity.
 */
export function getAwsClient<T>(ClientClass: AnyConstructor<T>, connection: AwsConnection): T {
  const key = `${ClientClass.name}::${connectionKey(connection)}`
  const now = Date.now()

  const existing = clientPool.get(key)
  if (existing) {
    existing.lastUsedAt = now
    return existing.client as T
  }

  const client = new ClientClass(awsClientConfig(connection))
  clientPool.set(key, { client, lastUsedAt: now })
  return client
}

/**
 * Evicts all cached clients for a given connection (e.g. on credential refresh).
 * If no connection is provided, clears the entire pool.
 */
export function evictClientPool(connection?: AwsConnection): void {
  if (!connection) {
    clientPool.clear()
    return
  }
  const prefix = connectionKey(connection)
  for (const key of clientPool.keys()) {
    if (key.endsWith(`::${prefix}`)) {
      clientPool.delete(key)
    }
  }
}

// Periodically evict idle clients to avoid holding stale credentials in memory.
setInterval(() => {
  const cutoff = Date.now() - CLIENT_TTL_MS
  for (const [key, entry] of clientPool.entries()) {
    if (entry.lastUsedAt < cutoff) {
      clientPool.delete(key)
    }
  }
}, CLIENT_TTL_MS).unref()

// ── Credential Providers ───────────────────────────────────────────────────────

const credentialProviders = new Map<string, AwsCredentialsProvider>()
const pendingCredentialLoads = new Set<Promise<unknown>>()

function trackCredentialLoad<T>(promise: Promise<T>): Promise<T> {
  pendingCredentialLoads.add(promise)
  const cleanup = () => {
    pendingCredentialLoads.delete(promise)
  }
  promise.then(cleanup, cleanup)
  return promise
}

export function getProfileCredentialsProvider(profile: string): AwsCredentialsProvider {
  const cached = credentialProviders.get(profile)
  if (cached) {
    return cached
  }

  const baseProvider = createProfileCredentialsProvider(profile)
  const trackedProvider: AwsCredentialsProvider = async () =>
    trackCredentialLoad(baseProvider())

  credentialProviders.set(profile, trackedProvider)
  return trackedProvider
}

export function clearCredentialsProviderCache(profile?: string): void {
  if (profile) {
    credentialProviders.delete(profile)
    // Evict pooled clients for this profile across all regions
    for (const key of clientPool.keys()) {
      if (key.includes(`::${profile}::`)) {
        clientPool.delete(key)
      }
    }
    return
  }

  credentialProviders.clear()
  clientPool.clear()
}

export function awsClientConfig(connection: AwsConnection) {
  const credentials = connection.kind === 'assumed-role'
    ? (() => {
        const snapshot = getSessionCredentials(connection.sessionId)
        return {
          accessKeyId: snapshot.accessKeyId,
          secretAccessKey: snapshot.secretAccessKey,
          sessionToken: snapshot.sessionToken,
          expiration: new Date(snapshot.expiration)
        }
      })()
    : getProfileCredentialsProvider(connection.profile)

  return {
    region: connection.region,
    credentials
  }
}

export async function waitForAwsCredentialActivity(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (pendingCredentialLoads.size > 0) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return
    }

    await Promise.race([
      Promise.allSettled([...pendingCredentialLoads]),
      new Promise<void>((resolve) => setTimeout(resolve, remainingMs))
    ])
  }
}

export function hasPendingAwsCredentialActivity(): boolean {
  return pendingCredentialLoads.size > 0
}

export function readTags(tags?: Array<{ Key?: string; Value?: string }>): Record<string, string> {
  const entries = (tags ?? [])
    .filter((tag) => tag.Key)
    .map((tag) => [tag.Key as string, tag.Value ?? ''])

  return Object.fromEntries(entries)
}
