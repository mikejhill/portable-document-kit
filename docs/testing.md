# Testing and CI

## Local Gates

```bash
npm ci
npm run quality
npm run test:unit
npm run test:integration
npm run test:rules
npm run test:coverage
npm run check
```

`quality` runs Prettier verification, type-aware ESLint, React Hooks analysis, Markdown linting,
local-link and package-README checks, package dependency-boundary checks, and strict TypeScript.

## Test Layers

- Unit tests cover deterministic reducers, migrations, codecs, routing, workspace transitions,
  replication state, and helper policies.
- Integration tests compose document definitions with IndexedDB, durable outboxes, replication, and
  the structured-notes model.
- Adapter conformance tests run identical port behavior against in-memory and provider adapters.
- Firestore Rules tests use the Firebase emulator and verify allow and deny behavior for ownership,
  editors, guests, publications, invitations, revision monotonicity, membership, and presence.
- Package tests build tarballs, install them into an isolated consumer, and import every public
  entry point. Source aliases cannot make this test pass.
- API snapshots make public declaration changes explicit during review.

## Firebase Strategy

The Firestore emulator is the blocking pull-request environment. It is deterministic, contains no
credentials, runs the actual Rules evaluator, and permits exhaustive denial testing. Unit tests mock
Firebase SDK boundaries only for client orchestration behavior that the Rules emulator cannot
observe, such as lazy initialization and subscription cleanup.

A shared production Firebase project is not used for pull requests. It would expose credentials to
untrusted code, introduce cross-run state, add quota and timing failures, and make denial cleanup
fragile. Teams may add a protected, manually dispatched smoke workflow against a dedicated project,
but it must use GitHub environments, short-lived credentials, a unique document namespace, and
guaranteed cleanup. That smoke test supplements rather than replaces emulator coverage.

## CI Evidence

CI separates static analysis, unit coverage, Firebase emulator integration, production builds, and
package installation. Each job has read-only repository permissions unless a release explicitly
needs more. Dependency review runs for pull requests and CodeQL scans JavaScript and TypeScript.

## Coverage Policy

Coverage thresholds are enforced on application code, not generated declarations or test fixtures.
New branches and failure paths require behavioral tests. Coverage is evidence of exercised behavior,
not a substitute for state-machine, property, compatibility, and denial-case tests.
