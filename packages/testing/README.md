# `@mikejhill/portable-document-testing`

In-memory adapters, deterministic clocks, and shared provider conformance helpers.

```bash
npm install --save-dev @mikejhill/portable-document-core @mikejhill/portable-document-testing
```

Use `InMemoryDocumentStore` for deterministic orchestration tests, `InMemoryOutboxStore` for offline
replay tests, `FakeClock` for revision and TTL policies, and `assertSnapshotStoreConformance`
against every `SnapshotStore` implementation.
