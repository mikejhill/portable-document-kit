# `@mikejhill/portable-document-core`

Validated document definitions, semantic commands, revisions, capability ports, diagnostics, and the
headless workspace state machine.

```bash
npm install @mikejhill/portable-document-core
```

Primary APIs:

- `defineDocument`: validates document identity, schema version, and migration topology.
- `applyDocumentCommand`: validates state and command, contains reducer failures, and validates
  output.
- `migrateDocumentState`: applies a contiguous migration chain and validates the final state.
- `createCommandEnvelope`: creates the provider-neutral revisioned command protocol.
- `WorkspaceEngine`: resolves routes and exposes explicit loading, ready, historical, and error
  states.
- Capability ports: `SnapshotStore`, `CommandCommitStore`, `OutboxStore`, history, subscriptions,
  publication, membership, and presence.

See [Getting Started](../../docs/getting-started.md) and
[Design Principles](../../docs/design-principles.md).
