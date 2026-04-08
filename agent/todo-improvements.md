# Code Improvement Todo List

## 1. AWS SDK Client Pooling (Highest Impact) ✅
- [x] Create a `ClientPool` class in `src/main/aws/client.ts` that caches SDK clients per connection profile
- [x] Add TTL-based cleanup for idle clients
- [x] Replace all `createClient(connection)` calls in `src/main/aws/ec2.ts` to use the pool
- [x] Do the same for IAM, SSM, and all other service clients across `src/main/aws/*.ts`

## 2. React Component Refactoring (deferred)
- [ ] Split `Ec2Console.tsx` into smaller feature-based components
- [ ] Add `useMemo` for filtered/sorted instance and volume lists
- [ ] Add `useCallback` for event handlers
- [ ] Wrap list item components with `React.memo`
- [ ] Group related state into objects to reduce the number of `useState` calls

## 3. IPC Wrapper Deduplication ✅
- [x] Create a generic wrapper factory in `src/renderer/src/bridgeUtils.ts`
- [x] Refactor `ec2Api.ts`, `sgApi.ts`, `workspaceApi.ts`, `terraformApi.ts` with the factory

## 4. Split Monolithic Files (deferred)
- [ ] Split `src/main/ipc.ts` into service-specific handler files
- [ ] Split `src/main/aws/ec2.ts` into logical modules
- [ ] Split `src/renderer/src/api.ts` into domain-specific API modules

## 5. Error Handling ✅
- [x] Audit all silent `catch { return [] }` patterns across `src/main/aws/*.ts`
- [x] Replace meaningful silent failures with `logWarn` (acm, secretsManager, observabilityLab)
- [x] Add React `ErrorBoundary` component with retry UI
- [x] Wire `ErrorBoundary` into `ConnectedServiceScreen` — covers all AWS service consoles

## 6. Request Deduplication & Cancellation ✅
- [x] Add `inflightRequests` map in `api.ts` to coalesce identical concurrent non-cached calls
- [x] Add `useStaleGuard` hook for generation-based stale response prevention
- [x] Apply `useStaleGuard` to `selectInstance` in `Ec2Console.tsx`

## 7. Credential Cache TTL ✅
- [x] Add expiration tracking to `credentialProviders` cache in `src/main/aws/client.ts`
- [x] Implement proactive eviction 5 min before credential expiry
- [x] Add `refreshCredentialsForProfile()` for forced invalidation on session change

## 8. Pagination & Virtual Scrolling (deferred)
- [ ] Add cursor/token-based pagination to list endpoints
- [ ] Implement virtual scrolling on the renderer side for large lists
