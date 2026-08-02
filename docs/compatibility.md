# Compatibility

| Layer             | Version owner                  | Migration rule                  |
| ----------------- | ------------------------------ | ------------------------------- |
| Document schema   | Consumer definition            | Contiguous consumer migrations  |
| Snapshot envelope | Codec package                  | Registered protocol decoder     |
| Payload codec     | Consumer or codec package      | Named codec plus legacy decoder |
| URL route         | Consumer browser configuration | Prefix-specific resolver        |
| IndexedDB record  | IndexedDB package              | Transactional database upgrade  |
| Firebase record   | Firebase package               | Explicit provider migration     |

Unknown versions fail with typed errors. They never create replacement documents. Squarecast retains
its existing `#sq1:` and pointer contracts, compact tuples, IndexedDB names, and Firestore schema
during adoption.
