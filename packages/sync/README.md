# `@mikejhill/portable-document-sync`

Durable optimistic concurrency, optimistic overlays, coalescing, acknowledgement filtering,
rebasing, retry classification, and recoverable conflicts.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-sync
```

`OccReplicationEngine` depends only on `CommandCommitStore` and `OutboxStore`. Restore pending
commands before accepting edits after application startup. Subscribe to `ReplicationState` and
present every non-clean status explicitly.
