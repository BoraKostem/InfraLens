/**
 * Firebase wrappers — Management and Hosting v1beta1 REST APIs. Extracted
 * verbatim from gcpSdk.ts as part of the monolith decomposition.
 */

import type {
  GcpFirebaseAndroidAppSummary,
  GcpFirebaseHostingChannelSummary,
  GcpFirebaseHostingDomainSummary,
  GcpFirebaseHostingReleaseSummary,
  GcpFirebaseHostingSiteSummary,
  GcpFirebaseIosAppSummary,
  GcpFirebaseProjectSummary,
  GcpFirebaseWebAppSummary
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import { asString, buildGcpSdkError, normalizeNumber } from './shared'

function buildFirebaseManagementApiUrl(pathname: string, query?: Record<string, string>): string {
  const base = 'https://firebase.googleapis.com/v1beta1/'
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  return `${base}${pathname}${qs}`
}

function buildFirebaseHostingApiUrl(pathname: string, query?: Record<string, string>): string {
  const base = 'https://firebasehosting.googleapis.com/v1beta1/'
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  return `${base}${pathname}${qs}`
}

export async function getGcpFirebaseProject(projectId: string): Promise<GcpFirebaseProjectSummary> {
  const normalizedProjectId = projectId.trim()

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirebaseManagementApiUrl(`projects/${normalizedProjectId}`)
    })

    const resources = response.resources && typeof response.resources === 'object' ? response.resources as Record<string, unknown> : {}

    return {
      projectId: asString(response.projectId) || normalizedProjectId,
      projectNumber: asString(response.projectNumber),
      displayName: asString(response.displayName),
      state: asString(response.state),
      resources: {
        hostingSite: asString(resources.hostingSite),
        storageBucket: asString(resources.storageBucket),
        locationId: asString(resources.locationId),
        realtimeDatabaseInstance: asString(resources.realtimeDatabaseInstance)
      }
    }
  } catch (error) {
    throw buildGcpSdkError(`getting Firebase project for "${normalizedProjectId}"`, error, 'firebase.googleapis.com')
  }
}

export async function listGcpFirebaseWebApps(projectId: string): Promise<GcpFirebaseWebAppSummary[]> {
  const normalizedProjectId = projectId.trim()
  const apps: GcpFirebaseWebAppSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildFirebaseManagementApiUrl(`projects/${normalizedProjectId}/webApps`, query)
      })

      const items = Array.isArray(response.apps) ? response.apps : []
      for (const entry of items) {
        const app = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        apps.push({
          name: asString(app.name),
          appId: asString(app.appId),
          displayName: asString(app.displayName),
          projectId: asString(app.projectId) || normalizedProjectId,
          appUrls: Array.isArray(app.appUrls) ? app.appUrls.map(String) : [],
          state: asString(app.state),
          apiKeyId: asString(app.apiKeyId)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return apps
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase web apps for project "${normalizedProjectId}"`, error, 'firebase.googleapis.com')
  }
}

export async function listGcpFirebaseAndroidApps(projectId: string): Promise<GcpFirebaseAndroidAppSummary[]> {
  const normalizedProjectId = projectId.trim()
  const apps: GcpFirebaseAndroidAppSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildFirebaseManagementApiUrl(`projects/${normalizedProjectId}/androidApps`, query)
      })

      const items = Array.isArray(response.apps) ? response.apps : []
      for (const entry of items) {
        const app = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        apps.push({
          name: asString(app.name),
          appId: asString(app.appId),
          displayName: asString(app.displayName),
          projectId: asString(app.projectId) || normalizedProjectId,
          packageName: asString(app.packageName),
          state: asString(app.state),
          sha1Hashes: Array.isArray(app.sha1Hashes) ? app.sha1Hashes.map(String) : [],
          sha256Hashes: Array.isArray(app.sha256Hashes) ? app.sha256Hashes.map(String) : []
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return apps
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase Android apps for project "${normalizedProjectId}"`, error, 'firebase.googleapis.com')
  }
}

export async function listGcpFirebaseIosApps(projectId: string): Promise<GcpFirebaseIosAppSummary[]> {
  const normalizedProjectId = projectId.trim()
  const apps: GcpFirebaseIosAppSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildFirebaseManagementApiUrl(`projects/${normalizedProjectId}/iosApps`, query)
      })

      const items = Array.isArray(response.apps) ? response.apps : []
      for (const entry of items) {
        const app = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        apps.push({
          name: asString(app.name),
          appId: asString(app.appId),
          displayName: asString(app.displayName),
          projectId: asString(app.projectId) || normalizedProjectId,
          bundleId: asString(app.bundleId),
          appStoreId: asString(app.appStoreId),
          state: asString(app.state),
          teamId: asString(app.teamId)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return apps
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase iOS apps for project "${normalizedProjectId}"`, error, 'firebase.googleapis.com')
  }
}

export async function listGcpFirebaseHostingSites(projectId: string): Promise<GcpFirebaseHostingSiteSummary[]> {
  const normalizedProjectId = projectId.trim()
  const sites: GcpFirebaseHostingSiteSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildFirebaseHostingApiUrl(`projects/${normalizedProjectId}/sites`, query)
      })

      const items = Array.isArray(response.sites) ? response.sites : []
      for (const entry of items) {
        const site = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(site.name)
        sites.push({
          name,
          siteId: name.split('/').pop() ?? name,
          defaultUrl: asString(site.defaultUrl),
          appId: asString(site.appId),
          type: asString(site.type),
          labels: site.labels && typeof site.labels === 'object' ? Object.fromEntries(Object.entries(site.labels as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])) : {}
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return sites
  } catch (error) {
    if (String(error).includes('404') || String(error).toLowerCase().includes('not found')) return []
    throw buildGcpSdkError(`listing Firebase Hosting sites for project "${normalizedProjectId}"`, error, 'firebasehosting.googleapis.com')
  }
}

export async function listGcpFirebaseHostingReleases(projectId: string, siteId: string): Promise<GcpFirebaseHostingReleaseSummary[]> {
  const normalizedProjectId = projectId.trim()
  const releases: GcpFirebaseHostingReleaseSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = { pageSize: '25' }
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildFirebaseHostingApiUrl(`sites/${siteId.trim()}/releases`, query)
      })

      const items = Array.isArray(response.releases) ? response.releases : []
      for (const entry of items) {
        const rel = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const user = rel.releaseUser && typeof rel.releaseUser === 'object' ? rel.releaseUser as Record<string, unknown> : {}
        const version = rel.version && typeof rel.version === 'object' ? rel.version as Record<string, unknown> : {}

        releases.push({
          name: asString(rel.name),
          version: asString(version.name),
          type: asString(rel.type),
          message: asString(rel.message),
          releaseTime: asString(rel.releaseTime),
          releaseUser: { email: asString(user.email), imageUrl: asString(user.imageUrl) },
          status: asString(version.status),
          fileCount: normalizeNumber(version.fileCount),
          versionBytes: asString(version.versionBytes)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return releases
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase Hosting releases for site "${siteId}"`, error, 'firebasehosting.googleapis.com')
  }
}

export async function listGcpFirebaseHostingDomains(projectId: string, siteId: string): Promise<GcpFirebaseHostingDomainSummary[]> {
  const normalizedProjectId = projectId.trim()
  const domains: GcpFirebaseHostingDomainSummary[] = []

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirebaseHostingApiUrl(`sites/${siteId.trim()}/domains`)
    })

    const items = Array.isArray(response.domains) ? response.domains : []
    for (const entry of items) {
      const dom = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const redirect = dom.domainRedirect && typeof dom.domainRedirect === 'object' ? dom.domainRedirect as Record<string, unknown> : null

      domains.push({
        domainName: asString(dom.domainName),
        site: asString(dom.site),
        updateTime: asString(dom.updateTime),
        status: asString(dom.status),
        provisioning: asString(dom.provisioning),
        domainRedirect: redirect ? { domainName: asString(redirect.domainName), type: asString(redirect.type) } : null
      })
    }

    return domains
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase Hosting domains for site "${siteId}"`, error, 'firebasehosting.googleapis.com')
  }
}

export async function listGcpFirebaseHostingChannels(projectId: string, siteId: string): Promise<GcpFirebaseHostingChannelSummary[]> {
  const normalizedProjectId = projectId.trim()
  const channels: GcpFirebaseHostingChannelSummary[] = []

  try {
    const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
      url: buildFirebaseHostingApiUrl(`sites/${siteId.trim()}/channels`)
    })

    const items = Array.isArray(response.channels) ? response.channels : []
    for (const entry of items) {
      const ch = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const name = asString(ch.name)

      channels.push({
        name,
        channelId: name.split('/').pop() ?? name,
        url: asString(ch.url),
        expireTime: asString(ch.expireTime),
        retainedReleaseCount: normalizeNumber(ch.retainedReleaseCount),
        createTime: asString(ch.createTime),
        updateTime: asString(ch.updateTime),
        labels: ch.labels && typeof ch.labels === 'object' ? Object.fromEntries(Object.entries(ch.labels as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])) : {}
      })
    }

    return channels
  } catch (error) {
    throw buildGcpSdkError(`listing Firebase Hosting channels for site "${siteId}"`, error, 'firebasehosting.googleapis.com')
  }
}
