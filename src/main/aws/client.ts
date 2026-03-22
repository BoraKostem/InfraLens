import { fromIni } from '@aws-sdk/credential-provider-ini'

import type { AwsConnection } from '@shared/types'

type AwsCredentialsProvider = ReturnType<typeof fromIni>

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

function getCredentialsProvider(profile: string): AwsCredentialsProvider {
  const cached = credentialProviders.get(profile)
  if (cached) {
    return cached
  }

  const baseProvider = fromIni({ profile })
  const trackedProvider: AwsCredentialsProvider = async () =>
    trackCredentialLoad(baseProvider())

  credentialProviders.set(profile, trackedProvider)
  return trackedProvider
}

export function awsClientConfig(connection: AwsConnection) {
  return {
    region: connection.region,
    credentials: getCredentialsProvider(connection.profile)
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
