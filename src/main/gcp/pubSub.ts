/**
 * Pub/Sub wrappers — topic and subscription listing and detail. Extracted
 * verbatim from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpPubSubSubscriptionDetail,
  GcpPubSubSubscriptionSummary,
  GcpPubSubTopicDetail,
  GcpPubSubTopicSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import {
  asBoolean,
  asString,
  buildGcpSdkError,
  normalizeNumber
} from './shared'

function buildPubSubApiUrl(pathname: string, query: Record<string, number | string | undefined> = {}): string {
  const url = new URL(`https://pubsub.googleapis.com/v1/${pathname.replace(/^\/+/, '')}`)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') {
      continue
    }

    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

export async function listGcpPubSubTopics(projectId: string): Promise<GcpPubSubTopicSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const topics: GcpPubSubTopicSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildPubSubApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/topics`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.topics) ? response.topics : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(record.name)
        if (!name) continue

        const topicId = name.split('/').pop() ?? name
        const labels = record.labels && typeof record.labels === 'object' ? record.labels as Record<string, string> : {}
        const schemaSettings = record.schemaSettings && typeof record.schemaSettings === 'object'
          ? asString((record.schemaSettings as Record<string, unknown>).schema)
          : ''

        topics.push({
          name,
          topicId,
          labels,
          messageRetentionDuration: asString(record.messageRetentionDuration),
          kmsKeyName: asString(record.kmsKeyName),
          schemaSettings
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return topics
  } catch (error) {
    throw buildGcpSdkError(`listing Pub/Sub topics for project "${normalizedProjectId}"`, error, 'pubsub.googleapis.com')
  }
}

export async function listGcpPubSubSubscriptions(projectId: string): Promise<GcpPubSubSubscriptionSummary[]> {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return []

  try {
    const subscriptions: GcpPubSubSubscriptionSummary[] = []
    let pageToken = ''

    const canPage = paginationGuard()
    do {
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildPubSubApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/subscriptions`, {
          pageSize: 500,
          pageToken: pageToken || undefined
        })
      })

      for (const entry of Array.isArray(response.subscriptions) ? response.subscriptions : []) {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(record.name)
        if (!name) continue

        const subscriptionId = name.split('/').pop() ?? name
        const topic = asString(record.topic)
        const topicId = topic.split('/').pop() ?? topic
        const pushConfig = record.pushConfig && typeof record.pushConfig === 'object'
          ? record.pushConfig as Record<string, unknown>
          : null
        const pushEndpoint = pushConfig ? asString(pushConfig.pushEndpoint) : ''
        const bigqueryConfig = record.bigqueryConfig && typeof record.bigqueryConfig === 'object' ? record.bigqueryConfig : null
        const cloudStorageConfig = record.cloudStorageConfig && typeof record.cloudStorageConfig === 'object' ? record.cloudStorageConfig : null

        let deliveryType = 'pull'
        if (pushEndpoint) deliveryType = 'push'
        else if (bigqueryConfig) deliveryType = 'bigquery'
        else if (cloudStorageConfig) deliveryType = 'cloud-storage'

        subscriptions.push({
          name,
          subscriptionId,
          topic,
          topicId,
          ackDeadlineSeconds: normalizeNumber(record.ackDeadlineSeconds),
          messageRetentionDuration: asString(record.messageRetentionDuration),
          pushEndpoint,
          deliveryType,
          filter: asString(record.filter),
          enableExactlyOnceDelivery: asBoolean(record.enableExactlyOnceDelivery),
          state: asString(record.state) || 'ACTIVE',
          detached: asBoolean(record.detached)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return subscriptions
  } catch (error) {
    throw buildGcpSdkError(`listing Pub/Sub subscriptions for project "${normalizedProjectId}"`, error, 'pubsub.googleapis.com')
  }
}

export async function getGcpPubSubTopicDetail(projectId: string, topicId: string): Promise<GcpPubSubTopicDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedTopicId = topicId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildPubSubApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/topics/${encodeURIComponent(normalizedTopicId)}`)
    })

    const name = asString(response.name) || `projects/${normalizedProjectId}/topics/${normalizedTopicId}`
    const labels = response.labels && typeof response.labels === 'object' ? response.labels as Record<string, string> : {}
    const schemaSettings = response.schemaSettings && typeof response.schemaSettings === 'object'
      ? asString((response.schemaSettings as Record<string, unknown>).schema)
      : ''

    const subscriptions = await listGcpPubSubSubscriptions(normalizedProjectId)
    const subscriptionCount = subscriptions.filter((sub) => sub.topicId === normalizedTopicId).length

    return {
      name,
      topicId: normalizedTopicId,
      labels,
      messageRetentionDuration: asString(response.messageRetentionDuration),
      kmsKeyName: asString(response.kmsKeyName),
      schemaSettings,
      subscriptionCount
    }
  } catch (error) {
    throw buildGcpSdkError(`getting Pub/Sub topic detail for "${normalizedTopicId}"`, error, 'pubsub.googleapis.com')
  }
}

export async function getGcpPubSubSubscriptionDetail(projectId: string, subscriptionId: string): Promise<GcpPubSubSubscriptionDetail> {
  const normalizedProjectId = projectId.trim()
  const normalizedSubscriptionId = subscriptionId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildPubSubApiUrl(`projects/${encodeURIComponent(normalizedProjectId)}/subscriptions/${encodeURIComponent(normalizedSubscriptionId)}`)
    })

    const pushConfig = response.pushConfig && typeof response.pushConfig === 'object'
      ? response.pushConfig as Record<string, unknown>
      : null
    const pushEndpoint = pushConfig ? asString(pushConfig.pushEndpoint) : ''
    const pushAttributes = pushConfig && pushConfig.attributes && typeof pushConfig.attributes === 'object'
      ? pushConfig.attributes as Record<string, string>
      : {}

    const deadLetterPolicy = response.deadLetterPolicy && typeof response.deadLetterPolicy === 'object'
      ? response.deadLetterPolicy as Record<string, unknown>
      : null

    const retryPolicy = response.retryPolicy && typeof response.retryPolicy === 'object'
      ? response.retryPolicy as Record<string, unknown>
      : null

    const expirationPolicy = response.expirationPolicy && typeof response.expirationPolicy === 'object'
      ? response.expirationPolicy as Record<string, unknown>
      : null

    return {
      name: asString(response.name),
      subscriptionId: normalizedSubscriptionId,
      topic: asString(response.topic),
      ackDeadlineSeconds: normalizeNumber(response.ackDeadlineSeconds),
      messageRetentionDuration: asString(response.messageRetentionDuration),
      retainAckedMessages: asBoolean(response.retainAckedMessages),
      pushConfig: pushEndpoint ? { pushEndpoint, attributes: pushAttributes } : null,
      deadLetterPolicy: deadLetterPolicy
        ? { deadLetterTopic: asString(deadLetterPolicy.deadLetterTopic), maxDeliveryAttempts: normalizeNumber(deadLetterPolicy.maxDeliveryAttempts) }
        : null,
      retryPolicy: retryPolicy
        ? { minimumBackoff: asString(retryPolicy.minimumBackoff), maximumBackoff: asString(retryPolicy.maximumBackoff) }
        : null,
      filter: asString(response.filter),
      enableExactlyOnceDelivery: asBoolean(response.enableExactlyOnceDelivery),
      state: asString(response.state) || 'ACTIVE',
      expirationTtl: expirationPolicy ? asString(expirationPolicy.ttl) : ''
    }
  } catch (error) {
    throw buildGcpSdkError(`getting Pub/Sub subscription detail for "${normalizedSubscriptionId}"`, error, 'pubsub.googleapis.com')
  }
}
