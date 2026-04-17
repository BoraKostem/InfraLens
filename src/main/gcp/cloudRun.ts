/**
 * Cloud Run wrappers — services, revisions, jobs, executions, domain
 * mappings. Extracted verbatim from gcpSdk.ts as part of the monolith
 * decomposition. Uses the v2 REST API except domain mappings which remain
 * on v1.
 */

import type {
  GcpCloudRunCondition,
  GcpCloudRunDomainMappingSummary,
  GcpCloudRunExecutionSummary,
  GcpCloudRunJobSummary,
  GcpCloudRunRevisionSummary,
  GcpCloudRunServiceSummary,
  GcpCloudRunTrafficStatus
} from '@shared/types'

import { paginationGuard, requestGcp } from './client'
import { asString, buildGcpSdkError, normalizeNumber } from './shared'

function buildCloudRunApiUrl(pathname: string, query?: Record<string, string>): string {
  const base = 'https://run.googleapis.com/v2/'
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  return `${base}${pathname}${qs}`
}

function normalizeCloudRunCondition(raw: unknown): GcpCloudRunCondition {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    type: asString(r.type),
    state: asString(r.state),
    message: asString(r.message),
    lastTransitionTime: asString(r.lastTransitionTime),
    severity: asString(r.severity)
  }
}

function normalizeCloudRunTraffic(raw: unknown): GcpCloudRunTrafficStatus {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    type: asString(r.type),
    revisionName: asString(r.revision),
    percent: normalizeNumber(r.percent),
    tag: asString(r.tag),
    uri: asString(r.uri)
  }
}

export async function listGcpCloudRunServices(projectId: string, location: string): Promise<GcpCloudRunServiceSummary[]> {
  const normalizedProjectId = projectId.trim()
  const loc = location.trim() || '-'
  const services: GcpCloudRunServiceSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildCloudRunApiUrl(`projects/${normalizedProjectId}/locations/${loc}/services`, query)
      })

      const items = Array.isArray(response.services) ? response.services : []
      for (const entry of items) {
        const svc = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(svc.name)
        if (!name) continue

        const template = svc.template && typeof svc.template === 'object' ? svc.template as Record<string, unknown> : {}
        const containers = Array.isArray(template.containers) ? template.containers : []
        const firstContainer = containers[0] && typeof containers[0] === 'object' ? containers[0] as Record<string, unknown> : {}
        const resources = firstContainer.resources && typeof firstContainer.resources === 'object' ? firstContainer.resources as Record<string, unknown> : {}
        const limits = resources.limits && typeof resources.limits === 'object' ? resources.limits as Record<string, unknown> : {}
        const ports = Array.isArray(firstContainer.ports) ? firstContainer.ports : []
        const firstPort = ports[0] && typeof ports[0] === 'object' ? ports[0] as Record<string, unknown> : {}
        const vpcAccess = template.vpcAccess && typeof template.vpcAccess === 'object' ? template.vpcAccess as Record<string, unknown> : {}
        const conditions = Array.isArray(svc.conditions) ? svc.conditions.map(normalizeCloudRunCondition) : []
        const trafficStatuses = Array.isArray(svc.trafficStatuses) ? svc.trafficStatuses.map(normalizeCloudRunTraffic) : []

        services.push({
          name,
          serviceId: name.split('/').pop() ?? name,
          description: asString(svc.description),
          uri: asString(svc.uri),
          creator: asString(svc.creator),
          lastModifier: asString(svc.lastModifier),
          createTime: asString(svc.createTime),
          updateTime: asString(svc.updateTime),
          ingressSetting: asString(svc.ingress),
          launchStage: asString(svc.launchStage),
          latestReadyRevision: asString(svc.latestReadyRevision),
          latestCreatedRevision: asString(svc.latestCreatedRevision),
          trafficStatuses,
          containerImage: asString(firstContainer.image),
          containerPort: normalizeNumber(firstPort.containerPort),
          serviceAccountEmail: asString(template.serviceAccount),
          vpcConnector: asString(vpcAccess.connector),
          executionEnvironment: asString(template.executionEnvironment),
          cpuLimit: asString(limits.cpu),
          memoryLimit: asString(limits.memory),
          maxInstanceRequestConcurrency: normalizeNumber(template.maxInstanceRequestConcurrency),
          timeout: asString(template.timeout),
          conditions
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return services
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Run services for project "${normalizedProjectId}"`, error, 'run.googleapis.com')
  }
}

export async function listGcpCloudRunRevisions(projectId: string, location: string, serviceId: string): Promise<GcpCloudRunRevisionSummary[]> {
  const normalizedProjectId = projectId.trim()
  const loc = location.trim() || '-'
  const revisions: GcpCloudRunRevisionSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildCloudRunApiUrl(`projects/${normalizedProjectId}/locations/${loc}/services/${serviceId.trim()}/revisions`, query)
      })

      const items = Array.isArray(response.revisions) ? response.revisions : []
      for (const entry of items) {
        const rev = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(rev.name)
        if (!name) continue

        const containers = Array.isArray(rev.containers) ? rev.containers : []
        const firstContainer = containers[0] && typeof containers[0] === 'object' ? containers[0] as Record<string, unknown> : {}
        const resources = firstContainer.resources && typeof firstContainer.resources === 'object' ? firstContainer.resources as Record<string, unknown> : {}
        const limits = resources.limits && typeof resources.limits === 'object' ? resources.limits as Record<string, unknown> : {}
        const scaling = rev.scaling && typeof rev.scaling === 'object' ? rev.scaling as Record<string, unknown> : {}
        const conditions = Array.isArray(rev.conditions) ? rev.conditions.map(normalizeCloudRunCondition) : []

        revisions.push({
          name,
          revisionId: name.split('/').pop() ?? name,
          generation: asString(rev.generation),
          createTime: asString(rev.createTime),
          updateTime: asString(rev.updateTime),
          launchStage: asString(rev.launchStage),
          containerImage: asString(firstContainer.image),
          cpuLimit: asString(limits.cpu),
          memoryLimit: asString(limits.memory),
          maxInstanceRequestConcurrency: normalizeNumber(rev.maxInstanceRequestConcurrency),
          timeout: asString(rev.timeout),
          serviceAccountEmail: asString(rev.serviceAccount),
          scaling: {
            minInstanceCount: normalizeNumber(scaling.minInstanceCount),
            maxInstanceCount: normalizeNumber(scaling.maxInstanceCount)
          },
          conditions,
          logUri: asString(rev.logUri)
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return revisions
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Run revisions for service "${serviceId}"`, error, 'run.googleapis.com')
  }
}

export async function listGcpCloudRunJobs(projectId: string, location: string): Promise<GcpCloudRunJobSummary[]> {
  const normalizedProjectId = projectId.trim()
  const loc = location.trim() || '-'
  const jobs: GcpCloudRunJobSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildCloudRunApiUrl(`projects/${normalizedProjectId}/locations/${loc}/jobs`, query)
      })

      const items = Array.isArray(response.jobs) ? response.jobs : []
      for (const entry of items) {
        const job = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(job.name)
        if (!name) continue

        const template = job.template && typeof job.template === 'object' ? job.template as Record<string, unknown> : {}
        const taskTemplate = template.template && typeof template.template === 'object' ? template.template as Record<string, unknown> : {}
        const containers = Array.isArray(taskTemplate.containers) ? taskTemplate.containers : []
        const firstContainer = containers[0] && typeof containers[0] === 'object' ? containers[0] as Record<string, unknown> : {}
        const resources = firstContainer.resources && typeof firstContainer.resources === 'object' ? firstContainer.resources as Record<string, unknown> : {}
        const limits = resources.limits && typeof resources.limits === 'object' ? resources.limits as Record<string, unknown> : {}
        const conditions = Array.isArray(job.conditions) ? job.conditions.map(normalizeCloudRunCondition) : []
        const latestExecRef = job.latestCreatedExecution && typeof job.latestCreatedExecution === 'object' ? job.latestCreatedExecution as Record<string, unknown> : {}

        jobs.push({
          name,
          jobId: name.split('/').pop() ?? name,
          createTime: asString(job.createTime),
          updateTime: asString(job.updateTime),
          creator: asString(job.creator),
          lastModifier: asString(job.lastModifier),
          launchStage: asString(job.launchStage),
          containerImage: asString(firstContainer.image),
          taskCount: normalizeNumber(template.taskCount),
          maxRetries: normalizeNumber(template.maxRetries),
          timeout: asString(taskTemplate.timeout),
          cpuLimit: asString(limits.cpu),
          memoryLimit: asString(limits.memory),
          serviceAccountEmail: asString(taskTemplate.serviceAccount),
          executionCount: normalizeNumber(job.executionCount),
          latestExecution: asString(latestExecRef.name),
          conditions
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return jobs
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Run jobs for project "${normalizedProjectId}"`, error, 'run.googleapis.com')
  }
}

export async function listGcpCloudRunExecutions(projectId: string, location: string, jobId: string): Promise<GcpCloudRunExecutionSummary[]> {
  const normalizedProjectId = projectId.trim()
  const loc = location.trim() || '-'
  const executions: GcpCloudRunExecutionSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      const query: Record<string, string> = {}
      if (pageToken) query.pageToken = pageToken

      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, {
        url: buildCloudRunApiUrl(`projects/${normalizedProjectId}/locations/${loc}/jobs/${jobId.trim()}/executions`, query)
      })

      const items = Array.isArray(response.executions) ? response.executions : []
      for (const entry of items) {
        const exec = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const name = asString(exec.name)
        if (!name) continue

        const conditions = Array.isArray(exec.conditions) ? exec.conditions.map(normalizeCloudRunCondition) : []

        executions.push({
          name,
          executionId: name.split('/').pop() ?? name,
          createTime: asString(exec.createTime),
          startTime: asString(exec.startTime),
          completionTime: asString(exec.completionTime),
          runningCount: normalizeNumber(exec.runningCount),
          succeededCount: normalizeNumber(exec.succeededCount),
          failedCount: normalizeNumber(exec.failedCount),
          cancelledCount: normalizeNumber(exec.cancelledCount),
          taskCount: normalizeNumber(exec.taskCount),
          logUri: asString(exec.logUri),
          conditions
        })
      }

      pageToken = asString(response.nextPageToken)
    } while (pageToken && canPage())

    return executions
  } catch (error) {
    throw buildGcpSdkError(`listing Cloud Run executions for job "${jobId}"`, error, 'run.googleapis.com')
  }
}

export async function listGcpCloudRunDomainMappings(projectId: string, location: string): Promise<GcpCloudRunDomainMappingSummary[]> {
  const normalizedProjectId = projectId.trim()
  const loc = location.trim() || '-'
  const mappings: GcpCloudRunDomainMappingSummary[] = []

  try {
    let pageToken = ''
    const canPage = paginationGuard()
    do {
      // Domain mappings use the v1 API
      const url = `https://run.googleapis.com/v1/projects/${normalizedProjectId}/locations/${loc}/domainmappings${pageToken ? '?pageToken=' + encodeURIComponent(pageToken) : ''}`
      const response = await requestGcp<Record<string, unknown>>(normalizedProjectId, { url })

      const items = Array.isArray(response.items) ? response.items : []
      for (const entry of items) {
        const dm = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const metadata = dm.metadata && typeof dm.metadata === 'object' ? dm.metadata as Record<string, unknown> : {}
        const spec = dm.spec && typeof dm.spec === 'object' ? dm.spec as Record<string, unknown> : {}
        const status = dm.status && typeof dm.status === 'object' ? dm.status as Record<string, unknown> : {}
        const conditions = Array.isArray(status.conditions) ? status.conditions.map(normalizeCloudRunCondition) : []
        const resourceRecords = Array.isArray(status.resourceRecords) ? status.resourceRecords : []
        const records = resourceRecords.map((rr: unknown) => {
          const r = rr && typeof rr === 'object' ? rr as Record<string, unknown> : {}
          return { type: asString(r.type), rrdata: asString(r.rrdata) }
        })

        mappings.push({
          name: asString(metadata.name),
          routeName: asString(spec.routeName),
          createTime: asString(metadata.creationTimestamp),
          conditions,
          mappedRouteName: asString(status.mappedRouteName),
          records
        })
      }

      pageToken = asString(response.metadata && typeof response.metadata === 'object' ? (response.metadata as Record<string, unknown>).continue : '')
    } while (pageToken && canPage())

    return mappings
  } catch (error) {
    // Domain mappings may not be available in all regions — return empty instead of throwing
    if (String(error).includes('404') || String(error).includes('not found')) return []
    throw buildGcpSdkError(`listing Cloud Run domain mappings for project "${normalizedProjectId}"`, error, 'run.googleapis.com')
  }
}
