# Code Improvement Todo List

## 1. AWS SDK Client Pooling (Highest Impact)
- [ ] Create a `ClientPool` class in `src/main/aws/client.ts` that caches SDK clients per connection profile
- [ ] Add TTL-based cleanup for idle clients
- [ ] Replace all `createClient(connection)` calls in `src/main/aws/ec2.ts` to use the pool
- [ ] Do the same for IAM, SSM, and all other service clients across `src/main/aws/*.ts`

## 2. React Component Refactoring
- [ ] Split `Ec2Console.tsx` into smaller feature-based components (instances panel, volumes panel, snapshots panel, SSM panel, bastion panel)
- [ ] Add `useMemo` for filtered/sorted instance and volume lists
- [ ] Add `useCallback` for event handlers (selectInstance, selectVolume, reload, etc.)
- [ ] Wrap list item components with `React.memo`
- [ ] Group related state into objects to reduce the number of `useState` calls

## 3. IPC Wrapper Deduplication
- [ ] Create a generic wrapper factory in `src/renderer/src/ec2Api.ts` to replace the 100+ boilerplate functions
- [ ] Apply the same pattern to other renderer API files (`api.ts` and similar)

## 4. Split Monolithic Files
- [ ] Split `src/main/ipc.ts` into service-specific handler files (e.g. `ec2Ipc.ts`, `iamIpc.ts`, `terraformIpc.ts`)
- [ ] Split `src/main/aws/ec2.ts` into logical modules (instances, volumes, snapshots, bastion, temp-inspection)
- [ ] Split `src/renderer/src/api.ts` into domain-specific API modules

## 5. Error Handling
- [ ] Audit all silent `catch { return [] }` and `catch { return new Map() }` patterns across `src/main/aws/*.ts`
- [ ] Replace silent failures with structured errors or at minimum log them
- [ ] Add React error boundaries around major console components
- [ ] Implement retry logic with exponential backoff for transient AWS errors (throttling, network)

## 6. Request Deduplication & Cancellation
- [ ] Add request coalescing in the IPC bridge layer to prevent duplicate in-flight calls
- [ ] Use `AbortController` for cancellable requests (e.g. when user switches tabs mid-load)
- [ ] Guard state updates with a "still mounted / still relevant" check to prevent stale responses overwriting newer state

## 7. Credential Cache TTL
- [ ] Add expiration tracking to `credentialProviders` cache in `src/main/aws/client.ts`
- [ ] Implement automatic refresh before expiry for temporary credentials (STS/SSO)
- [ ] Add a mechanism to force-invalidate credentials on session change

## 8. Pagination & Virtual Scrolling
- [ ] Add cursor/token-based pagination to list endpoints in `src/main/aws/ec2.ts` (instances, volumes, snapshots)
- [ ] Apply the same to other high-volume list endpoints (IAM users, S3 buckets, etc.)
- [ ] Implement virtual scrolling on the renderer side for large lists
