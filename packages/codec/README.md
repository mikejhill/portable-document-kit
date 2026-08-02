# `@mikejhill/portable-document-codec`

Portable snapshot envelopes, serializer registration, compression ports, bounded decoding,
migrations, and explicit legacy decoding.

```bash
npm install @mikejhill/portable-document-core @mikejhill/portable-document-codec
```

Construct `PortableSnapshotCodec` with a fragment prefix and `DocumentDefinition`. Register custom
`SnapshotSerializer` implementations for compact domain transports and `LegacySnapshotDecoder`
implementations for formats that predate the portable envelope. Configure encoded and decoded size
budgets for every untrusted route.

See the URL-only recipe in [Getting Started](../../docs/getting-started.md).
