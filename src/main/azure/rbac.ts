/**
 * Azure RBAC — extracted from azureSdk.ts.
 */

import { fetchAzureArmJson, fetchAzureArmCollection } from './client'
import { AZURE_RISKY_ROLE_MARKERS, inferScopeKind } from './shared'
import type {
  AzureRbacOverview,
  AzureRoleAssignmentSummary,
  AzureRoleDefinitionSummary
} from '@shared/types'

export async function getAzureRbacOverview(subscriptionId: string): Promise<AzureRbacOverview> {
  const subscriptionScope = `/subscriptions/${subscriptionId.trim()}`
  const [assignments, roleDefinitions] = await Promise.all([
    fetchAzureArmCollection<{
      id?: string
      properties?: {
        principalId?: string
        principalType?: string
        roleDefinitionId?: string
        scope?: string
        condition?: string
      }
    }>(`${subscriptionScope}/providers/Microsoft.Authorization/roleAssignments`, '2022-04-01'),
    fetchAzureArmCollection<{
      id?: string
      properties?: {
        roleName?: string
      }
    }>(`${subscriptionScope}/providers/Microsoft.Authorization/roleDefinitions`, '2022-04-01')
  ])

  const roleNameById = new Map<string, string>()
  for (const definition of roleDefinitions) {
    const definitionId = definition.id?.trim().toLowerCase()
    const roleName = definition.properties?.roleName?.trim()
    if (definitionId && roleName) {
      roleNameById.set(definitionId, roleName)
    }
  }

  const normalizedSubscriptionScope = subscriptionScope.toLowerCase()
  const mappedAssignments: AzureRoleAssignmentSummary[] = assignments.map((assignment) => {
    const roleDefinitionId = assignment.properties?.roleDefinitionId?.trim().toLowerCase() ?? ''
    const roleName = roleNameById.get(roleDefinitionId) ?? roleDefinitionId.split('/').pop() ?? 'Unknown role'
    const scope = assignment.properties?.scope?.trim() || subscriptionScope
    const risky = AZURE_RISKY_ROLE_MARKERS.some((marker) => roleName.toLowerCase().includes(marker))

    return {
      id: assignment.id?.trim() || `${scope}:${assignment.properties?.principalId?.trim() || 'unknown'}`,
      principalId: assignment.properties?.principalId?.trim() || 'unknown',
      principalType: assignment.properties?.principalType?.trim() || 'Unknown',
      roleName,
      scope,
      scopeKind: inferScopeKind(scope, subscriptionScope),
      inherited: scope.toLowerCase() !== normalizedSubscriptionScope,
      risky,
      condition: assignment.properties?.condition?.trim() || ''
    }
  }).sort((left, right) => {
    if (left.risky !== right.risky) {
      return left.risky ? -1 : 1
    }

    return left.roleName.localeCompare(right.roleName)
  })

  return {
    subscriptionId,
    assignmentCount: mappedAssignments.length,
    principalCount: new Set(mappedAssignments.map((assignment) => assignment.principalId)).size,
    roleCount: new Set(mappedAssignments.map((assignment) => assignment.roleName)).size,
    riskyAssignmentCount: mappedAssignments.filter((assignment) => assignment.risky).length,
    inheritedAssignmentCount: mappedAssignments.filter((assignment) => assignment.inherited).length,
    assignments: mappedAssignments,
    notes: mappedAssignments.length === 0
      ? ['No role assignments were visible for the selected subscription scope.']
      : []
  }
}

export async function listAzureRoleDefinitions(subscriptionId: string): Promise<AzureRoleDefinitionSummary[]> {
  const subscriptionScope = `/subscriptions/${subscriptionId.trim()}`
  const definitions = await fetchAzureArmCollection<{
    id?: string
    properties?: {
      roleName?: string
      description?: string
      type?: string
      permissions?: Array<{
        actions?: string[]
        notActions?: string[]
        dataActions?: string[]
        notDataActions?: string[]
      }>
      assignableScopes?: string[]
    }
  }>(`${subscriptionScope}/providers/Microsoft.Authorization/roleDefinitions`, '2022-04-01')

  return definitions.map((definition) => {
    const permissions = definition.properties?.permissions?.[0]
    return {
      id: definition.id?.trim() || '',
      roleName: definition.properties?.roleName?.trim() || 'Unknown',
      description: definition.properties?.description?.trim() || '',
      roleType: (definition.properties?.type === 'CustomRole' ? 'CustomRole' : 'BuiltInRole') as 'BuiltInRole' | 'CustomRole',
      actions: permissions?.actions ?? [],
      notActions: permissions?.notActions ?? [],
      dataActions: permissions?.dataActions ?? [],
      notDataActions: permissions?.notDataActions ?? [],
      assignableScopes: definition.properties?.assignableScopes ?? []
    }
  }).sort((left, right) => left.roleName.localeCompare(right.roleName))
}

export async function listAzureRoleAssignments(subscriptionId: string): Promise<AzureRoleAssignmentSummary[]> {
  const overview = await getAzureRbacOverview(subscriptionId)
  return overview.assignments
}

export async function createAzureRoleAssignment(
  subscriptionId: string,
  principalId: string,
  roleDefinitionId: string,
  scope: string
): Promise<void> {
  const assignmentId = crypto.randomUUID()
  const assignmentPath = `${scope.trim()}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}`
  await fetchAzureArmJson(assignmentPath, '2022-04-01', {
    method: 'PUT',
    body: JSON.stringify({
      properties: {
        principalId: principalId.trim(),
        roleDefinitionId: roleDefinitionId.trim()
      }
    })
  })
}

export async function deleteAzureRoleAssignment(assignmentId: string): Promise<void> {
  await fetchAzureArmJson(assignmentId.trim(), '2022-04-01', { method: 'DELETE' })
}
