# `@mikejhill/portable-document-indexeddb`

Validated IndexedDB documents, catalog records, checkpoints, subscriptions, and durable command
outboxes.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-indexeddb
```

`IndexedDbDocumentStore` implements snapshot, catalog, command, history, and subscription ports.
`IndexedDbOutboxStore` atomically persists replication commands. Both adapters expose `close()`.
Handle `IndexedDbUnavailableError` and `IndexedDbUpgradeBlockedError` as explicit recoverable
states.
